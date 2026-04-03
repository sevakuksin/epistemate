import type {
  BoardDefinition,
  PieceInstance,
  PieceTypeDefinition,
  Side,
  WinCondition,
} from "@cv/shared";

export type Coord = { x: number; y: number };

export type GameStatus = "ongoing" | "finished";

export type CompactMove = {
  pieceId: string;
  from: Coord;
  to: Coord;
  /** Captured piece id if any */
  captureId?: string;
  /** Optional compound movement, e.g. castling rook shift */
  companionMove?: {
    pieceId: string;
    from: Coord;
    to: Coord;
  };
};

export type GameState = {
  board: BoardDefinition;
  sides: Side[];
  currentTurnIndex: number;
  turnNumber: number;
  pieceTypes: Map<string, PieceTypeDefinition>;
  pieces: Map<string, PieceInstance>;
  occupancy: Map<string, string>;
  moveHistory: CompactMove[];
  capturedPieces: PieceInstance[];
  status: GameStatus;
  winnerSide: Side | null;
  winCondition: WinCondition;
};

export function coordKey(c: Coord): string {
  return `${c.x},${c.y}`;
}
