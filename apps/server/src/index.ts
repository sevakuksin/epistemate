import { createServer } from "node:http";
import cors from "cors";
import express from "express";
import argon2 from "argon2";
import {
  addMinutes,
  db,
  deleteDoc,
  getDoc,
  listDocs,
  newId,
  normalizeFriendPair,
  nowIso,
  upsertDoc,
} from "./db.js";
import { DEMO_USER_ID, ensureDemoPreset } from "./sampleData.js";
import {
  adjustDraftBuy,
  confirmDraftPhase,
  createInitialEpistemateDraft,
  movePlacedPiece,
  parseEpistemateDraft,
  placeFromPool,
  takeBackPlacedPiece,
  type Side,
} from "./epistemateDraft.js";
import { initRealtime } from "./realtime.js";
import { applyMove, createGameFromSetup, deserializeGame, serializeGame } from "@cv/engine";
import type { CompactMove } from "@cv/engine";
import type { BoardDefinition, GameSetup, PieceTypeDefinition } from "@cv/shared";

type User = {
  id: string;
  username: string;
  password_hash?: string | null;
};

type AuthRequest = express.Request & { userId?: string };

type GameMode = "chess" | "epistemate" | "custom";

const PORT = Number(process.env.PORT) || 3001;
/** Bind address. Default loopback so nginx can proxy without exposing the port publicly. Set HOST=0.0.0.0 for LAN/dev if needed. */
const HOST = process.env.HOST ?? "127.0.0.1";
const SESSION_DAYS = 7;
const INVITE_EXPIRY_MINUTES = 15;
const USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/;
const REGISTRATION_CODE = process.env.REGISTRATION_CODE || "change_me";

ensureDemoPreset();

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));
const httpServer = createServer(app);
const realtime = initRealtime(httpServer);

function parseCookies(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (!k) continue;
    out[k] = decodeURIComponent(v.join("=") || "");
  }
  return out;
}

