import type { PieceInstance, PieceTypeDefinition } from "@cv/shared";
import type { CompactMove, GameState } from "./types.js";
import { normalizeDirection } from "./gcd.js";
import { asNumber, directionClass, isUntargetablePiece } from "./customRules.js";

export type HookContext = {
  state: GameState;
  piece: PieceInstance;
  typeDef: PieceTypeDefinition;
  moves: CompactMove[];
};

export type PieceHookFn = (ctx: HookContext) => CompactMove[];

function inBounds(state: GameState, x: number, y: number): boolean {
  return x >= 0 && x < state.board.width && y >= 0 && y < state.board.height;
}

function resolveVectorForSide(piece: PieceInstance, dx: number, dy: number, relativeToSide?: boolean): { dx: number; dy: number } {
  if (!relativeToSide) return { dx, dy };
  const sideFactor = piece.side === "black" ? 1 : piece.side === "white" ? -1 : 1;
  return { dx, dy: dy * sideFactor };
}

function pieceAttacksSquare(state: GameState, piece: PieceInstance, targetX: number, targetY: number): boolean {
  const typeDef = state.pieceTypes.get(piece.typeId);
  if (!typeDef) return false;
  if (isUntargetablePiece(state, piece) && typeDef.pieceHooks?.includes("nietzscheStatic")) return false;

  const patterns = typeDef.captureRules.length > 0 ? typeDef.captureRules : typeDef.movementRules;
  for (const pattern of patterns) {
    if (pattern.moveOnly) continue;
    const hasMoved = Boolean(piece.state.hasMoved);
    if (pattern.firstMoveOnly && hasMoved) continue;
    if (pattern.requiresUnmoved && hasMoved) continue;

    for (const v of pattern.vectors) {
      const resolved = resolveVectorForSide(piece, v.dx, v.dy, pattern.relativeToSide);
      const dx = resolved.dx;
      const dy = resolved.dy;

      if (pattern.kind === "slide") {
        let i = 1;
        while (true) {
          const x = piece.x + i * dx;
          const y = piece.y + i * dy;
          if (!inBounds(state, x, y)) break;
          const occId = state.occupancy.get(`${x},${y}`);
          if (x === targetX && y === targetY) return true;
          if (occId) break;
          i += 1;
        }
      } else {
        const maxR = pattern.range ?? 1;
        for (let k = 1; k <= maxR; k++) {
          const x = piece.x + k * dx;
          const y = piece.y + k * dy;
          if (!inBounds(state, x, y)) break;

          if (pattern.kind === "step" && (pattern.blockers === "all" || pattern.blockers === "first")) {
            let blocked = false;
            for (let j = 1; j < k; j++) {
              const ix = piece.x + j * dx;
              const iy = piece.y + j * dy;
              if (state.occupancy.has(`${ix},${iy}`)) {
                blocked = true;
                break;
              }
            }
            if (blocked) break;
          }

          if (pattern.kind === "jump" && pattern.blockers === "all") {
            let blocked = false;
            for (let j = 1; j < k; j++) {
              const ix = piece.x + j * dx;
              const iy = piece.y + j * dy;
              if (state.occupancy.has(`${ix},${iy}`)) {
                blocked = true;
                break;
              }
            }
            if (blocked) continue;
          }

          if (x === targetX && y === targetY) return true;
          if (pattern.kind === "step" && state.occupancy.has(`${x},${y}`)) break;
        }
      }
    }
  }
  return false;
}

function isSquareAttackedByOpponent(state: GameState, side: string, x: number, y: number): boolean {
  for (const p of state.pieces.values()) {
    if (p.side === side) continue;
    if (pieceAttacksSquare(state, p, x, y)) return true;
  }
  return false;
}

function stageAllowsMove(piece: PieceInstance, move: CompactMove, stageName: string): boolean {
  const dx = move.to.x - move.from.x;
  const dy = move.to.y - move.from.y;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  const forward = piece.side === "black" ? 1 : -1;

  if (stageName === "pawn") {
    if (move.captureId) return adx === 1 && dy === forward;
    if (dx !== 0) return false;
    if (dy === forward) return true;
    if (dy === 2 * forward) return !Boolean(piece.state.hasMoved);
    return false;
  }
  if (stageName === "knight") return (adx === 1 && ady === 2) || (adx === 2 && ady === 1);
  if (stageName === "bishop") return adx === ady && adx > 0;
  if (stageName === "rook") return (dx === 0) !== (dy === 0);
  if (stageName === "queen") return stageAllowsMove(piece, move, "rook") || stageAllowsMove(piece, move, "bishop");
  return true;
}

