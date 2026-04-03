import type { BoardDefinition, GameSetup, PieceTypeDefinition } from "@cv/shared";

export type User = { id: string; username: string };
export type SetupBundle = {
  setup: GameSetup;
  board: BoardDefinition;
  pieceTypes: PieceTypeDefinition[];
};

async function request<T>(path: string, options: RequestInit = {}, userId?: string): Promise<T> {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(options.headers ?? {}),
  };
  if (userId) headers["x-user-id"] = userId;
  const res = await fetch(path, { ...options, headers });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  createSession(username: string) {
    return request<User>("/api/session", {
      method: "POST",
      body: JSON.stringify({ username }),
    });
  },
  listPieceTypes(userId: string) {
    return request<PieceTypeDefinition[]>("/api/piece-types", {}, userId);
  },
  savePieceType(userId: string, piece: PieceTypeDefinition) {
    return request<PieceTypeDefinition>(`/api/piece-types/${piece.id}`, {
      method: "PUT",
      body: JSON.stringify(piece),
    }, userId);
  },
  listBoards(userId: string) {
    return request<BoardDefinition[]>("/api/boards", {}, userId);
  },
  saveBoard(userId: string, board: BoardDefinition) {
    return request<BoardDefinition>(`/api/boards/${board.id}`, {
      method: "PUT",
      body: JSON.stringify(board),
    }, userId);
  },
  listSetups(userId: string) {
    return request<GameSetup[]>("/api/setups", {}, userId);
  },
  saveSetup(userId: string, setup: GameSetup) {
    return request<GameSetup>(`/api/setups/${setup.id}`, {
      method: "PUT",
      body: JSON.stringify(setup),
    }, userId);
  },
  getSetupBundle(userId: string, setupId: string) {
    return request<SetupBundle>(`/api/setup-bundle/${setupId}`, {}, userId);
  },
};
