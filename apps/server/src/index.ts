import cors from "cors";
import express from "express";
import { db, deleteDoc, getDoc, listDocs, newId, nowIso, upsertDoc } from "./db.js";
import { DEMO_USER_ID, ensureDemoPreset } from "./sampleData.js";

type PieceTypeDefinition = {
  id: string;
  name: string;
  [k: string]: unknown;
};
type BoardDefinition = { id: string; name: string; width: number; height: number; [k: string]: unknown };
type GameSetup = { id: string; name: string; boardId: string; pieceTypes: PieceTypeDefinition[]; [k: string]: unknown };

type User = {
  id: string;
  username: string;
};

type AuthRequest = express.Request & { userId?: string };

function withAuth(req: AuthRequest, _res: express.Response, next: express.NextFunction): void {
  req.userId = String(req.header("x-user-id") || DEMO_USER_ID);
  next();
}

function assertName(value: unknown, fallback = "Untitled"): string {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return fallback;
}

function putDocRoute<T extends { id: string; name: string }>(kind: "piece_type" | "board" | "setup") {
  return (req: AuthRequest, res: express.Response) => {
    const userId = req.userId ?? DEMO_USER_ID;
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
    const userId = req.userId ?? DEMO_USER_ID;
    const body = req.body as T;
    const id = body.id ?? newId(idPrefix);
    const entity = { ...body, id, name: assertName(body.name) };
    upsertDoc(kind, userId, id, entity.name, entity);
    res.status(201).json(entity);
  };
}

const PORT = Number(process.env.PORT) || 3001;
ensureDemoPreset();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));
app.use("/api", withAuth);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "cv-server" });
});

app.post("/api/session", (req, res) => {
  const username = String(req.body?.username ?? "").trim();
  if (!username) {
    res.status(400).json({ error: "username is required" });
    return;
  }
  const existing = db.prepare("SELECT id, username FROM users WHERE username = ?").get(username) as User | undefined;
  if (existing) {
    res.json(existing);
    return;
  }
  const user: User = { id: newId("user"), username };
  db.prepare("INSERT INTO users (id, username, created_at) VALUES (?, ?, ?)").run(user.id, user.username, nowIso());
  res.status(201).json(user);
});

app.get("/api/piece-types", (req: AuthRequest, res) => {
  res.json(listDocs("piece_type", req.userId ?? DEMO_USER_ID));
});
app.post("/api/piece-types", postDocRoute<Partial<PieceTypeDefinition>>("piece_type", "piece"));
app.put("/api/piece-types/:id", putDocRoute<PieceTypeDefinition>("piece_type"));
app.delete("/api/piece-types/:id", (req: AuthRequest, res) => {
  const ok = deleteDoc("piece_type", req.userId ?? DEMO_USER_ID, req.params.id);
  res.json({ ok });
});

app.get("/api/boards", (req: AuthRequest, res) => {
  res.json(listDocs("board", req.userId ?? DEMO_USER_ID));
});
app.post("/api/boards", postDocRoute<Partial<BoardDefinition>>("board", "board"));
app.put("/api/boards/:id", putDocRoute<BoardDefinition>("board"));
app.delete("/api/boards/:id", (req: AuthRequest, res) => {
  const ok = deleteDoc("board", req.userId ?? DEMO_USER_ID, req.params.id);
  res.json({ ok });
});

app.get("/api/setups", (req: AuthRequest, res) => {
  res.json(listDocs("setup", req.userId ?? DEMO_USER_ID));
});
app.post("/api/setups", postDocRoute<Partial<GameSetup>>("setup", "setup"));
app.put("/api/setups/:id", putDocRoute<GameSetup>("setup"));
app.delete("/api/setups/:id", (req: AuthRequest, res) => {
  const ok = deleteDoc("setup", req.userId ?? DEMO_USER_ID, req.params.id);
  res.json({ ok });
});

app.get("/api/setup-bundle/:id", (req: AuthRequest, res) => {
  const userId = req.userId ?? DEMO_USER_ID;
  const setup = getDoc("setup", userId, req.params.id) as GameSetup | null;
  if (!setup) {
    res.status(404).json({ error: "setup not found" });
    return;
  }
  const board = getDoc("board", userId, setup.boardId) as BoardDefinition | null;
  if (!board) {
    res.status(404).json({ error: "board for setup not found" });
    return;
  }
  res.json({ setup, board, pieceTypes: setup.pieceTypes });
});

app.listen(PORT, () => {
  console.log(`[cv-server] http://localhost:${PORT}`);
});