export const pieceHookRegistry: Record<string, PieceHookFn> = {
  noRepeatDirection: (ctx) => {
    const raw = ctx.piece.state.lastMoveDirection as { dx: number; dy: number } | undefined | null;
    if (raw == null || typeof raw.dx !== "number" || typeof raw.dy !== "number") return ctx.moves;
    return ctx.moves.filter((m) => {
      const ddx = m.to.x - m.from.x;
      const ddy = m.to.y - m.from.y;
      const norm = normalizeDirection(ddx, ddy);
      if (!norm) return false;
      return !(norm.dx === raw.dx && norm.dy === raw.dy);
    });
  },
  hegelDialectic: (ctx) => {
    const last = ctx.piece.state.lastDirectionClass;
    if (typeof last !== "string") return ctx.moves;
    return ctx.moves.filter((m) => directionClass(m.to.x - m.from.x, m.to.y - m.from.y) !== last);
  },
  nietzscheStatic: () => [],
  vygotskyEvolution: (ctx) => {
    const seq =
      ctx.typeDef.behavior?.stageSequence && ctx.typeDef.behavior.stageSequence.length > 0
        ? ctx.typeDef.behavior.stageSequence
        : ["pawn", "knight", "bishop", "rook", "queen"];
    const stageIndex = Math.max(0, Math.min(seq.length - 1, Math.floor(asNumber(ctx.piece.state.stageIndex, 0))));
    return ctx.moves.filter((m) => stageAllowsMove(ctx.piece, m, seq[stageIndex]));
  },
  skinnerReinforce: (ctx) => {
    const mustRepeat = Boolean(ctx.piece.state.mustRepeatAfterReward);
    if (!mustRepeat) return ctx.moves;
    const vec = ctx.piece.state.lastMoveVector as { dx: number; dy: number } | undefined;
    if (!vec || typeof vec.dx !== "number" || typeof vec.dy !== "number") return ctx.moves;
    const forced = ctx.moves.filter((m) => m.to.x - m.from.x === vec.dx && m.to.y - m.from.y === vec.dy);
    return forced.length > 0 ? forced : ctx.moves;
  },
  attentionSpanLocal: (ctx) => {
    const radius = Math.max(1, Math.floor(asNumber(ctx.typeDef.behavior?.attentionRadius, 1)));
    return ctx.moves.filter((m) => Math.max(Math.abs(m.to.x - m.from.x), Math.abs(m.to.y - m.from.y)) <= radius);
  },
  castleLike: (ctx) => {
    const piece = ctx.piece;
    const state = ctx.state;
    if (piece.state.hasMoved) return ctx.moves;

    const out = [...ctx.moves];
    const rookType = "rook";
    const candidates = [
      { rookX: 0, kingToX: piece.x - 2, rookToX: piece.x - 1 },
      { rookX: state.board.width - 1, kingToX: piece.x + 2, rookToX: piece.x + 1 },
    ];

    for (const c of candidates) {
      if (c.kingToX < 0 || c.kingToX >= state.board.width) continue;
      if (c.rookToX < 0 || c.rookToX >= state.board.width) continue;

      const rookId = state.occupancy.get(`${c.rookX},${piece.y}`);
      if (!rookId) continue;
      const rook = state.pieces.get(rookId);
      if (!rook || rook.side !== piece.side || rook.typeId !== rookType || rook.state.hasMoved) continue;

      const minX = Math.min(piece.x, c.rookX);
      const maxX = Math.max(piece.x, c.rookX);
      let blocked = false;
      for (let x = minX + 1; x < maxX; x++) {
        if (state.occupancy.has(`${x},${piece.y}`)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      if (state.occupancy.has(`${c.kingToX},${piece.y}`)) continue;
      if (state.occupancy.has(`${c.rookToX},${piece.y}`)) continue;

      const stepDir = c.kingToX > piece.x ? 1 : -1;
      const throughX = piece.x + stepDir;
      const fromAttacked = isSquareAttackedByOpponent(state, piece.side, piece.x, piece.y);
      const throughAttacked = isSquareAttackedByOpponent(state, piece.side, throughX, piece.y);
      const toAttacked = isSquareAttackedByOpponent(state, piece.side, c.kingToX, piece.y);
      if (fromAttacked || throughAttacked || toAttacked) continue;

      out.push({
        pieceId: piece.instanceId,
        from: { x: piece.x, y: piece.y },
        to: { x: c.kingToX, y: piece.y },
        companionMove: {
          pieceId: rook.instanceId,
          from: { x: rook.x, y: rook.y },
          to: { x: c.rookToX, y: piece.y },
        },
      });
    }

    return out;
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