function setSessionCookie(res: express.Response, sid: string): void {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  res.setHeader(
    "Set-Cookie",
    `sid=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
  );
}

function clearSessionCookie(res: express.Response): void {
  res.setHeader("Set-Cookie", "sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
}

function getSessionUserId(req: express.Request): string | null {
  const cookies = parseCookies(req.header("cookie"));
  const sid = cookies.sid;
  if (!sid) return null;
  const row = db
    .prepare(
      `SELECT user_id FROM sessions
       WHERE id = ? AND revoked_at IS NULL AND expires_at > ?`
    )
    .get(sid, nowIso()) as { user_id: string } | undefined;
  return row?.user_id ?? null;
}

function withAuth(req: AuthRequest, _res: express.Response, next: express.NextFunction): void {
  const fromSession = getSessionUserId(req);
  if (fromSession) {
    req.userId = fromSession;
    next();
    return;
  }
  // Backward-compatible local fallback for old clients.
  const fromHeader = req.header("x-user-id");
  req.userId = fromHeader ? String(fromHeader) : undefined;
  next();
}

function requireAuth(req: AuthRequest, res: express.Response, next: express.NextFunction): void {
  withAuth(req, res, () => {
    if (!req.userId) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  });
}

function assertName(value: unknown, fallback = "Untitled"): string {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return fallback;
}

function getUserById(userId: string): User | null {
  const row = db
    .prepare("SELECT id, username, password_hash FROM users WHERE id = ?")
    .get(userId) as User | undefined;
  return row ?? null;
}

function isFriend(userId: string, otherUserId: string): boolean {
  const { userA, userB } = normalizeFriendPair(userId, otherUserId);
  const row = db
    .prepare("SELECT id FROM friendships WHERE user_a_id = ? AND user_b_id = ?")
    .get(userA, userB) as { id: string } | undefined;
  return Boolean(row);
}

function currentTurnUserId(game: { white_user_id: string; black_user_id: string; current_turn_side: string }): string {
  return game.current_turn_side === "white" ? game.white_user_id : game.black_user_id;
}

function otherUserId(game: { white_user_id: string; black_user_id: string }, actorUserId: string): string {
  return actorUserId === game.white_user_id ? game.black_user_id : game.white_user_id;
}

function gameSideForUser(game: { white_user_id: string; black_user_id: string }, userId: string): Side | null {
  if (game.white_user_id === userId) return "white";
  if (game.black_user_id === userId) return "black";
  return null;
}

function loadBundleFromDocs(ownerUserId: string, setupId: string): { setup: GameSetup; board: BoardDefinition } | null {
  const setup = getDoc("setup", ownerUserId, setupId) as GameSetup | null;
  if (!setup) return null;
  const board = getDoc("board", ownerUserId, setup.boardId) as BoardDefinition | null;
  if (!board) return null;
  return { setup, board };
}

function loadBuiltInBundle(mode: GameMode): { setup: GameSetup; board: BoardDefinition } | null {
  const setupId = mode === "epistemate" ? "setup_epistemate" : "setup_classic_8x8";
  return loadBundleFromDocs(DEMO_USER_ID, setupId);
}

function createGameFromInvite(
  mode: GameMode,
  inviterUserId: string,
  accepterUserId: string,
  customSetupId?: string | null
): { gameId: string } {
  const useInviterAsWhite = Math.random() < 0.5;
  const whiteUserId = useInviterAsWhite ? inviterUserId : accepterUserId;
  const blackUserId = useInviterAsWhite ? accepterUserId : inviterUserId;

  let bundle: { setup: GameSetup; board: BoardDefinition } | null = null;
  if (mode === "custom") {
    if (!customSetupId) throw new Error("custom setup id required");
    bundle = loadBundleFromDocs(inviterUserId, customSetupId);
  } else {
    bundle = loadBuiltInBundle(mode);
  }

  if (!bundle) throw new Error("failed to load game setup");

  const ts = nowIso();
  const gameId = newId("game");

  if (mode === "epistemate" && bundle.setup.budgetMode?.enabled) {
    const draft = createInitialEpistemateDraft(bundle.setup);
    db.prepare(
      `INSERT INTO games (
        id, mode, status, white_user_id, black_user_id, current_turn_side,
        winner_user_id, draw_offered_by_user_id,
        board_json, setup_json, state_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      gameId,
      mode,
      "draft",
      whiteUserId,
      blackUserId,
      draft.activeSide,
      null,
      null,
      JSON.stringify(bundle.board),
      JSON.stringify(bundle.setup),
      JSON.stringify(draft),
      ts,
      ts
    );
    return { gameId };
  }

  const initial = createGameFromSetup(bundle.setup, bundle.board);
  const snapshot = serializeGame(initial);
  db.prepare(
    `INSERT INTO games (
      id, mode, status, white_user_id, black_user_id, current_turn_side,
      winner_user_id, draw_offered_by_user_id,
      board_json, setup_json, state_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    gameId,
    mode,
    "active",
    whiteUserId,
    blackUserId,
    initial.sides[initial.currentTurnIndex],
    null,
    null,
    JSON.stringify(bundle.board),
    JSON.stringify(bundle.setup),
    JSON.stringify(snapshot),
    ts,
    ts
  );

  return { gameId };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "cv-server" });
});

// ---- Auth ----
app.post("/api/auth/register", async (req, res) => {
  const username = String(req.body?.username ?? "").trim();
  const password = String(req.body?.password ?? "");
  const registrationCode = String(req.body?.registrationCode ?? "");

  if (!USERNAME_RE.test(username)) {
    res.status(400).json({ error: "username must match [A-Za-z0-9_-] and be 3-20 chars" });
    return;
  }
  if (password.length < 6 || password.length > 128) {
    res.status(400).json({ error: "password must be 6-128 chars" });
    return;
  }
  if (registrationCode !== REGISTRATION_CODE) {
    res.status(403).json({ error: "invalid registration code" });
    return;
  }

  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: string } | undefined;
  if (existing) {
    res.status(409).json({ error: "username already taken" });
    return;
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const userId = newId("user");
  const ts = nowIso();
  db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)").run(
    userId,
    username,
    passwordHash,
    ts
  );

  const sid = newId("sid");
  db.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at, revoked_at) VALUES (?, ?, ?, ?, NULL)").run(
    sid,
    userId,
    addMinutes(ts, SESSION_DAYS * 24 * 60),
    ts
  );
  setSessionCookie(res, sid);
  res.status(201).json({ user: { id: userId, username, createdAt: ts } });
});

app.post("/api/auth/login", async (req, res) => {
  const username = String(req.body?.username ?? "").trim();
  const password = String(req.body?.password ?? "");
  const user = db
    .prepare("SELECT id, username, password_hash FROM users WHERE username = ?")
    .get(username) as User | undefined;
  if (!user?.password_hash) {
    res.status(401).json({ error: "invalid credentials" });
    return;
  }

  const ok = await argon2.verify(user.password_hash, password);
  if (!ok) {
    res.status(401).json({ error: "invalid credentials" });
    return;
  }

  const sid = newId("sid");
  const ts = nowIso();
  db.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at, revoked_at) VALUES (?, ?, ?, ?, NULL)").run(
    sid,
    user.id,
    addMinutes(ts, SESSION_DAYS * 24 * 60),
    ts
  );
  setSessionCookie(res, sid);
  res.json({ user: { id: user.id, username: user.username } });
});

app.post("/api/auth/logout", withAuth, (req: AuthRequest, res) => {
  const cookies = parseCookies(req.header("cookie"));
  const sid = cookies.sid;
  if (sid) {
    db.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?").run(nowIso(), sid);
  }
  clearSessionCookie(res);
  res.status(204).send();
});

app.get("/api/auth/me", withAuth, (req: AuthRequest, res) => {
  if (!req.userId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const user = getUserById(req.userId);
  if (!user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  res.json({ user: { id: user.id, username: user.username } });
});

// ---- Users/Friends ----
app.get("/api/users/search", requireAuth, (req: AuthRequest, res) => {
  const q = String(req.query.q ?? "").trim();
  const me = req.userId!;
  if (!q) {
    res.json({ users: [] });
    return;
  }
  const rows = db
    .prepare(
      `SELECT id, username FROM users
       WHERE username LIKE ? AND id <> ?
       ORDER BY username ASC LIMIT 20`
    )
    .all(`${q}%`, me) as Array<{ id: string; username: string }>;
  res.json({ users: rows });
});

app.get("/api/friends", requireAuth, (req: AuthRequest, res) => {
  const me = req.userId!;
  const rows = db
    .prepare(
      `SELECT f.created_at, u.id, u.username
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.user_a_id = ? THEN f.user_b_id ELSE f.user_a_id END
       WHERE f.user_a_id = ? OR f.user_b_id = ?
       ORDER BY u.username ASC`
    )
    .all(me, me, me) as Array<{ id: string; username: string; created_at: string }>;
  res.json({ friends: rows.map((r) => ({ id: r.id, username: r.username, since: r.created_at })) });
});

app.post("/api/friends/requests", requireAuth, (req: AuthRequest, res) => {
  const fromUserId = req.userId!;
  const toUserId = String(req.body?.toUserId ?? "").trim();
  if (!toUserId || toUserId === fromUserId) {
    res.status(400).json({ error: "invalid target user" });
    return;
  }
  const target = getUserById(toUserId);
  if (!target) {
    res.status(404).json({ error: "target user not found" });
    return;
  }
  if (isFriend(fromUserId, toUserId)) {
    res.status(409).json({ error: "already friends" });
    return;
  }

  const pending = db
    .prepare(
      `SELECT id FROM friend_requests
       WHERE status = 'pending'
         AND ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))`
    )
    .get(fromUserId, toUserId, toUserId, fromUserId) as { id: string } | undefined;
  if (pending) {
    res.status(409).json({ error: "friend request already pending" });
    return;
  }

  const requestId = newId("fr");
  const ts = nowIso();
  db.prepare(
    `INSERT INTO friend_requests (id, from_user_id, to_user_id, status, created_at, responded_at)
     VALUES (?, ?, ?, 'pending', ?, NULL)`
  ).run(requestId, fromUserId, toUserId, ts);

  realtime.notifyLobbyUsers([fromUserId, toUserId], "friend_request_created");
  res.status(201).json({
    request: { id: requestId, fromUserId, toUserId, status: "pending", createdAt: ts },
  });
});

app.get("/api/friends/requests/incoming", requireAuth, (req: AuthRequest, res) => {
  const me = req.userId!;
  const rows = db
    .prepare(
      `SELECT fr.*, u.username AS from_username
       FROM friend_requests fr
       JOIN users u ON u.id = fr.from_user_id
       WHERE fr.to_user_id = ? AND fr.status = 'pending'
       ORDER BY fr.created_at DESC`
    )
    .all(me) as Array<any>;
  res.json({ requests: rows });
});

app.get("/api/friends/requests/outgoing", requireAuth, (req: AuthRequest, res) => {
  const me = req.userId!;
  const rows = db
    .prepare(
      `SELECT fr.*, u.username AS to_username
       FROM friend_requests fr
       JOIN users u ON u.id = fr.to_user_id
       WHERE fr.from_user_id = ? AND fr.status = 'pending'
       ORDER BY fr.created_at DESC`
    )
    .all(me) as Array<any>;
  res.json({ requests: rows });
});

app.post("/api/friends/requests/:id/accept", requireAuth, (req: AuthRequest, res) => {
  const me = req.userId!;
  const id = req.params.id;
  const fr = db
    .prepare("SELECT * FROM friend_requests WHERE id = ?")
    .get(id) as any;
  if (!fr || fr.status !== "pending") {
    res.status(404).json({ error: "request not found" });
    return;
  }
  if (fr.to_user_id !== me) {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  const ts = nowIso();
  const { userA, userB } = normalizeFriendPair(fr.from_user_id, fr.to_user_id);
  const tx = db.transaction(() => {
    db.prepare("UPDATE friend_requests SET status = 'accepted', responded_at = ? WHERE id = ?").run(ts, id);
    db.prepare("INSERT OR IGNORE INTO friendships (id, user_a_id, user_b_id, created_at) VALUES (?, ?, ?, ?)").run(
      newId("friend"),
      userA,
      userB,
      ts
    );
  });
  tx();

  const friendship = db
    .prepare("SELECT * FROM friendships WHERE user_a_id = ? AND user_b_id = ?")
    .get(userA, userB) as any;
  realtime.notifyLobbyUsers([fr.from_user_id, fr.to_user_id], "friend_request_accepted");
  res.json({ friendship });
});

app.post("/api/friends/requests/:id/decline", requireAuth, (req: AuthRequest, res) => {
  const me = req.userId!;
  const id = req.params.id;
  const fr = db
    .prepare("SELECT * FROM friend_requests WHERE id = ?")
    .get(id) as any;
  if (!fr || fr.status !== "pending") {
    res.status(404).json({ error: "request not found" });
    return;
  }
  if (fr.to_user_id !== me) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  db.prepare("UPDATE friend_requests SET status = 'declined', responded_at = ? WHERE id = ?").run(nowIso(), id);
  realtime.notifyLobbyUsers([fr.from_user_id, fr.to_user_id], "friend_request_declined");
  res.json({ ok: true });
});

// ---- Game invites ----
app.post("/api/game-invites", requireAuth, (req: AuthRequest, res) => {
  const fromUserId = req.userId!;
  const toUserId = String(req.body?.toUserId ?? "").trim();
  const mode = String(req.body?.mode ?? "") as GameMode;
  const customSetupId = req.body?.customSetupId ? String(req.body.customSetupId) : null;

  if (!toUserId || toUserId === fromUserId) {
    res.status(400).json({ error: "invalid target user" });
    return;
  }
  if (!["chess", "epistemate", "custom"].includes(mode)) {
    res.status(400).json({ error: "invalid mode" });
    return;
  }
  if (mode === "custom" && !customSetupId) {
    res.status(400).json({ error: "customSetupId is required for custom mode" });
    return;
  }
  if (!isFriend(fromUserId, toUserId)) {
    res.status(403).json({ error: "can only invite friends" });
    return;
  }
  if (mode === "custom") {
    const setup = getDoc("setup", fromUserId, customSetupId!);
    if (!setup) {
      res.status(404).json({ error: "custom setup not found" });
      return;
    }
  }

  const pending = db
    .prepare(
      `SELECT id FROM game_invites
       WHERE status = 'pending'
         AND ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))`
    )
    .get(fromUserId, toUserId, toUserId, fromUserId) as { id: string } | undefined;
  if (pending) {
    res.status(409).json({ error: "invite already pending" });
    return;
  }

  const ts = nowIso();
  const inviteId = newId("invite");
  const expiresAt = addMinutes(ts, INVITE_EXPIRY_MINUTES);
  db.prepare(
    `INSERT INTO game_invites
      (id, from_user_id, to_user_id, mode, custom_setup_id, status, expires_at, created_at, responded_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, NULL)`
  ).run(inviteId, fromUserId, toUserId, mode, customSetupId, expiresAt, ts);

  realtime.notifyLobbyUsers([fromUserId, toUserId], "game_invite_created");
  res.status(201).json({
    invite: { id: inviteId, fromUserId, toUserId, mode, customSetupId, status: "pending", expiresAt, createdAt: ts },
  });
});

app.get("/api/game-invites/incoming", requireAuth, (req: AuthRequest, res) => {
  const me = req.userId!;
  const rows = db
    .prepare(
      `SELECT gi.*, u.username AS from_username
       FROM game_invites gi
       JOIN users u ON u.id = gi.from_user_id
       WHERE gi.to_user_id = ? AND gi.status = 'pending'
       ORDER BY gi.created_at DESC`
    )
    .all(me) as Array<any>;
  const now = nowIso();
  res.json({ invites: rows.filter((r) => r.expires_at > now) });
});

app.get("/api/game-invites/outgoing", requireAuth, (req: AuthRequest, res) => {
  const me = req.userId!;
  const rows = db
    .prepare(
      `SELECT gi.*, u.username AS to_username
       FROM game_invites gi
       JOIN users u ON u.id = gi.to_user_id
       WHERE gi.from_user_id = ? AND gi.status = 'pending'
       ORDER BY gi.created_at DESC`
    )
    .all(me) as Array<any>;
  const now = nowIso();
  res.json({ invites: rows.filter((r) => r.expires_at > now) });
});

app.post("/api/game-invites/:id/accept", requireAuth, (req: AuthRequest, res) => {
  const me = req.userId!;
  const inviteId = req.params.id;
  const invite = db
    .prepare("SELECT * FROM game_invites WHERE id = ?")
    .get(inviteId) as any;
  if (!invite || invite.status !== "pending") {
    res.status(404).json({ error: "invite not found" });
    return;
  }
  if (invite.to_user_id !== me) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (invite.expires_at <= nowIso()) {
    db.prepare("UPDATE game_invites SET status = 'expired', responded_at = ? WHERE id = ?").run(nowIso(), inviteId);
    res.status(409).json({ error: "invite expired" });
    return;
  }

  const ts = nowIso();
  try {
    const { gameId } = createGameFromInvite(invite.mode, invite.from_user_id, invite.to_user_id, invite.custom_setup_id);
    db.prepare("UPDATE game_invites SET status = 'accepted', responded_at = ? WHERE id = ?").run(ts, inviteId);
    realtime.notifyLobbyUsers([invite.from_user_id, invite.to_user_id], "game_invite_accepted");
    realtime.pushGameUpdate(gameId, "game_created");
    const game = db.prepare("SELECT * FROM games WHERE id = ?").get(gameId);
    res.status(201).json({ game });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post("/api/game-invites/:id/decline", requireAuth, (req: AuthRequest, res) => {
  const me = req.userId!;
  const invite = db.prepare("SELECT * FROM game_invites WHERE id = ?").get(req.params.id) as any;
  if (!invite || invite.status !== "pending") {
    res.status(404).json({ error: "invite not found" });
    return;
  }
  if (invite.to_user_id !== me) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  db.prepare("UPDATE game_invites SET status = 'declined', responded_at = ? WHERE id = ?").run(nowIso(), req.params.id);
  realtime.notifyLobbyUsers([invite.from_user_id, invite.to_user_id], "game_invite_declined");
  res.json({ ok: true });
});

app.post("/api/game-invites/:id/cancel", requireAuth, (req: AuthRequest, res) => {
  const me = req.userId!;
  const invite = db.prepare("SELECT * FROM game_invites WHERE id = ?").get(req.params.id) as any;
  if (!invite || invite.status !== "pending") {
    res.status(404).json({ error: "invite not found" });
    return;
  }
  if (invite.from_user_id !== me) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  db.prepare("UPDATE game_invites SET status = 'cancelled', responded_at = ? WHERE id = ?").run(nowIso(), req.params.id);
  realtime.notifyLobbyUsers([invite.from_user_id, invite.to_user_id], "game_invite_cancelled");
  res.json({ ok: true });
});

// ---- Games ----
app.get("/api/games", requireAuth, (req: AuthRequest, res) => {
  const me = req.userId!;
  const status = req.query.status ? String(req.query.status) : null;
  let rows: any[] = [];
  if (!status) {
    rows = db
      .prepare(
        `SELECT * FROM games
         WHERE (white_user_id = ? OR black_user_id = ?)
         ORDER BY updated_at DESC`
      )
      .all(me, me) as any[];
  } else if (status === "active") {
    rows = db
      .prepare(
        `SELECT * FROM games
         WHERE (white_user_id = ? OR black_user_id = ?) AND status IN ('active', 'draft')
         ORDER BY updated_at DESC`
      )
      .all(me, me) as any[];
  } else {
    rows = db
      .prepare(
        `SELECT * FROM games
         WHERE (white_user_id = ? OR black_user_id = ?) AND status = ?
         ORDER BY updated_at DESC`
      )
      .all(me, me, status) as any[];
  }
  res.json({ games: rows });
});

app.get("/api/games/:id", requireAuth, (req: AuthRequest, res) => {
  const me = req.userId!;
  const game = db.prepare("SELECT * FROM games WHERE id = ?").get(req.params.id) as any;
  if (!game) {
    res.status(404).json({ error: "game not found" });
    return;
  }
  if (game.white_user_id !== me && game.black_user_id !== me) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  res.json({ game });
});

app.get("/api/games/:id/state", requireAuth, (req: AuthRequest, res) => {
  const me = req.userId!;
  const game = db.prepare("SELECT * FROM games WHERE id = ?").get(req.params.id) as any;
  if (!game) {
    res.status(404).json({ error: "game not found" });
    return;
  }
  if (game.white_user_id !== me && game.black_user_id !== me) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  res.json({ state: JSON.parse(game.state_json) });
});

app.get("/api/games/:id/moves", requireAuth, (req: AuthRequest, res) => {
  const me = req.userId!;
  const game = db.prepare("SELECT * FROM games WHERE id = ?").get(req.params.id) as any;
  if (!game) {
    res.status(404).json({ error: "game not found" });
    return;
  }
  if (game.white_user_id !== me && game.black_user_id !== me) {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  const from = Math.max(0, Number(req.query.from ?? 0) || 0);
  const limit = Math.max(1, Math.min(200, Number(req.query.limit ?? 100) || 100));
  const rows = db
    .prepare(
      `SELECT * FROM game_moves
       WHERE game_id = ? AND ply >= ?
       ORDER BY ply ASC LIMIT ?`
    )
    .all(req.params.id, from, limit);
  res.json({ moves: rows });
});

app.post("/api/games/:id/draft/buy", requireAuth, (req: AuthRequest, res) => {
  const me = req.userId!;
  const pieceId = String(req.body?.pieceId ?? "").trim();
  const delta = Number(req.body?.delta ?? 0);
  if (!pieceId || !Number.isFinite(delta)) {
    res.status(400).json({ error: "pieceId and delta are required" });
    return;
  }
  const game = db.prepare("SELECT * FROM games WHERE id = ?").get(req.params.id) as any;
  if (!game) {
    res.status(404).json({ error: "game not found" });
    return;
  }
  const side = gameSideForUser(game, me);
  if (!side) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (game.mode !== "epistemate" || game.status !== "draft") {
    res.status(409).json({ error: "game is not in epistemate draft" });
    return;
  }

  try {
    const setup = JSON.parse(game.setup_json) as GameSetup;
    const draft = parseEpistemateDraft(JSON.parse(game.state_json));
    const nextDraft = adjustDraftBuy(setup, draft, side, pieceId, delta);
    db.prepare("UPDATE games SET state_json = ?, current_turn_side = ?, updated_at = ? WHERE id = ?").run(
      JSON.stringify(nextDraft),
      nextDraft.activeSide,
      nowIso(),
      game.id
    );
    realtime.pushGameUpdate(game.id, "draft_buy_adjusted");
    res.json({ ok: true });
  } catch (err) {
    res.status(409).json({ error: (err as Error).message });
  }
});

app.post("/api/games/:id/draft/place", requireAuth, (req: AuthRequest, res) => {
  const me = req.userId!;
  const typeId = String(req.body?.typeId ?? "").trim();
  const x = Number(req.body?.x);
  const y = Number(req.body?.y);
  if (!typeId || !Number.isFinite(x) || !Number.isFinite(y)) {
    res.status(400).json({ error: "typeId, x and y are required" });
    return;
  }
  const game = db.prepare("SELECT * FROM games WHERE id = ?").get(req.params.id) as any;
  if (!game) {
    res.status(404).json({ error: "game not found" });
    return;
  }
  const side = gameSideForUser(game, me);
  if (!side) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (game.mode !== "epistemate" || game.status !== "draft") {
    res.status(409).json({ error: "game is not in epistemate draft" });
    return;
  }

  try {
    const setup = JSON.parse(game.setup_json) as GameSetup;
    const board = JSON.parse(game.board_json) as BoardDefinition;
    const draft = parseEpistemateDraft(JSON.parse(game.state_json));
    const nextDraft = placeFromPool(setup, board, draft, side, typeId, Math.trunc(x), Math.trunc(y));
    db.prepare("UPDATE games SET state_json = ?, current_turn_side = ?, updated_at = ? WHERE id = ?").run(
      JSON.stringify(nextDraft),
      nextDraft.activeSide,
      nowIso(),
      game.id
    );
    realtime.pushGameUpdate(game.id, "draft_piece_placed");
    res.json({ ok: true });
  } catch (err) {
    res.status(409).json({ error: (err as Error).message });
  }
});

app.post("/api/games/:id/draft/move", requireAuth, (req: AuthRequest, res) => {
  const me = req.userId!;
  const instanceId = String(req.body?.instanceId ?? "").trim();
  const x = Number(req.body?.x);
  const y = Number(req.body?.y);
  if (!instanceId || !Number.isFinite(x) || !Number.isFinite(y)) {
    res.status(400).json({ error: "instanceId, x and y are required" });
    return;
  }
  const game = db.prepare("SELECT * FROM games WHERE id = ?").get(req.params.id) as any;
  if (!game) {
    res.status(404).json({ error: "game not found" });
    return;
  }
  const side = gameSideForUser(game, me);
  if (!side) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (game.mode !== "epistemate" || game.status !== "draft") {
    res.status(409).json({ error: "game is not in epistemate draft" });
    return;
  }

  try {
    const board = JSON.parse(game.board_json) as BoardDefinition;
    const draft = parseEpistemateDraft(JSON.parse(game.state_json));
    const nextDraft = movePlacedPiece(board, draft, side, instanceId, Math.trunc(x), Math.trunc(y));
    db.prepare("UPDATE games SET state_json = ?, current_turn_side = ?, updated_at = ? WHERE id = ?").run(
      JSON.stringify(nextDraft),
      nextDraft.activeSide,
      nowIso(),
      game.id
    );
    realtime.pushGameUpdate(game.id, "draft_piece_moved");
    res.json({ ok: true });
  } catch (err) {
    res.status(409).json({ error: (err as Error).message });
  }
});

app.post("/api/games/:id/draft/takeback", requireAuth, (req: AuthRequest, res) => {
  const me = req.userId!;
  const instanceId = String(req.body?.instanceId ?? "").trim();
  if (!instanceId) {
    res.status(400).json({ error: "instanceId is required" });
    return;
  }
  const game = db.prepare("SELECT * FROM games WHERE id = ?").get(req.params.id) as any;
  if (!game) {
    res.status(404).json({ error: "game not found" });
    return;
  }
  const side = gameSideForUser(game, me);
  if (!side) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (game.mode !== "epistemate" || game.status !== "draft") {
    res.status(409).json({ error: "game is not in epistemate draft" });
    return;
  }

  try {
    const draft = parseEpistemateDraft(JSON.parse(game.state_json));
    const nextDraft = takeBackPlacedPiece(draft, side, instanceId);
    db.prepare("UPDATE games SET state_json = ?, current_turn_side = ?, updated_at = ? WHERE id = ?").run(
      JSON.stringify(nextDraft),
      nextDraft.activeSide,
      nowIso(),
      game.id
    );
    realtime.pushGameUpdate(game.id, "draft_piece_takeback");
    res.json({ ok: true });
  } catch (err) {
    res.status(409).json({ error: (err as Error).message });
  }
});

app.post("/api/games/:id/draft/confirm", requireAuth, (req: AuthRequest, res) => {
  const me = req.userId!;
  const game = db.prepare("SELECT * FROM games WHERE id = ?").get(req.params.id) as any;
  if (!game) {
    res.status(404).json({ error: "game not found" });
    return;
  }
  const side = gameSideForUser(game, me);
  if (!side) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (game.mode !== "epistemate" || game.status !== "draft") {
    res.status(409).json({ error: "game is not in epistemate draft" });
    return;
  }

  try {
    const setup = JSON.parse(game.setup_json) as GameSetup;
    const board = JSON.parse(game.board_json) as BoardDefinition;
    const draft = parseEpistemateDraft(JSON.parse(game.state_json));
    const result = confirmDraftPhase(setup, board, draft, side);
    const ts = nowIso();
    if (result.kind === "draft") {
      db.prepare("UPDATE games SET state_json = ?, current_turn_side = ?, updated_at = ? WHERE id = ?").run(
        JSON.stringify(result.draft),
        result.draft.activeSide,
        ts,
        game.id
      );
      realtime.pushGameUpdate(game.id, "draft_phase_confirmed");
      res.json({ ok: true, status: "draft" });
      return;
    }

    db.prepare(
      `UPDATE games SET
        status = 'active',
        setup_json = ?,
        state_json = ?,
        current_turn_side = ?,
        updated_at = ?,
        draw_offered_by_user_id = NULL,
        winner_user_id = NULL
       WHERE id = ?`
    ).run(
      JSON.stringify(result.setup),
      JSON.stringify(result.state),
      result.nextTurnSide,
      ts,
      game.id
    );

    realtime.pushGameUpdate(game.id, "draft_completed_game_started");
    res.json({ ok: true, status: "active" });
  } catch (err) {
    res.status(409).json({ error: (err as Error).message });
  }
});

app.post("/api/games/:id/moves", requireAuth, (req: AuthRequest, res) => {
  const me = req.userId!;
  const move = req.body?.move as CompactMove | undefined;
  if (!move) {
    res.status(400).json({ error: "move is required" });
    return;
  }

  const game = db.prepare("SELECT * FROM games WHERE id = ?").get(req.params.id) as any;
  if (!game) {
    res.status(404).json({ error: "game not found" });
    return;
  }
  if (game.white_user_id !== me && game.black_user_id !== me) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (game.status !== "active") {
    res.status(409).json({ error: "game is not active" });
    return;
  }
  if (currentTurnUserId(game) !== me) {
    res.status(409).json({ error: "not your turn" });
    return;
  }

  try {
    const currentState = deserializeGame(JSON.parse(game.state_json));
    const nextState = applyMove(currentState, move);
    const serializedNext = serializeGame(nextState);
    const ply = nextState.moveHistory.length;
    const ts = nowIso();

    db.transaction(() => {
      db.prepare(
        `UPDATE games SET
          state_json = ?,
          current_turn_side = ?,
          status = ?,
          winner_user_id = ?,
          draw_offered_by_user_id = NULL,
          updated_at = ?
         WHERE id = ?`
      ).run(
        JSON.stringify(serializedNext),
        nextState.sides[nextState.currentTurnIndex],
        nextState.status === "finished"
          ? nextState.winnerSide
            ? "finished"
            : "draw"
          : "active",
        nextState.status === "finished"
          ? nextState.winnerSide === "white"
            ? game.white_user_id
            : nextState.winnerSide === "black"
              ? game.black_user_id
              : null
          : null,
        ts,
        game.id
      );

      db.prepare(
        `INSERT INTO game_moves (id, game_id, ply, actor_user_id, move_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(newId("gm"), game.id, ply, me, JSON.stringify(move), ts);
    })();

    realtime.pushGameUpdate(game.id, "move_applied");
    res.json({ appliedMove: move, nextState: serializedNext, gameStatus: nextState.status });
  } catch (err) {
    res.status(409).json({ error: `illegal move: ${(err as Error).message}` });
  }
});

