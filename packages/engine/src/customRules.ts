import type { PieceInstance, PieceTypeDefinition } from "@cv/shared";
import type { GameState } from "./types.js";

export function pieceTypeHasHook(typeDef: PieceTypeDefinition | undefined, hookId: string): boolean {
  return Boolean(typeDef?.pieceHooks?.includes(hookId));
}

export function getPieceType(state: GameState, piece: PieceInstance): PieceTypeDefinition | undefined {
  return state.pieceTypes.get(piece.typeId);
}

export function isUntargetablePieceType(typeDef: PieceTypeDefinition | undefined): boolean {
  return (
    pieceTypeHasHook(typeDef, "nietzscheStatic") ||
    Boolean(typeDef?.tags?.includes("untargetable"))
  );
}

export function isUntargetablePiece(state: GameState, piece: PieceInstance): boolean {
  return isUntargetablePieceType(getPieceType(state, piece));
}

export function directionClass(dx: number, dy: number): "horizontal" | "vertical" | "diagonal" | "other" {
  if (dy === 0 && dx !== 0) return "horizontal";
  if (dx === 0 && dy !== 0) return "vertical";
  if (Math.abs(dx) === Math.abs(dy) && dx !== 0) return "diagonal";
  return "other";
}

export function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

