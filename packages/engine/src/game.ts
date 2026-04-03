import type { BoardDefinition, GameSetup, PieceInstance, PieceTypeDefinition } from "@cv/shared";
import { generatePseudoLegalMoves } from "./moveGenerator.js";
import type { CompactMove, GameState } from "./types.js";
import { coordKey } from "./types.js";
import { normalizeDirection } from "./gcd.js";

function clonePieceTypes(map: Map<string, PieceTypeDefinition>): Map<string, PieceTypeDefinition> {
  return new Map(map);
}

function clonePieces(map: Map<string, PieceInstance>): Map<string, PieceInstance> {
  return new Map(
    [...map.entries()].map(([k, v]) => [k, { ...v, state: { ...v.state } }])
  );
}

function cloneOccupancy(m: Map<string, string>): Map<string, string> {
  return new Map(m);
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

function capturedPieceHasTag(
  state: GameState,
  captured: PieceInstance,
  tag: string
): boolean {
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

export function applyMove(state: GameState, move: CompactMove): GameState {
  if (state.status !== "ongoing") return state;
  if (!validateMove(state, move)) {
    throw new Error("Illegal move");
  }

  const piece = state.pieces.get(move.pieceId);
  if (!piece) throw new Error("Missing piece");

  const pieceTypes = clonePieceTypes(state.pieceTypes);
  const pieces = clonePieces(state.pieces);
  const occupancy = cloneOccupancy(state.occupancy);

  occupancy.delete(coordKey(move.from));
  let captured: PieceInstance | undefined;
  if (move.captureId) {
    captured = pieces.get(move.captureId);
    pieces.delete(move.captureId);
  }
  const moving: PieceInstance = {
    ...piece,
    x: move.to.x,
    y: move.to.y,
    state: { ...piece.state, hasMoved: true },
  };
  const ddx = move.to.x - move.from.x;
  const ddy = move.to.y - move.from.y;
  const dir = normalizeDirection(ddx, ddy);
  if (dir) {
    moving.state = { ...moving.state, lastMoveDirection: dir };
  }

  pieces.set(moving.instanceId, moving);
  occupancy.set(coordKey(move.to), moving.instanceId);

  if (move.companionMove) {
    const buddy = pieces.get(move.companionMove.pieceId);
    if (buddy) {
      occupancy.delete(coordKey(move.companionMove.from));
      const buddyMoved: PieceInstance = {
        ...buddy,
        x: move.companionMove.to.x,
        y: move.companionMove.to.y,
        state: { ...buddy.state, hasMoved: true },
      };
      pieces.set(buddyMoved.instanceId, buddyMoved);
      occupancy.set(coordKey(move.companionMove.to), buddyMoved.instanceId);
    }
  }

  const capturedPieces = [...state.capturedPieces];
  if (captured) {
    capturedPieces.push(captured);
  }

  const moveHistory = [...state.moveHistory, move];

  const moverIndex = state.currentTurnIndex;
  const moverSide = state.sides[moverIndex];
  const nextTurn = (moverIndex + 1) % state.sides.length;

  let next: GameState = {
    ...state,
    pieceTypes,
    pieces,
    occupancy,
    moveHistory,
    capturedPieces,
    currentTurnIndex: nextTurn,
  };

  next = evaluateWinCondition(next, captured, moverSide);

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