app.post("/api/games/:id/resign", requireAuth, (req: AuthRequest, res) => {
  const me = req.userId!;
  const game = db.prepare("SELECT * FROM games WHERE id = ?").get(req.params.id) as any;
  if (!game) {
    res.status(404).json({ error: "game not found" });
    return;
  }
  if (game.white_user_id !== me && game.black_user_id !== me) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (game.status !== "active") {
    res.status(409).json({ error: "game is not active" });
    return;
  }

  const winnerUserId = otherUserId(game, me);
  db.prepare("UPDATE games SET status = 'finished', winner_user_id = ?, updated_at = ? WHERE id = ?").run(
    winnerUserId,
    nowIso(),
    game.id
  );
  realtime.pushGameUpdate(game.id, "resign");
  res.json({ ok: true, winnerUserId });
});

app.post("/api/games/:id/draw-offer", requireAuth, (req: AuthRequest, res) => {
  const me = req.userId!;
  const game = db.prepare("SELECT * FROM games WHERE id = ?").get(req.params.id) as any;
  if (!game) {
    res.status(404).json({ error: "game not found" });
    return;
  }
  if (game.white_user_id !== me && game.black_user_id !== me) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (game.status !== "active") {
    res.status(409).json({ error: "game is not active" });
    return;
  }
  if (game.draw_offered_by_user_id) {
    res.status(409).json({ error: "draw already offered" });
    return;
  }
  db.prepare("UPDATE games SET draw_offered_by_user_id = ?, updated_at = ? WHERE id = ?").run(me, nowIso(), game.id);
  realtime.pushGameUpdate(game.id, "draw_offer");
  res.json({ ok: true });
});

