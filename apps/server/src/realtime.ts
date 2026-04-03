import type { Server as HttpServer, IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { db, nowIso } from "./db.js";

type ServerEvent =
  | { type: "welcome"; userId: string; serverTime: string }
  | { type: "presence"; onlineUserIds: string[] }
  | { type: "lobby_updated"; reason: string }
  | { type: "game_updated"; gameId: string; reason: string; updatedAt: string }
  | { type: "game_snapshot"; gameId: string; game: any; state: any; reason: string }
  | { type: "error"; message: string };

type ClientEvent =
  | { type: "subscribe_game"; gameId: string }
  | { type: "unsubscribe_game"; gameId: string }
  | { type: "sync_game"; gameId: string }
  | { type: "ping" };

type SocketMeta = {
  userId: string;
  isAlive: boolean;
  gameIds: Set<string>;
};

type RealtimeApi = {
  close: () => void;
  notifyLobbyUsers: (userIds: string[], reason: string) => void;
  pushGameUpdate: (gameId: string, reason: string) => void;
};

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

function getSessionUserIdFromReq(req: IncomingMessage): string | null {
  const cookies = parseCookies(req.headers.cookie);
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

function safeSend(ws: WebSocket, event: ServerEvent): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(event));
}

function normalizeUnique(values: string[]): string[] {
  return [...new Set(values)];
}

export function initRealtime(server: HttpServer): RealtimeApi {
  const wss = new WebSocketServer({ server, path: "/ws" });
  const metas = new WeakMap<WebSocket, SocketMeta>();
  const userSockets = new Map<string, Set<WebSocket>>();
  const gameSockets = new Map<string, Set<WebSocket>>();

  function onlineUserIds(): string[] {
    return [...userSockets.entries()]
      .filter(([, sockets]) => sockets.size > 0)
      .map(([uid]) => uid);
  }

  function broadcastPresence(): void {
    const payload: ServerEvent = { type: "presence", onlineUserIds: onlineUserIds() };
    for (const sockets of userSockets.values()) {
      for (const ws of sockets) safeSend(ws, payload);
    }
  }

  function addUserSocket(userId: string, ws: WebSocket): void {
    if (!userSockets.has(userId)) userSockets.set(userId, new Set());
    userSockets.get(userId)!.add(ws);
  }

  function removeUserSocket(userId: string, ws: WebSocket): void {
    const set = userSockets.get(userId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) userSockets.delete(userId);
  }

  function subscribeGame(ws: WebSocket, userId: string, gameId: string): void {
    const game = db
      .prepare("SELECT * FROM games WHERE id = ?")
      .get(gameId) as any;
    if (!game) {
      safeSend(ws, { type: "error", message: "game not found" });
      return;
    }
    if (game.white_user_id !== userId && game.black_user_id !== userId) {
      safeSend(ws, { type: "error", message: "forbidden" });
      return;
    }

    if (!gameSockets.has(gameId)) gameSockets.set(gameId, new Set());
    gameSockets.get(gameId)!.add(ws);
    const meta = metas.get(ws);
    if (meta) meta.gameIds.add(gameId);

    safeSend(ws, {
      type: "game_snapshot",
      gameId,
      game,
      state: JSON.parse(game.state_json),
      reason: "subscribe",
    });
  }

  function unsubscribeGame(ws: WebSocket, gameId: string): void {
    const set = gameSockets.get(gameId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) gameSockets.delete(gameId);
    const meta = metas.get(ws);
    if (meta) meta.gameIds.delete(gameId);
  }

  function removeSocketFromAllGames(ws: WebSocket): void {
    const meta = metas.get(ws);
    if (!meta) return;
    for (const gid of meta.gameIds) {
      const set = gameSockets.get(gid);
      if (!set) continue;
      set.delete(ws);
      if (set.size === 0) gameSockets.delete(gid);
    }
    meta.gameIds.clear();
  }

  function sendLobbyUpdate(userId: string, reason: string): void {
    const sockets = userSockets.get(userId);
    if (!sockets) return;
    for (const ws of sockets) {
      safeSend(ws, { type: "lobby_updated", reason });
    }
  }

  function notifyLobbyUsers(userIds: string[], reason: string): void {
    for (const uid of normalizeUnique(userIds)) sendLobbyUpdate(uid, reason);
  }

  function pushGameUpdate(gameId: string, reason: string): void {
    const game = db
      .prepare("SELECT * FROM games WHERE id = ?")
      .get(gameId) as any;
    if (!game) return;

    const payload: ServerEvent = {
      type: "game_snapshot",
      gameId,
      game,
      state: JSON.parse(game.state_json),
      reason,
    };

    const subs = gameSockets.get(gameId);
    if (subs) {
      for (const ws of subs) safeSend(ws, payload);
    }

    const gameUpdated: ServerEvent = {
      type: "game_updated",
      gameId,
      reason,
      updatedAt: game.updated_at,
    };
    for (const uid of normalizeUnique([game.white_user_id, game.black_user_id])) {
      const sockets = userSockets.get(uid);
      if (!sockets) continue;
      for (const ws of sockets) safeSend(ws, gameUpdated);
    }
  }

  wss.on("connection", (ws, req) => {
    const userId = getSessionUserIdFromReq(req);
    if (!userId) {
      ws.close(4401, "unauthorized");
      return;
    }

    metas.set(ws, { userId, isAlive: true, gameIds: new Set() });
    addUserSocket(userId, ws);

    safeSend(ws, { type: "welcome", userId, serverTime: nowIso() });
    safeSend(ws, { type: "presence", onlineUserIds: onlineUserIds() });
    broadcastPresence();

    ws.on("pong", () => {
      const meta = metas.get(ws);
      if (meta) meta.isAlive = true;
    });

    ws.on("message", (raw) => {
      let msg: ClientEvent | null = null;
      try {
        msg = JSON.parse(String(raw)) as ClientEvent;
      } catch {
        safeSend(ws, { type: "error", message: "bad json" });
        return;
      }

      if (!msg || typeof msg !== "object" || !("type" in msg)) {
        safeSend(ws, { type: "error", message: "bad message" });
        return;
      }

      const meta = metas.get(ws);
      if (!meta) return;

      if (msg.type === "subscribe_game" && typeof msg.gameId === "string") {
        subscribeGame(ws, meta.userId, msg.gameId);
        return;
      }
      if (msg.type === "unsubscribe_game" && typeof msg.gameId === "string") {
        unsubscribeGame(ws, msg.gameId);
        return;
      }
      if (msg.type === "sync_game" && typeof msg.gameId === "string") {
        subscribeGame(ws, meta.userId, msg.gameId);
        return;
      }
      if (msg.type === "ping") {
        safeSend(ws, { type: "welcome", userId: meta.userId, serverTime: nowIso() });
        return;
      }

      safeSend(ws, { type: "error", message: "unknown event type" });
    });

    ws.on("close", () => {
      const meta = metas.get(ws);
      if (!meta) return;
      removeSocketFromAllGames(ws);
      removeUserSocket(meta.userId, ws);
      broadcastPresence();
    });
  });

  const heartbeat = setInterval(() => {
    for (const sockets of userSockets.values()) {
      for (const ws of sockets) {
        const meta = metas.get(ws);
        if (!meta) continue;
        if (!meta.isAlive) {
          ws.terminate();
          continue;
        }
        meta.isAlive = false;
        ws.ping();
      }
    }
  }, 25000);

  return {
    close() {
      clearInterval(heartbeat);
      wss.close();
    },
    notifyLobbyUsers,
    pushGameUpdate,
  };
}
