import type { BoardDefinition, GameSetup, PieceTypeDefinition } from "@cv/shared";
import type { CompactMove } from "@cv/engine";

export type User = { id: string; username: string };
export type SetupBundle = {
  setup: GameSetup;
  board: BoardDefinition;
  pieceTypes: PieceTypeDefinition[];
};

export type Friend = { id: string; username: string; since: string };
export type FriendRequest = {
  id: string;
  from_user_id: string;
  to_user_id: string;
  status: "pending" | "accepted" | "declined";
  from_username?: string;
  to_username?: string;
  created_at: string;
};

export type GameInvite = {
  id: string;
  from_user_id: string;
  to_user_id: string;
  mode: "chess" | "epistemate" | "custom";
  custom_setup_id?: string | null;
  status: string;
  expires_at: string;
  created_at: string;
  from_username?: string;
  to_username?: string;
};

export type GameRecord = {
  id: string;
  mode: "chess" | "epistemate" | "custom";
  status: "active" | "finished" | "draw";
  white_user_id: string;
  black_user_id: string;
  current_turn_side: "white" | "black";
  winner_user_id?: string | null;
  draw_offered_by_user_id?: string | null;
  board_json: string;
  setup_json: string;
  state_json: string;
  created_at: string;
  updated_at: string;
};

async function request<T>(path: string, options: RequestInit = {}, userId?: string): Promise<T> {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(options.headers ?? {}),
  };
  if (userId) headers["x-user-id"] = userId;
  const res = await fetch(path, { ...options, headers, credentials: "include" });
  if (!res.ok) {
    let reason = `Request failed: ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) reason = String(body.error);
    } catch {
      // noop
    }
    throw new Error(reason);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  register(username: string, password: string, registrationCode: string) {
    return request<{ user: User }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password, registrationCode }),
    });
  },
  login(username: string, password: string) {
    return request<{ user: User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  },
  logout() {
    return request<void>("/api/auth/logout", { method: "POST" });
  },
  me() {
    return request<{ user: User }>("/api/auth/me");
  },
  searchUsers(q: string) {
    return request<{ users: User[] }>(`/api/users/search?q=${encodeURIComponent(q)}`);
  },
  listFriends() {
    return request<{ friends: Friend[] }>("/api/friends");
  },
  sendFriendRequest(toUserId: string) {
    return request<{ request: FriendRequest }>("/api/friends/requests", {
      method: "POST",
      body: JSON.stringify({ toUserId }),
    });
  },
  incomingFriendRequests() {
    return request<{ requests: FriendRequest[] }>("/api/friends/requests/incoming");
  },
  outgoingFriendRequests() {
    return request<{ requests: FriendRequest[] }>("/api/friends/requests/outgoing");
  },
  acceptFriendRequest(id: string) {
    return request<{ friendship: unknown }>(`/api/friends/requests/${id}/accept`, { method: "POST" });
  },
  declineFriendRequest(id: string) {
    return request<{ ok: boolean }>(`/api/friends/requests/${id}/decline`, { method: "POST" });
  },
  sendGameInvite(toUserId: string, mode: "chess" | "epistemate" | "custom", customSetupId?: string) {
    return request<{ invite: GameInvite }>("/api/game-invites", {
      method: "POST",
      body: JSON.stringify({ toUserId, mode, customSetupId }),
    });
  },
  incomingInvites() {
    return request<{ invites: GameInvite[] }>("/api/game-invites/incoming");
  },
  outgoingInvites() {
    return request<{ invites: GameInvite[] }>("/api/game-invites/outgoing");
  },
  acceptInvite(id: string) {
    return request<{ game: GameRecord }>(`/api/game-invites/${id}/accept`, { method: "POST" });
  },
  declineInvite(id: string) {
    return request<{ ok: boolean }>(`/api/game-invites/${id}/decline`, { method: "POST" });
  },
  cancelInvite(id: string) {
    return request<{ ok: boolean }>(`/api/game-invites/${id}/cancel`, { method: "POST" });
  },
  listGames(status?: "active" | "finished" | "draw") {
    const suffix = status ? `?status=${status}` : "";
    return request<{ games: GameRecord[] }>(`/api/games${suffix}`);
  },
  getGame(gameId: string) {
    return request<{ game: GameRecord }>(`/api/games/${gameId}`);
  },
  gameState(gameId: string) {
    return request<{ state: any }>(`/api/games/${gameId}/state`);
  },
  gameMoves(gameId: string, from = 0, limit = 100) {
    return request<{ moves: any[] }>(`/api/games/${gameId}/moves?from=${from}&limit=${limit}`);
  },
  playMove(gameId: string, move: CompactMove) {
    return request<{ appliedMove: CompactMove; nextState: any; gameStatus: string }>(`/api/games/${gameId}/moves`, {
      method: "POST",
      body: JSON.stringify({ move }),
    });
  },
  resign(gameId: string) {
    return request<{ ok: boolean }>(`/api/games/${gameId}/resign`, { method: "POST" });
  },
  offerDraw(gameId: string) {
    return request<{ ok: boolean }>(`/api/games/${gameId}/draw-offer`, { method: "POST" });
  },
  acceptDraw(gameId: string) {
    return request<{ ok: boolean }>(`/api/games/${gameId}/draw-accept`, { method: "POST" });
  },
  declineDraw(gameId: string) {
    return request<{ ok: boolean }>(`/api/games/${gameId}/draw-decline`, { method: "POST" });
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
