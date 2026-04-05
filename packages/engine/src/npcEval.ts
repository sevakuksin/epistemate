import type { PieceInstance, PieceTypeDefinition } from "@cv/shared";
import type { GameState } from "./types.js";
import { asNumber, pieceTypeHasHook } from "./customRules.js";
import { isKingSquareAttacked } from "./hooks.js";
import { generatePseudoLegalMoves } from "./moveGenerator.js";

const KING_CP = 100_000;
/** Static penalty when `rootSide`’s king sits on a square attacked by the opponent (pseudo-legal search). */
export const KING_IN_ATTACK_PENALTY = 85_000;
const MOBILITY_WEIGHT = 0.12;
const MOBILITY_CAP = 72;
const CENTER_WEIGHT = 2;
const CENTER_MAX_DIST = 4;
/** Small pull of non-king pieces toward the enemy king (centipawns scale). */
const TROPISM_WEIGHT = 0.28;
const TROPISM_CAP = 56;

export const MATE_SCORE = 1_000_000;

/** Leaf score from the current player's (side-to-move) perspective for negamax. */
export function evaluateForSTM(state: GameState, rootSide: string): number {
  const stm = state.sides[state.currentTurnIndex];
  const e = evaluateForRoot(state, rootSide);
  return stm === rootSide ? e : -e;
}

function otherSide(state: GameState, side: string): string {
  const o = state.sides.find((s) => s !== side);
  return o ?? state.sides[1];
}

/** Static evaluation from NPC / root player perspective: positive = good for `rootSide`. */
export function evaluateForRoot(state: GameState, rootSide: string): number {
  if (state.status === "finished") {
    if (state.winnerSide == null) return 0;
    return state.winnerSide === rootSide ? MATE_SCORE : -MATE_SCORE;
  }

  const opp = otherSide(state, rootSide);
  let score = materialCp(state, rootSide) - materialCp(state, opp);
  score += mobilityCp(state, rootSide) - mobilityCp(state, opp);
  score += centerCp(state, rootSide) - centerCp(state, opp);
  score += tropismCp(state, rootSide) - tropismCp(state, opp);

  if (isKingSquareAttacked(state, rootSide)) {
    score -= KING_IN_ATTACK_PENALTY;
  }

  return score;
}

function findKingCoords(state: GameState, side: string): { x: number; y: number } | null {
  for (const p of state.pieces.values()) {
    if (p.side !== side) continue;
    const t = state.pieceTypes.get(p.typeId);
    if (t?.tags?.includes("king")) return { x: p.x, y: p.y };
  }
  return null;
}

function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

/** Non-king pieces closer to the enemy king score higher (capped). King excluded; Freud uses slip discount on the positive slice. */
function tropismCp(state: GameState, side: string): number {
  const opp = otherSide(state, side);
  const target = findKingCoords(state, opp);
  if (!target) return 0;

  const { width, height } = state.board;
  const maxDist = width + height - 2;
  let raw = 0;
  for (const p of state.pieces.values()) {
    if (p.side !== side) continue;
    const t = state.pieceTypes.get(p.typeId);
    if (!t || t.tags?.includes("king")) continue;
    const dist = manhattan(p.x, p.y, target.x, target.y);
    const pieceContrib = (maxDist - dist) * TROPISM_WEIGHT;
    raw += pieceContrib * freudPositiveMultiplier(t);
  }
  return Math.min(raw, TROPISM_CAP);
}

function pieceMaterialCp(typeDef: PieceTypeDefinition): number {
  if (typeDef.tags?.includes("king")) return KING_CP;
  return (typeof typeDef.price === "number" ? typeDef.price : 1) * 100;
}

function materialCp(state: GameState, side: string): number {
  let sum = 0;
  for (const p of state.pieces.values()) {
    if (p.side !== side) continue;
    const t = state.pieceTypes.get(p.typeId);
    if (!t) continue;
    sum += pieceMaterialCp(t);
  }
  return sum;
}

/** (1 - slipProbability) for Freud pieces; 1 otherwise. Discounts positive positional bonuses only. */
export function freudPositiveMultiplier(typeDef: PieceTypeDefinition | undefined): number {
  if (!typeDef || !pieceTypeHasHook(typeDef, "freudSlip")) return 1;
  const p = Math.min(1, Math.max(0, asNumber(typeDef.behavior?.slipProbability, 0.2)));
  return 1 - p;
}

function mobilityCp(state: GameState, side: string): number {
  let raw = 0;
  for (const p of state.pieces.values()) {
    if (p.side !== side) continue;
    const t = state.pieceTypes.get(p.typeId);
    if (!t) continue;
    const n = generatePseudoLegalMoves(state, p.instanceId).length;
    const pieceContrib = Math.min(n, 36) * MOBILITY_WEIGHT;
    const mult = freudPositiveMultiplier(t);
    raw += pieceContrib * mult;
  }
  return Math.min(raw, MOBILITY_CAP);
}

function centerManhattan(p: PieceInstance, w: number, h: number): number {
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  return Math.abs(p.x - cx) + Math.abs(p.y - cy);
}

/** Small bonus for low-price pieces (&lt;3) closer to board center. Freud: positive slice × (1 − slipProb). */
function centerCp(state: GameState, side: string): number {
  const { width, height } = state.board;
  let sum = 0;
  for (const p of state.pieces.values()) {
    if (p.side !== side) continue;
    const t = state.pieceTypes.get(p.typeId);
    if (!t) continue;
    const price = typeof t.price === "number" ? t.price : 1;
    if (price >= 3) continue;
    const dist = centerManhattan(p, width, height);
    const bonus = Math.max(0, CENTER_MAX_DIST - dist) * CENTER_WEIGHT;
    const mult = freudPositiveMultiplier(t);
    sum += bonus * mult;
  }
  return Math.min(sum, 80);
}
