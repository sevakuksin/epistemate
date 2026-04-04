import type { BoardDefinition, GameSetup, PieceInstance, PieceTypeDefinition } from "@cv/shared";
import { generatePseudoLegalMoves } from "./moveGenerator.js";
import type { CompactMove, GameState } from "./types.js";
import { coordKey } from "./types.js";
import { normalizeDirection } from "./gcd.js";
import { asNumber, directionClass } from "./customRules.js";

function clonePieceTypes(map: Map<string, PieceTypeDefinition>): Map<string, PieceTypeDefinition> {
  return new Map(map);
}

function clonePieces(map: Map<string, PieceInstance>): Map<string, PieceInstance> {
  return new Map([...map.entries()].map(([k, v]) => [k, { ...v, state: { ...v.state } }]));
}

function cloneOccupancy(m: Map<string, string>): Map<string, string> {
  return new Map(m);
}

function hasHook(state: GameState, piece: PieceInstance, hookId: string): boolean {
  const typeDef = state.pieceTypes.get(piece.typeId);
  return Boolean(typeDef?.pieceHooks?.includes(hookId));
}

export function createGameFromSetup(setup: GameSetup, board: BoardDefinition): GameState {
  const pieceTypes = new Map<string, PieceTypeDefinition>();
  for (const pt of setup.pieceTypes) {
    pieceTypes.set(pt.id, pt);
  }

  const pieces = new Map<string, PieceInstance>();
  const occupancy = new Map<string, string>();

  for (const p of setup.placedPieces) {
    const typeDef = pieceTypes.get(p.typeId);
    const mergedState = {
      ...(typeDef?.defaultState ?? {}),
      ...p.state,
      turnsSinceMoved: asNumber((p.state as Record<string, unknown>)?.turnsSinceMoved, 0),
    };
    const inst: PieceInstance = {
      ...p,
      state: mergedState,
    };
    pieces.set(inst.instanceId, inst);
    occupancy.set(coordKey({ x: inst.x, y: inst.y }), inst.instanceId);
  }

  return {
    board,
    sides: [...setup.sides],
    currentTurnIndex: 0,
    turnNumber: 0,
    pieceTypes,
    pieces,
    occupancy,
    moveHistory: [],
    capturedPieces: [],
    status: "ongoing",
    winnerSide: null,
    winCondition: setup.winCondition,
  };
}

function movesEqual(a: CompactMove, b: CompactMove): boolean {
  return (
    a.pieceId === b.pieceId &&
    a.from.x === b.from.x &&
    a.from.y === b.from.y &&
    a.to.x === b.to.x &&
    a.to.y === b.to.y &&
    a.captureId === b.captureId &&
    a.companionMove?.pieceId === b.companionMove?.pieceId &&
    a.companionMove?.from.x === b.companionMove?.from.x &&
    a.companionMove?.from.y === b.companionMove?.from.y &&
    a.companionMove?.to.x === b.companionMove?.to.x &&
    a.companionMove?.to.y === b.companionMove?.to.y
  );
}

export function validateMove(state: GameState, move: CompactMove): boolean {
  const legal = generatePseudoLegalMoves(state, move.pieceId);
  return legal.some((m) => movesEqual(m, move));
}

function capturedPieceHasTag(state: GameState, captured: PieceInstance, tag: string): boolean {
  const t = state.pieceTypes.get(captured.typeId);
  return Boolean(t?.tags?.includes(tag));
}

export function evaluateWinCondition(
  state: GameState,
  lastCapture: PieceInstance | undefined,
  moverSide: string
): GameState {
  if (state.status === "finished") return state;
  const wc = state.winCondition;
  if (wc.type === "captureTag" && lastCapture) {
    if (capturedPieceHasTag(state, lastCapture, wc.tag)) {
      return {
        ...state,
        status: "finished",
        winnerSide: moverSide,
      };
    }
  }
  return state;
}

function maybeApplyFreudSlip(state: GameState, move: CompactMove, piece: PieceInstance): CompactMove {
  if (!hasHook(state, piece, "freudSlip")) return move;
  const typeDef = state.pieceTypes.get(piece.typeId);
  const probability = Math.min(1, Math.max(0, asNumber(typeDef?.behavior?.slipProbability, 0.2)));
  if (Math.random() >= probability) return move;
  const legal = generatePseudoLegalMoves(state, piece.instanceId);
  if (legal.length === 0) return move;
  const idx = Math.floor(Math.random() * legal.length);
  return legal[idx];
}

