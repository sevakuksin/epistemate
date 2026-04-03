import { createGameFromSetup, serializeGame, type SerializedGame } from "@cv/engine";
import type { BoardDefinition, GameSetup, PieceInstance } from "@cv/shared";

export type Side = "white" | "black";

export type EpistemateDraftState = {
  kind: "epistemateDraft";
  activeSide: Side;
  stage: "buy" | "place";
  startingBudget: number;
  buyCounts: Record<string, { white: number; black: number }>;
  placements: Record<Side, PieceInstance[]>;
};

type ConfirmResult =
  | { kind: "draft"; draft: EpistemateDraftState }
  | { kind: "started"; setup: GameSetup; state: SerializedGame; nextTurnSide: "white" | "black" };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function typeById(setup: GameSetup, typeId: string) {
  return setup.pieceTypes.find((p) => p.id === typeId);
}

function piecePrice(setup: GameSetup, typeId: string): number {
  const p = typeById(setup, typeId);
  if (!p) return 0;
  if (p.tags?.includes("king")) return 0;
  return typeof p.price === "number" ? p.price : 1;
}

function budgetSpent(setup: GameSetup, draft: EpistemateDraftState, side: Side): number {
  let spent = 0;
  for (const piece of setup.pieceTypes) {
    const count = draft.buyCounts[piece.id]?.[side] ?? 0;
    spent += count * piecePrice(setup, piece.id);
  }
  return spent;
}

function isPlacementRow(side: Side, y: number, boardHeight: number): boolean {
  return side === "white" ? y >= boardHeight - 2 : y <= 1;
}

function occupancy(draft: EpistemateDraftState): Map<string, PieceInstance> {
  const out = new Map<string, PieceInstance>();
  for (const p of [...draft.placements.white, ...draft.placements.black]) {
    out.set(`${p.x},${p.y}`, p);
  }
  return out;
}

function requiredCount(draft: EpistemateDraftState, side: Side, typeId: string): number {
  return draft.buyCounts[typeId]?.[side] ?? 0;
}

function placedCount(draft: EpistemateDraftState, side: Side, typeId: string): number {
  return draft.placements[side].filter((p) => p.typeId === typeId).length;
}

export function createInitialEpistemateDraft(setup: GameSetup): EpistemateDraftState {
  const buyCounts: EpistemateDraftState["buyCounts"] = {};
  for (const piece of setup.pieceTypes) {
    const king = piece.tags?.includes("king");
    buyCounts[piece.id] = { white: king ? 1 : 0, black: king ? 1 : 0 };
  }
  return {
    kind: "epistemateDraft",
    activeSide: "white",
    stage: "buy",
    startingBudget: setup.budgetMode?.startingBudget ?? 40,
    buyCounts,
    placements: { white: [], black: [] },
  };
}

export function parseEpistemateDraft(raw: unknown): EpistemateDraftState {
  if (!raw || typeof raw !== "object") throw new Error("invalid draft state");
  const draft = raw as EpistemateDraftState;
  if (draft.kind !== "epistemateDraft") throw new Error("invalid draft kind");
  if (draft.activeSide !== "white" && draft.activeSide !== "black") throw new Error("invalid active side");
  if (draft.stage !== "buy" && draft.stage !== "place") throw new Error("invalid stage");
  if (typeof draft.startingBudget !== "number") throw new Error("invalid budget");
  if (!draft.buyCounts || typeof draft.buyCounts !== "object") throw new Error("invalid buyCounts");
  if (!draft.placements || !Array.isArray(draft.placements.white) || !Array.isArray(draft.placements.black)) {
    throw new Error("invalid placements");
  }
  return draft;
}

export function adjustDraftBuy(
  setup: GameSetup,
  draftIn: EpistemateDraftState,
  actorSide: Side,
  pieceId: string,
  delta: number
): EpistemateDraftState {
  if (draftIn.stage !== "buy") throw new Error("not in buy stage");
  if (draftIn.activeSide !== actorSide) throw new Error("not your draft turn");
  const typeDef = typeById(setup, pieceId);
  if (!typeDef) throw new Error("unknown piece type");
  if (typeDef.tags?.includes("king")) throw new Error("king is auto-included");
  if (delta === 0) return draftIn;

  const draft = clone(draftIn);
  const current = draft.buyCounts[pieceId] ?? { white: 0, black: 0 };
  const nextCount = Math.max(0, (current[actorSide] ?? 0) + delta);
  draft.buyCounts[pieceId] = { ...current, [actorSide]: nextCount };

  if (budgetSpent(setup, draft, actorSide) > draft.startingBudget) {
    throw new Error("budget exceeded");
  }

  return draft;
}

