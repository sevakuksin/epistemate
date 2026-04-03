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
};

export type GameState = {
  board: BoardDefinition;
  sides: Side[];
  currentTurnIndex: number;
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
