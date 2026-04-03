import type { PieceInstance, PieceTypeDefinition } from "@cv/shared";
import type { CompactMove, GameState } from "./types.js";
import { normalizeDirection } from "./gcd.js";

export type HookContext = {
  state: GameState;
  piece: PieceInstance;
  typeDef: PieceTypeDefinition;
  moves: CompactMove[];
};

export type PieceHookFn = (ctx: HookContext) => CompactMove[];

export const pieceHookRegistry: Record<string, PieceHookFn> = {
  noRepeatDirection: (ctx) => {
    const raw = ctx.piece.state.lastMoveDirection as
      | { dx: number; dy: number }
      | undefined
      | null;
    if (raw == null || typeof raw.dx !== "number" || typeof raw.dy !== "number") {
      return ctx.moves;
    }
    return ctx.moves.filter((m) => {
      const ddx = m.to.x - m.from.x;
      const ddy = m.to.y - m.from.y;
      const norm = normalizeDirection(ddx, ddy);
      if (!norm) return false;
      return !(norm.dx === raw.dx && norm.dy === raw.dy);
    });
  },
};

export function applyPieceHooks(state: GameState, piece: PieceInstance, moves: CompactMove[]): CompactMove[] {
  const typeDef = state.pieceTypes.get(piece.typeId);
  if (!typeDef) return moves;
  const hooks = typeDef.pieceHooks ?? [];
  let out = moves;
  for (const hookId of hooks) {
    const fn = pieceHookRegistry[hookId];
    if (!fn) continue;
    out = fn({ state, piece, typeDef, moves: out });
  }
  return out;
}
