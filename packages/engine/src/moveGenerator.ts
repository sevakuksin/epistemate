import type { Pattern, PieceInstance } from "@cv/shared";
import type { CompactMove, GameState } from "./types.js";
import { coordKey } from "./types.js";
import { applyPieceHooks } from "./hooks.js";

function inBounds(x: number, y: number, w: number, h: number): boolean {
  return x >= 0 && x < w && y >= 0 && y < h;
}

function patternAllowed(
  pattern: Pattern,
  wantEmpty: boolean
): boolean {
  if (wantEmpty && pattern.captureOnly) return false;
  if (!wantEmpty && pattern.moveOnly) return false;
  return true;
}

function shouldSkipUnmoved(pattern: Pattern, hasMoved: boolean): boolean {
  if (pattern.firstMoveOnly && hasMoved) return true;
  if (pattern.requiresUnmoved && hasMoved) return true;
  return false;
}

function expandPattern(
  state: GameState,
  piece: PieceInstance,
  pattern: Pattern,
  wantEmpty: boolean
): CompactMove[] {
  if (!patternAllowed(pattern, wantEmpty)) return [];
  const hasMoved = Boolean(piece.state.hasMoved);
  if (shouldSkipUnmoved(pattern, hasMoved)) return [];

  const { width, height } = state.board;
  const { x, y } = piece;
  const out: CompactMove[] = [];
  const sideFactor = piece.side === "black" ? 1 : piece.side === "white" ? -1 : 1;

  for (const v of pattern.vectors) {
    const dx = v.dx;
    const dy = pattern.relativeToSide ? v.dy * sideFactor : v.dy;
    if (pattern.kind === "slide") {
      let i = 1;
      for (;;) {
        const nx = x + i * dx;
        const ny = y + i * dy;
        if (!inBounds(nx, ny, width, height)) break;
        const occId = state.occupancy.get(coordKey({ x: nx, y: ny }));
        if (!occId) {
          if (wantEmpty) {
            out.push({
              pieceId: piece.instanceId,
              from: { x, y },
              to: { x: nx, y: ny },
            });
          }
          i += 1;
          continue;
        }
        const occ = state.pieces.get(occId);
        if (occ && occ.side !== piece.side) {
          if (!wantEmpty) {
            out.push({
              pieceId: piece.instanceId,
              from: { x, y },
              to: { x: nx, y: ny },
              captureId: occId,
            });
          }
        }
        break;
      }
    } else if (pattern.kind === "step") {
      const maxR = pattern.range ?? 1;
      for (let k = 1; k <= maxR; k++) {
        const nx = x + k * dx;
        const ny = y + k * dy;
        if (!inBounds(nx, ny, width, height)) break;
        if (pattern.blockers === "all" || pattern.blockers === "first") {
          let blocked = false;
          for (let j = 1; j < k; j++) {
            const ix = x + j * dx;
            const iy = y + j * dy;
            if (state.occupancy.has(coordKey({ x: ix, y: iy }))) {
              blocked = true;
              break;
            }
          }
          if (blocked) break;
        }
        const occId = state.occupancy.get(coordKey({ x: nx, y: ny }));
        if (!occId) {
          if (wantEmpty) {
            out.push({
              pieceId: piece.instanceId,
              from: { x, y },
              to: { x: nx, y: ny },
            });
          }
        } else {
          const occ = state.pieces.get(occId);
          if (occ && occ.side !== piece.side && !wantEmpty) {
            out.push({
              pieceId: piece.instanceId,
              from: { x, y },
              to: { x: nx, y: ny },
              captureId: occId,
            });
          }
          break;
        }
      }
    } else {
      // jump — only destination; blockers "none" ignores path
      const maxR = pattern.range ?? 1;
      for (let k = 1; k <= maxR; k++) {
        const nx = x + k * dx;
        const ny = y + k * dy;
        if (!inBounds(nx, ny, width, height)) break;
        if (pattern.blockers === "all") {
          let blocked = false;
          for (let j = 1; j < k; j++) {
            const ix = x + j * dx;
            const iy = y + j * dy;
            if (state.occupancy.has(coordKey({ x: ix, y: iy }))) {
              blocked = true;
              break;
            }
          }
          if (blocked) continue;
        }
        const occId = state.occupancy.get(coordKey({ x: nx, y: ny }));
        if (!occId) {
          if (wantEmpty) {
            out.push({
              pieceId: piece.instanceId,
              from: { x, y },
              to: { x: nx, y: ny },
            });
          }
        } else {
          const occ = state.pieces.get(occId);
          if (occ && occ.side !== piece.side && !wantEmpty) {
            out.push({
              pieceId: piece.instanceId,
              from: { x, y },
              to: { x: nx, y: ny },
              captureId: occId,
            });
          }
        }
      }
    }
  }

  return out;
}

function dedupeMoves(moves: CompactMove[]): CompactMove[] {
  const seen = new Set<string>();
  const out: CompactMove[] = [];
  for (const m of moves) {
    const c = m.companionMove;
    const key = `${m.pieceId}|${m.to.x},${m.to.y}|${m.captureId ?? ""}|${c?.pieceId ?? ""}|${c?.to.x ?? ""},${c?.to.y ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

export function generatePseudoLegalMoves(state: GameState, pieceId: string): CompactMove[] {
  if (state.status !== "ongoing") return [];
  const piece = state.pieces.get(pieceId);
  if (!piece) return [];
  const currentSide = state.sides[state.currentTurnIndex];
  if (piece.side !== currentSide) return [];

  const typeDef = state.pieceTypes.get(piece.typeId);
  if (!typeDef) return [];

  const movePatterns =
    typeDef.movementRules.length > 0 ? typeDef.movementRules : typeDef.captureRules;
  const capPatterns =
    typeDef.captureRules.length > 0 ? typeDef.captureRules : typeDef.movementRules;

  if (movePatterns.length === 0 && capPatterns.length === 0) return [];

  const collected: CompactMove[] = [];

  for (const p of movePatterns) {
    collected.push(...expandPattern(state, piece, p, true));
  }
  for (const p of capPatterns) {
    collected.push(...expandPattern(state, piece, p, false));
  }

  const merged = dedupeMoves(collected);
  return applyPieceHooks(state, piece, merged);
}
