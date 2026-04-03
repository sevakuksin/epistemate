import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const dbPath = process.env.DATABASE_PATH ?? path.resolve(process.cwd(), "data", "app.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

export type StoredDocKind = "piece_type" | "board" | "setup";

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
`);

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
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