function applyPieceStateUpdates(
  state: GameState,
  before: PieceInstance,
  after: PieceInstance,
  move: CompactMove,
  captured: PieceInstance | undefined
): PieceInstance {
  const dx = move.to.x - move.from.x;
  const dy = move.to.y - move.from.y;
  const moveCount = asNumber(before.state.moveCount, 0) + 1;
  let nextState: Record<string, unknown> = {
    ...after.state,
    moveCount,
    turnsSinceMoved: 0,
    lastMovedOnTurn: state.turnNumber + 1,
  };

  if (hasHook(state, before, "hegelDialectic")) {
    nextState.lastDirectionClass = directionClass(dx, dy);
  }

  if (hasHook(state, before, "skinnerReinforce")) {
    if (captured) {
      nextState.mustRepeatAfterReward = true;
      nextState.lastMoveVector = { dx, dy };
    } else {
      nextState.mustRepeatAfterReward = false;
    }
  }

  if (hasHook(state, before, "vygotskyEvolution")) {
    const typeDef = state.pieceTypes.get(before.typeId);
    const seq =
      typeDef?.behavior?.stageSequence && typeDef.behavior.stageSequence.length > 0
        ? typeDef.behavior.stageSequence
        : ["pawn", "knight", "bishop", "rook", "queen"];
    const stage = Math.floor(asNumber(before.state.stageIndex, 0));
    const reachedLastRank =
      (before.side === "white" && after.y === 0) ||
      (before.side === "black" && after.y === state.board.height - 1);
    const promoteByRank = stage === 0 && reachedLastRank;
    if (captured || promoteByRank) {
      nextState.stageIndex = Math.min(seq.length - 1, stage + 1);
    }
  }

  return {
    ...after,
    state: nextState,
  };
}

function applyAttentionSpanDecay(state: GameState, pieces: Map<string, PieceInstance>, occupancy: Map<string, string>, mover: PieceInstance): void {
  const toRemove: string[] = [];
  for (const piece of pieces.values()) {
    if (piece.side !== mover.side) continue;
    if (piece.instanceId === mover.instanceId) continue;
    if (!hasHook(state, piece, "attentionSpanLocal")) continue;
    const typeDef = state.pieceTypes.get(piece.typeId);
    const idleLimit = Math.max(1, Math.floor(asNumber(typeDef?.behavior?.attentionIdleLimit, 4)));
    const nextIdle = asNumber(piece.state.turnsSinceMoved, 0) + 1;
    piece.state = {
      ...piece.state,
      turnsSinceMoved: nextIdle,
    };
    if (nextIdle >= idleLimit) {
      toRemove.push(piece.instanceId);
    }
  }

  for (const id of toRemove) {
    const victim = pieces.get(id);
    if (!victim) continue;
    pieces.delete(id);
    occupancy.delete(coordKey({ x: victim.x, y: victim.y }));
  }
}


function hasAnyLegalMovesForCurrentSide(state: GameState): boolean {
  const side = state.sides[state.currentTurnIndex];
  for (const piece of state.pieces.values()) {
    if (piece.side !== side) continue;
    const moves = generatePseudoLegalMoves(state, piece.instanceId);
    if (moves.length > 0) return true;
  }
  return false;
}