app.post("/api/games/:id/draw-accept", requireAuth, (req: AuthRequest, res) => {
  const me = req.userId!;
  const game = db.prepare("SELECT * FROM games WHERE id = ?").get(req.params.id) as any;
  if (!game) {
    res.status(404).json({ error: "game not found" });
    return;
  }
  if (game.white_user_id !== me && game.black_user_id !== me) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (game.status !== "active") {
    res.status(409).json({ error: "game is not active" });
    return;
  }
  if (!game.draw_offered_by_user_id || game.draw_offered_by_user_id === me) {
    res.status(409).json({ error: "no opponent draw offer" });
    return;
  }
  db.prepare(
    "UPDATE games SET status = 'draw', draw_offered_by_user_id = NULL, updated_at = ? WHERE id = ?"
  ).run(nowIso(), game.id);
  realtime.pushGameUpdate(game.id, "draw_accepted");
  res.json({ ok: true });
});

app.post("/api/games/:id/draw-decline", requireAuth, (req: AuthRequest, res) => {
  const me = req.userId!;
  const game = db.prepare("SELECT * FROM games WHERE id = ?").get(req.params.id) as any;
  if (!game) {
    res.status(404).json({ error: "game not found" });
    return;
  }
  if (game.white_user_id !== me && game.black_user_id !== me) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (game.status !== "active") {
    res.status(409).json({ error: "game is not active" });
    return;
  }
  if (!game.draw_offered_by_user_id || game.draw_offered_by_user_id === me) {
    res.status(409).json({ error: "no opponent draw offer" });
    return;
  }
  db.prepare("UPDATE games SET draw_offered_by_user_id = NULL, updated_at = ? WHERE id = ?").run(nowIso(), game.id);
  realtime.pushGameUpdate(game.id, "draw_declined");
  res.json({ ok: true });
});

