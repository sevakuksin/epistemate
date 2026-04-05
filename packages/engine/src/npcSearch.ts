import type { CompactMove, GameState } from "./types.js";
import { applyMove } from "./game.js";
import { generatePseudoLegalMoves } from "./moveGenerator.js";
import { isKingSquareAttacked } from "./hooks.js";
import { evaluateForRoot } from "./npcEval.js";

/** Max extra plies from capture/check extensions along one root line. */
export const MAX_EXTENSION_PLIES = 2;

const QUIESCENCE_DEPTH = 5;

export function collectAllLegalMoves(state: GameState): CompactMove[] {
  const side = state.sides[state.currentTurnIndex];
  const out: CompactMove[] = [];
  for (const piece of state.pieces.values()) {
    if (piece.side !== side) continue;
    out.push(...generatePseudoLegalMoves(state, piece.instanceId));
  }
  return out;
}

function orderMovesForSearch(moves: CompactMove[]): CompactMove[] {
  return [...moves].sort((a, b) => {
    const ca = a.captureId ? 1 : 0;
    const cb = b.captureId ? 1 : 0;
    return cb - ca;
  });
}

/**
 * Quiescence moves: any capture, or any move that leaves the opponent's king attacked
 * (side to move after the move is in "check" in the usual sense).
 * Order: checks before non-check captures (better pruning); within checks, captures before quiet checks.
 */
export function orderMovesForQuiescence(state: GameState): CompactMove[] {
  const all = collectAllLegalMoves(state);
  const scored: { move: CompactMove; givesCheck: boolean; isCapture: boolean }[] = [];

  for (const move of all) {
    const next = applyMove(state, move, { skipRandomSlip: true });
    const isCapture = Boolean(move.captureId);

    if (next.status === "finished") {
      if (isCapture) scored.push({ move, givesCheck: false, isCapture: true });
      continue;
    }

    const nextSide = next.sides[next.currentTurnIndex];
    const givesCheck = isKingSquareAttacked(next, nextSide);
    if (!givesCheck && !isCapture) continue;

    scored.push({ move, givesCheck, isCapture });
  }

  scored.sort((a, b) => {
    if (a.givesCheck !== b.givesCheck) return (b.givesCheck ? 1 : 0) - (a.givesCheck ? 1 : 0);
    if (a.isCapture !== b.isCapture) return (b.isCapture ? 1 : 0) - (a.isCapture ? 1 : 0);
    return 0;
  });

  return scored.map((s) => s.move);
}

function quiescence(
  state: GameState,
  alpha: number,
  beta: number,
  qDepth: number,
  rootSide: string,
  deadline: number
): number {
  if (Date.now() > deadline) return evaluateForRoot(state, rootSide);
  if (state.status === "finished") return evaluateForRoot(state, rootSide);

  const stm = state.sides[state.currentTurnIndex];
  const maximizing = stm === rootSide;
  const standPat = evaluateForRoot(state, rootSide);

  if (qDepth <= 0) return standPat;

  const tactical = orderMovesForQuiescence(state);

  if (maximizing) {
    let best = standPat;
    let a = Math.max(alpha, standPat);
    if (a >= beta) return best;
    for (const move of tactical) {
      const next = applyMove(state, move, { skipRandomSlip: true });
      const score = quiescence(next, a, beta, qDepth - 1, rootSide, deadline);
      best = Math.max(best, score);
      a = Math.max(a, score);
      if (a >= beta) break;
    }
    return best;
  }

  let best = standPat;
  let b = Math.min(beta, standPat);
  if (alpha >= b) return best;
  for (const move of tactical) {
    const next = applyMove(state, move, { skipRandomSlip: true });
    const score = quiescence(next, alpha, b, qDepth - 1, rootSide, deadline);
    best = Math.min(best, score);
    b = Math.min(b, score);
    if (alpha >= b) break;
  }
  return best;
}

