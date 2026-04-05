import { describe, expect, it, vi } from "vitest";
import type { BoardDefinition, GameSetup, PieceTypeDefinition } from "@cv/shared";
import {
  applyMove,
  createGameFromSetup,
  evaluateForRoot,
  findBestMove,
  freudPositiveMultiplier,
  generatePseudoLegalMoves,
  KING_IN_ATTACK_PENALTY,
} from "./index.js";
import { orderMovesForQuiescence } from "./npcSearch.js";

const board: BoardDefinition = {
  id: "b_npc",
  name: "Test",
  width: 8,
  height: 8,
};

const kingType: PieceTypeDefinition = {
  id: "king",
  name: "King",
  asset: "/k.svg",
  movementRules: [
    {
      kind: "step",
      vectors: [
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 },
        { dx: 1, dy: 1 },
        { dx: 1, dy: -1 },
        { dx: -1, dy: 1 },
        { dx: -1, dy: -1 },
      ],
      range: 1,
      blockers: "all",
    },
  ],
  captureRules: [],
  tags: ["king"],
  pieceHooks: ["castleLike"],
  price: 10,
};

const rookType: PieceTypeDefinition = {
  id: "rook",
  name: "Rook",
  asset: "/r.svg",
  movementRules: [
    {
      kind: "slide",
      vectors: [
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 },
      ],
      blockers: "all",
    },
  ],
  captureRules: [],
  tags: [],
  price: 6,
};

const pawnType: PieceTypeDefinition = {
  id: "pawn",
  name: "Pawn",
  asset: "/p.svg",
  movementRules: [
    {
      kind: "step",
      vectors: [{ dx: 0, dy: 1 }],
      range: 1,
      blockers: "all",
      relativeToSide: true,
    },
  ],
  captureRules: [
    {
      kind: "step",
      vectors: [
        { dx: -1, dy: 1 },
        { dx: 1, dy: 1 },
      ],
      range: 1,
      blockers: "all",
      captureOnly: true,
      relativeToSide: true,
    },
  ],
  tags: ["pawn"],
  price: 1,
};

const queenType: PieceTypeDefinition = {
  id: "queen",
  name: "Queen",
  asset: "/q.svg",
  movementRules: [
    {
      kind: "slide",
      vectors: [
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 },
        { dx: 1, dy: 1 },
        { dx: 1, dy: -1 },
        { dx: -1, dy: 1 },
        { dx: -1, dy: -1 },
      ],
      blockers: "all",
    },
  ],
  captureRules: [],
  tags: [],
  price: 9,
};

const freudType: PieceTypeDefinition = {
  id: "freud",
  name: "Freud",
  asset: "/f.svg",
  movementRules: queenType.movementRules,
  captureRules: [],
  pieceHooks: ["freudSlip"],
  behavior: { slipProbability: 0.25 },
  tags: [],
  price: 7,
};

function minimalSetup(placed: GameSetup["placedPieces"], types: PieceTypeDefinition[]): GameSetup {
  return {
    id: "npc_test",
    name: "NPC Test",
    boardId: board.id,
    placedPieces: placed,
    sides: ["white", "black"],
    pieceTypes: types,
    winCondition: { type: "captureTag", tag: "king" },
  };
}

describe("npc search", () => {
  it("applyMove skipRandomSlip is deterministic under RNG slip", () => {
    const setup = minimalSetup(
      [
        { instanceId: "f", typeId: "freud", side: "white", x: 3, y: 3, state: {} },
        { instanceId: "bk", typeId: "king", side: "black", x: 7, y: 0, state: {} },
      ],
      [freudType, kingType]
    );
    const g = createGameFromSetup(setup, board);
    const intended = generatePseudoLegalMoves(g, "f")[0];
    expect(intended).toBeDefined();

    const spy = vi.spyOn(Math, "random").mockReturnValue(0.99);
    const a = applyMove(g, intended!, { skipRandomSlip: true });
    const b = applyMove(g, intended!, { skipRandomSlip: true });
    spy.mockRestore();

    expect(a.pieces.get("f")?.x).toBe(b.pieces.get("f")?.x);
    expect(a.pieces.get("f")?.y).toBe(b.pieces.get("f")?.y);
  });

  it("findBestMove prefers capturing the king in one ply", () => {
    const setup = minimalSetup(
      [
        { instanceId: "wk", typeId: "king", side: "white", x: 2, y: 2, state: {} },
        { instanceId: "bk", typeId: "king", side: "black", x: 3, y: 2, state: {} },
      ],
      [kingType]
    );
    const g = createGameFromSetup(setup, board);
    const { move } = findBestMove(g, { timeMs: 2000, maxDepth: 4 });
    expect(move?.captureId).toBe("bk");
  });

  it("evaluateForRoot is positive when root side is materially ahead", () => {
    const setup = minimalSetup(
      [
        { instanceId: "wk", typeId: "king", side: "white", x: 4, y: 4, state: {} },
        { instanceId: "bk", typeId: "king", side: "black", x: 0, y: 0, state: {} },
        { instanceId: "wq", typeId: "queen", side: "white", x: 5, y: 5, state: {} },
      ],
      [kingType, queenType]
    );
    const g = createGameFromSetup(setup, board);
    const v = evaluateForRoot(g, "white");
    expect(v).toBeGreaterThan(0);
  });

  it("evaluateForRoot heavily penalizes root king on an attacked square", () => {
    const setup = minimalSetup(
      [
        { instanceId: "wk", typeId: "king", side: "white", x: 0, y: 0, state: {} },
        { instanceId: "bk", typeId: "king", side: "black", x: 3, y: 2, state: {} },
        { instanceId: "wq", typeId: "queen", side: "white", x: 3, y: 5, state: {} },
      ],
      [kingType, queenType]
    );
    const g = createGameFromSetup(setup, board);
    const v = evaluateForRoot(g, "black");
    expect(v).toBeLessThan(-KING_IN_ATTACK_PENALTY / 2);
  });

  it("freudPositiveMultiplier discounts by slipProbability", () => {
    expect(freudPositiveMultiplier(freudType)).toBeCloseTo(0.75);
  });

  it("orderMovesForQuiescence orders quiet checks before non-check captures", () => {
    const setup = minimalSetup(
      [
        { instanceId: "wk", typeId: "king", side: "white", x: 7, y: 7, state: {} },
        { instanceId: "wq", typeId: "queen", side: "white", x: 4, y: 5, state: {} },
        { instanceId: "bk", typeId: "king", side: "black", x: 4, y: 0, state: {} },
        { instanceId: "bp", typeId: "pawn", side: "black", x: 0, y: 5, state: {} },
      ],
      [kingType, queenType, pawnType]
    );
    const g = createGameFromSetup(setup, board);
    const ordered = orderMovesForQuiescence(g);
    const quietCheck = ordered.find((m) => m.pieceId === "wq" && m.to.x === 4 && m.to.y === 1 && !m.captureId);
    const sideCapture = ordered.find((m) => m.pieceId === "wq" && m.captureId === "bp");
    expect(quietCheck).toBeDefined();
    expect(sideCapture).toBeDefined();
    expect(ordered.indexOf(quietCheck!)).toBeLessThan(ordered.indexOf(sideCapture!));
  });
});