// ---- Existing local docs APIs, now auth-gated ----
function putDocRoute<T extends { id: string; name: string }>(kind: "piece_type" | "board" | "setup") {
  return (req: AuthRequest, res: express.Response) => {
    const userId = req.userId!;
    const body = req.body as T;
    if (!body?.id) {
      res.status(400).json({ error: "Missing id" });
      return;
    }
    upsertDoc(kind, userId, body.id, assertName(body.name), body);
    res.json(body);
  };
}

function postDocRoute<T extends { id?: string; name?: string }>(kind: "piece_type" | "board" | "setup", idPrefix: string) {
  return (req: AuthRequest, res: express.Response) => {
    const userId = req.userId!;
    const body = req.body as T;
    const id = body.id ?? newId(idPrefix);
    const entity = { ...body, id, name: assertName(body.name) };
    upsertDoc(kind, userId, id, entity.name, entity);
    res.status(201).json(entity);
  };
}

app.get("/api/piece-types", requireAuth, (req: AuthRequest, res) => {
  res.json(listDocs("piece_type", req.userId!));
});
app.post("/api/piece-types", requireAuth, postDocRoute<Partial<PieceTypeDefinition>>("piece_type", "piece"));
app.put("/api/piece-types/:id", requireAuth, putDocRoute<PieceTypeDefinition>("piece_type"));
app.delete("/api/piece-types/:id", requireAuth, (req: AuthRequest, res) => {
  const ok = deleteDoc("piece_type", req.userId!, req.params.id);
  res.json({ ok });
});

