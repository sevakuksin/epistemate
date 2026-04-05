export type { CompactMove, Coord, GameState, GameStatus } from "./types.js";
export type { SerializedGame, ApplyMoveOptions } from "./game.js";
export { coordKey } from "./types.js";
export {
  createGameFromSetup,
  applyMove,
  validateMove,
  evaluateWinCondition,
  serializeGame,
  deserializeGame,
} from "./game.js";
export { generatePseudoLegalMoves } from "./moveGenerator.js";
export { pieceHookRegistry, isSquareAttackedByOpponent, isKingSquareAttacked } from "./hooks.js";
export { normalizeDirection, gcd } from "./gcd.js";
export {
  evaluateForRoot,
  evaluateForSTM,
  freudPositiveMultiplier,
  KING_IN_ATTACK_PENALTY,
  MATE_SCORE,
} from "./npcEval.js";
export {
  collectAllLegalMoves,
  findBestMove,
  orderMovesForQuiescence,
  MAX_EXTENSION_PLIES,
} from "./npcSearch.js";
