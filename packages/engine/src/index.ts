export type { CompactMove, Coord, GameState, GameStatus } from "./types.js";
export type { SerializedGame } from "./game.js";
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
export { pieceHookRegistry } from "./hooks.js";
export { normalizeDirection, gcd } from "./gcd.js";
