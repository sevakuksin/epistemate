import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const dbPath = process.env.DATABASE_PATH ?? path.resolve(process.cwd(), "data", "app.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db: any = new Database(dbPath);
db.pragma("journal_mode = WAL");

export type StoredDocKind = "piece_type" | "board" | "setup";

function ensureColumn(table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS docs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_docs_kind_user ON docs(kind, user_id);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS friend_requests (
  id TEXT PRIMARY KEY,
  from_user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  responded_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_friend_requests_to ON friend_requests(to_user_id, status);
CREATE INDEX IF NOT EXISTS idx_friend_requests_from ON friend_requests(from_user_id, status);

CREATE TABLE IF NOT EXISTS friendships (
  id TEXT PRIMARY KEY,
  user_a_id TEXT NOT NULL,
  user_b_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_a_id, user_b_id)
);
CREATE INDEX IF NOT EXISTS idx_friendships_a ON friendships(user_a_id);
CREATE INDEX IF NOT EXISTS idx_friendships_b ON friendships(user_b_id);

CREATE TABLE IF NOT EXISTS game_invites (
  id TEXT PRIMARY KEY,
  from_user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  custom_setup_id TEXT,
  status TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  responded_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_game_invites_to ON game_invites(to_user_id, status);
CREATE INDEX IF NOT EXISTS idx_game_invites_from ON game_invites(from_user_id, status);

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  white_user_id TEXT NOT NULL,
  black_user_id TEXT NOT NULL,
  current_turn_side TEXT NOT NULL,
  winner_user_id TEXT,
  draw_offered_by_user_id TEXT,
  board_json TEXT NOT NULL,
  setup_json TEXT NOT NULL,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
CREATE INDEX IF NOT EXISTS idx_games_white ON games(white_user_id, status);
CREATE INDEX IF NOT EXISTS idx_games_black ON games(black_user_id, status);

CREATE TABLE IF NOT EXISTS game_moves (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  ply INTEGER NOT NULL,
  actor_user_id TEXT NOT NULL,
  move_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_game_moves_game ON game_moves(game_id, ply);
`);

ensureColumn("users", "password_hash", "password_hash TEXT");

export function nowIso(): string {
  return new Date().toISOString();
}

export function addMinutes(iso: string, minutes: number): string {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeFriendPair(a: string, b: string): { userA: string; userB: string } {
  return a < b ? { userA: a, userB: b } : { userA: b, userB: a };
}

export function upsertDoc(kind: StoredDocKind, userId: string, id: string, name: string, json: unknown): void {
  const ts = nowIso();
  db.prepare(
    `
    INSERT INTO docs (id, kind, user_id, name, json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      kind=excluded.kind,
      user_id=excluded.user_id,
      name=excluded.name,
      json=excluded.json,
      updated_at=excluded.updated_at
    `
  ).run(id, kind, userId, name, JSON.stringify(json), ts, ts);
}

export function listDocs(kind: StoredDocKind, userId: string): unknown[] {
  const rows = db
    .prepare("SELECT json FROM docs WHERE kind = ? AND user_id = ? ORDER BY updated_at DESC")
    .all(kind, userId) as Array<{ json: string }>;
  return rows.map((r) => JSON.parse(r.json));
}

export function getDoc(kind: StoredDocKind, userId: string, id: string): unknown | null {
  const row = db
    .prepare("SELECT json FROM docs WHERE kind = ? AND user_id = ? AND id = ?")
    .get(kind, userId, id) as { json: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.json);
}

export function deleteDoc(kind: StoredDocKind, userId: string, id: string): boolean {
  const result = db.prepare("DELETE FROM docs WHERE kind = ? AND user_id = ? AND id = ?").run(kind, userId, id);
  return result.changes > 0;
}