export function applyMove(state: GameState, move: CompactMove): GameState {
  if (state.status !== "ongoing") return state;
  if (!validateMove(state, move)) {
    throw new Error("Illegal move");
  }

  const piece = state.pieces.get(move.pieceId);
  if (!piece) throw new Error("Missing piece");

  const effectiveMove = maybeApplyFreudSlip(state, move, piece);
  if (!validateMove(state, effectiveMove)) {
    throw new Error("Illegal move after slip resolution");
  }

  const pieceTypes = clonePieceTypes(state.pieceTypes);
  const pieces = clonePieces(state.pieces);
  const occupancy = cloneOccupancy(state.occupancy);

  occupancy.delete(coordKey(effectiveMove.from));
  let captured: PieceInstance | undefined;
  if (effectiveMove.captureId) {
    captured = pieces.get(effectiveMove.captureId);
    pieces.delete(effectiveMove.captureId);
  }

  const movingBefore = pieces.get(effectiveMove.pieceId);
  if (!movingBefore) throw new Error("Missing moving piece");

  const movingAfterBase: PieceInstance = {
    ...movingBefore,
    x: effectiveMove.to.x,
    y: effectiveMove.to.y,
    state: { ...movingBefore.state, hasMoved: true },
  };
  const ddx = effectiveMove.to.x - effectiveMove.from.x;
  const ddy = effectiveMove.to.y - effectiveMove.from.y;
  const dir = normalizeDirection(ddx, ddy);
  if (dir) {
    movingAfterBase.state = { ...movingAfterBase.state, lastMoveDirection: dir };
  }

  const movingAfter = applyPieceStateUpdates(
    state,
    movingBefore,
    movingAfterBase,
    effectiveMove,
    captured
  );

  pieces.set(movingAfter.instanceId, movingAfter);
  occupancy.set(coordKey(effectiveMove.to), movingAfter.instanceId);

  if (effectiveMove.companionMove) {
    const buddy = pieces.get(effectiveMove.companionMove.pieceId);
    if (buddy) {
      occupancy.delete(coordKey(effectiveMove.companionMove.from));
      const buddyMoved: PieceInstance = {
        ...buddy,
        x: effectiveMove.companionMove.to.x,
        y: effectiveMove.companionMove.to.y,
        state: {
          ...buddy.state,
          hasMoved: true,
          moveCount: asNumber(buddy.state.moveCount, 0) + 1,
          turnsSinceMoved: 0,
          lastMovedOnTurn: state.turnNumber + 1,
        },
      };
      pieces.set(buddyMoved.instanceId, buddyMoved);
      occupancy.set(coordKey(effectiveMove.companionMove.to), buddyMoved.instanceId);
    }
  }

  applyAttentionSpanDecay(state, pieces, occupancy, movingAfter);

  const capturedPieces = [...state.capturedPieces];
  if (captured) {
    capturedPieces.push(captured);
  }

  const moveHistory = [...state.moveHistory, effectiveMove];

  const moverIndex = state.currentTurnIndex;
  const moverSide = state.sides[moverIndex];
  const nextTurn = (moverIndex + 1) % state.sides.length;

  let next: GameState = {
    ...state,
    turnNumber: state.turnNumber + 1,
    pieceTypes,
    pieces,
    occupancy,
    moveHistory,
    capturedPieces,
    currentTurnIndex: nextTurn,
  };

  next = evaluateWinCondition(next, captured, moverSide);

  if (next.status === "ongoing" && !hasAnyLegalMovesForCurrentSide(next)) {
    next = {
      ...next,
      status: "finished",
      winnerSide: null,
    };
  }

  if (next.status === "finished") {
    next = { ...next, currentTurnIndex: moverIndex };
  }

  return next;
}

/** Serializable snapshot */
export type SerializedGame = {
  board: BoardDefinition;
  sides: string[];
  currentTurnIndex: number;
  turnNumber: number;
  pieceTypes: [string, PieceTypeDefinition][];
  pieces: [string, PieceInstance][];
  occupancy: [string, string][];
  moveHistory: CompactMove[];
  capturedPieces: PieceInstance[];
  status: GameState["status"];
  winnerSide: string | null;
  winCondition: GameState["winCondition"];
};

export function serializeGame(state: GameState): SerializedGame {
  return {
    board: state.board,
    sides: state.sides,
    currentTurnIndex: state.currentTurnIndex,
    turnNumber: state.turnNumber,
    pieceTypes: [...state.pieceTypes.entries()],
    pieces: [...state.pieces.entries()],
    occupancy: [...state.occupancy.entries()],
    moveHistory: state.moveHistory,
    capturedPieces: state.capturedPieces,
    status: state.status,
    winnerSide: state.winnerSide,
    winCondition: state.winCondition,
  };
}

export function deserializeGame(data: SerializedGame): GameState {
  return {
    board: data.board,
    sides: data.sides,
    currentTurnIndex: data.currentTurnIndex,
    turnNumber: data.turnNumber ?? 0,
    pieceTypes: new Map(data.pieceTypes),
    pieces: new Map(data.pieces),
    occupancy: new Map(data.occupancy),
    moveHistory: data.moveHistory,
    capturedPieces: data.capturedPieces,
    status: data.status,
    winnerSide: data.winnerSide,
    winCondition: data.winCondition,
  };
}