app.get("/api/boards", requireAuth, (req: AuthRequest, res) => {
  res.json(listDocs("board", req.userId!));
});
app.post("/api/boards", requireAuth, postDocRoute<Partial<BoardDefinition>>("board", "board"));
app.put("/api/boards/:id", requireAuth, putDocRoute<BoardDefinition>("board"));
app.delete("/api/boards/:id", requireAuth, (req: AuthRequest, res) => {
  const ok = deleteDoc("board", req.userId!, req.params.id);
  res.json({ ok });
});

app.get("/api/setups", requireAuth, (req: AuthRequest, res) => {
  res.json(listDocs("setup", req.userId!));
});
app.post("/api/setups", requireAuth, postDocRoute<Partial<GameSetup>>("setup", "setup"));
app.put("/api/setups/:id", requireAuth, putDocRoute<GameSetup>("setup"));
app.delete("/api/setups/:id", requireAuth, (req: AuthRequest, res) => {
  const ok = deleteDoc("setup", req.userId!, req.params.id);
  res.json({ ok });
});

app.get("/api/setup-bundle/:id", requireAuth, (req: AuthRequest, res) => {
  const userId = req.userId!;
  const setupId = req.params.id;

  let ownerUserId = userId;
  let setup = getDoc("setup", ownerUserId, setupId) as GameSetup | null;

  // Built-in presets are stored under demo user; allow loading them for all users.
  if (!setup && ["setup_classic_8x8", "setup_epistemate", "setup_demo"].includes(setupId)) {
    ownerUserId = DEMO_USER_ID;
    setup = getDoc("setup", ownerUserId, setupId) as GameSetup | null;
  }

  if (!setup) {
    res.status(404).json({ error: "setup not found" });
    return;
  }

  const board = getDoc("board", ownerUserId, setup.boardId) as BoardDefinition | null;
  if (!board) {
    res.status(404).json({ error: "board for setup not found" });
    return;
  }

  res.json({ setup, board, pieceTypes: setup.pieceTypes });
});

httpServer.listen(PORT, HOST, () => {
  console.log(`[cv-server] listening on http://${HOST}:${PORT}`);
});