export function placeFromPool(
  setup: GameSetup,
  board: BoardDefinition,
  draftIn: EpistemateDraftState,
  actorSide: Side,
  typeId: string,
  x: number,
  y: number
): EpistemateDraftState {
  if (draftIn.stage !== "place") throw new Error("not in placement stage");
  if (draftIn.activeSide !== actorSide) throw new Error("not your draft turn");
  if (!typeById(setup, typeId)) throw new Error("unknown piece type");
  if (!isPlacementRow(actorSide, y, board.height)) throw new Error("must place in first two rows");
  const occ = occupancy(draftIn);
  if (occ.has(`${x},${y}`)) throw new Error("square is occupied");

  const need = requiredCount(draftIn, actorSide, typeId);
  const have = placedCount(draftIn, actorSide, typeId);
  if (have >= need) throw new Error("all selected pieces of this type are already placed");

  const draft = clone(draftIn);
  const idx = draft.placements[actorSide].filter((p) => p.typeId === typeId).length + 1;
  draft.placements[actorSide].push({
    instanceId: `${actorSide}_${typeId}_${idx}`,
    typeId,
    side: actorSide,
    x,
    y,
    state: {},
  });

  return draft;
}

export function movePlacedPiece(
  board: BoardDefinition,
  draftIn: EpistemateDraftState,
  actorSide: Side,
  instanceId: string,
  x: number,
  y: number
): EpistemateDraftState {
  if (draftIn.stage !== "place") throw new Error("not in placement stage");
  if (draftIn.activeSide !== actorSide) throw new Error("not your draft turn");
  if (!isPlacementRow(actorSide, y, board.height)) throw new Error("must place in first two rows");

  const own = draftIn.placements[actorSide].find((p) => p.instanceId === instanceId);
  if (!own) throw new Error("piece not found");

  const occ = occupancy(draftIn);
  const hit = occ.get(`${x},${y}`);
  if (hit && hit.instanceId !== instanceId) throw new Error("square is occupied");

  const draft = clone(draftIn);
  draft.placements[actorSide] = draft.placements[actorSide].map((p) =>
    p.instanceId === instanceId ? { ...p, x, y } : p
  );
  return draft;
}

export function takeBackPlacedPiece(
  draftIn: EpistemateDraftState,
  actorSide: Side,
  instanceId: string
): EpistemateDraftState {
  if (draftIn.stage !== "place") throw new Error("not in placement stage");
  if (draftIn.activeSide !== actorSide) throw new Error("not your draft turn");
  const exists = draftIn.placements[actorSide].some((p) => p.instanceId === instanceId);
  if (!exists) throw new Error("piece not found");

  const draft = clone(draftIn);
  draft.placements[actorSide] = draft.placements[actorSide].filter((p) => p.instanceId !== instanceId);
  return draft;
}

export function confirmDraftPhase(
  setup: GameSetup,
  board: BoardDefinition,
  draftIn: EpistemateDraftState,
  actorSide: Side
): ConfirmResult {
  if (draftIn.activeSide !== actorSide) throw new Error("not your draft turn");

  if (draftIn.stage === "buy") {
    if (budgetSpent(setup, draftIn, actorSide) > draftIn.startingBudget) {
      throw new Error("budget exceeded");
    }
    return {
      kind: "draft",
      draft: { ...clone(draftIn), stage: "place" },
    };
  }

  for (const piece of setup.pieceTypes) {
    const need = requiredCount(draftIn, actorSide, piece.id);
    const have = placedCount(draftIn, actorSide, piece.id);
    if (need !== have) {
      throw new Error(`must place all selected ${piece.name}`);
    }
  }

  if (actorSide === "white") {
    return {
      kind: "draft",
      draft: {
        ...clone(draftIn),
        activeSide: "black",
        stage: "buy",
      },
    };
  }

  const finalPieces = [...draftIn.placements.white, ...draftIn.placements.black];
  const runtimeSetup: GameSetup = {
    ...setup,
    id: `${setup.id}_runtime`,
    name: `${setup.name} (Drafted)`,
    placedPieces: finalPieces,
  };
  const state = serializeGame(createGameFromSetup(runtimeSetup, board));
  return {
    kind: "started",
    setup: runtimeSetup,
    state,
    nextTurnSide: state.sides[state.currentTurnIndex] as "white" | "black",
  };
}