function minimax(
  state: GameState,
  depth: number,
  alpha: number,
  beta: number,
  extUsed: number,
  rootSide: string,
  deadline: number
): number {
  if (Date.now() > deadline) return evaluateForRoot(state, rootSide);
  if (state.status === "finished") return evaluateForRoot(state, rootSide);

  const stm = state.sides[state.currentTurnIndex];
  const maximizing = stm === rootSide;

  const moves = orderMovesForSearch(collectAllLegalMoves(state));
  if (moves.length === 0) {
    return evaluateForRoot(state, rootSide);
  }

  if (depth <= 0) {
    return quiescence(state, alpha, beta, QUIESCENCE_DEPTH, rootSide, deadline);
  }

  if (maximizing) {
    let best = -Infinity;
    for (const move of moves) {
      const next = applyMove(state, move, { skipRandomSlip: true });
      const nextSide = next.sides[next.currentTurnIndex];
      let ext = 0;
      if (next.status === "ongoing") {
        const givesCheck = isKingSquareAttacked(next, nextSide);
        if ((move.captureId || givesCheck) && extUsed < MAX_EXTENSION_PLIES) {
          ext = 1;
        }
      }
      const childDepth = depth - 1 + ext;
      const score = minimax(next, childDepth, alpha, beta, extUsed + ext, rootSide, deadline);
      best = Math.max(best, score);
      alpha = Math.max(alpha, score);
      if (alpha >= beta) break;
    }
    return best;
  }

  let best = Infinity;
  for (const move of moves) {
    const next = applyMove(state, move, { skipRandomSlip: true });
    const nextSide = next.sides[next.currentTurnIndex];
    let ext = 0;
    if (next.status === "ongoing") {
      const givesCheck = isKingSquareAttacked(next, nextSide);
      if ((move.captureId || givesCheck) && extUsed < MAX_EXTENSION_PLIES) {
        ext = 1;
      }
    }
    const childDepth = depth - 1 + ext;
    const score = minimax(next, childDepth, alpha, beta, extUsed + ext, rootSide, deadline);
    best = Math.min(best, score);
    beta = Math.min(beta, score);
    if (alpha >= beta) break;
  }
  return best;
}

function searchAtRoot(
  state: GameState,
  depth: number,
  rootSide: string,
  deadline: number
): { move: CompactMove | null; score: number } {
  const moves = orderMovesForSearch(collectAllLegalMoves(state));
  if (moves.length === 0) return { move: null, score: evaluateForRoot(state, rootSide) };

  let bestMove: CompactMove | null = moves[0];
  let bestScore = -Infinity;
  let alpha = -Infinity;
  const beta = Infinity;

  for (const move of moves) {
    const next = applyMove(state, move, { skipRandomSlip: true });
    const nextSide = next.sides[next.currentTurnIndex];
    let ext = 0;
    if (next.status === "ongoing") {
      const givesCheck = isKingSquareAttacked(next, nextSide);
      if ((move.captureId || givesCheck) && 0 < MAX_EXTENSION_PLIES) {
        ext = 1;
      }
    }
    const childDepth = depth - 1 + ext;
    const score = minimax(next, childDepth, alpha, beta, ext, rootSide, deadline);
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
    alpha = Math.max(alpha, score);
  }

  return { move: bestMove, score: bestScore };
}

/**
 * Best reply for the side to move in `state` (must be the NPC / searcher).
 * Search uses applyMove(..., { skipRandomSlip: true }) internally.
 */
export function findBestMove(
  state: GameState,
  options: { timeMs: number; maxDepth?: number }
): { move: CompactMove | null; score: number } {
  const deadline = Date.now() + options.timeMs;
  const maxDepth = options.maxDepth ?? 8;
  const rootSide = state.sides[state.currentTurnIndex];
  const moves = collectAllLegalMoves(state);
  if (moves.length === 0) {
    return { move: null, score: evaluateForRoot(state, rootSide) };
  }

  let bestMove: CompactMove | null = null;
  let bestScore = -Infinity;

  for (let depth = 1; depth <= maxDepth; depth++) {
    if (Date.now() > deadline) break;
    const { move, score } = searchAtRoot(state, depth, rootSide, deadline);
    if (move != null) {
      bestMove = move;
      bestScore = score;
    }
  }

  return { move: bestMove, score: bestScore === -Infinity ? 0 : bestScore };
}
