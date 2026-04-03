import { describe, expect, it, vi } from "vitest";
import type { BoardDefinition, GameSetup, PieceTypeDefinition } from "@cv/shared";
import {
  applyMove,
  createGameFromSetup,
  deserializeGame,
  generatePseudoLegalMoves,
  serializeGame,
} from "./index.js";

const board: BoardDefinition = {
  id: "b1",
  name: "Test",
  width: 8,
  height: 8,
};

const kingType: PieceTypeDefinition = {
  id: "king",
  name: "King",
  asset: "/assets/king.svg",
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
  asset: "/assets/rook.svg",
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

const queenType: PieceTypeDefinition = {
  id: "queen",
  name: "Queen",
  asset: "/assets/queen.svg",
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

const bishopType: PieceTypeDefinition = {
  id: "bishop",
  name: "Bishop",
  asset: "/assets/bishop.svg",
  movementRules: [
    {
      kind: "slide",
      vectors: [
        { dx: 1, dy: 1 },
        { dx: -1, dy: 1 },
        { dx: 1, dy: -1 },
        { dx: -1, dy: -1 },
      ],
      blockers: "all",
    },
  ],
  captureRules: [],
  tags: [],
  price: 4,
};

const knightType: PieceTypeDefinition = {
  id: "knight",
  name: "Knight",
  asset: "/assets/knight.svg",
  movementRules: [
    {
      kind: "jump",
      vectors: [
        { dx: 1, dy: 2 },
        { dx: 2, dy: 1 },
        { dx: -1, dy: 2 },
        { dx: -2, dy: 1 },
        { dx: 1, dy: -2 },
        { dx: 2, dy: -1 },
        { dx: -1, dy: -2 },
        { dx: -2, dy: -1 },
      ],
      blockers: "none",
    },
  ],
  captureRules: [],
  tags: [],
  price: 3,
};

const wigglerType: PieceTypeDefinition = {
  id: "wiggler",
  name: "Wiggler",
  asset: "/assets/wiggler.svg",
  movementRules: [
    {
      kind: "step",
      vectors: [
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 },
      ],
      range: 1,
      blockers: "all",
    },
  ],
  captureRules: [],
  pieceHooks: ["noRepeatDirection"],
  tags: [],
  price: 5,
};

const pawnType: PieceTypeDefinition = {
  id: "pawn",
  name: "Pawn",
  asset: "/assets/pawn.svg",
  movementRules: [
    {
      kind: "step",
      vectors: [{ dx: 0, dy: 1 }],
      range: 1,
      blockers: "all",
      relativeToSide: true,
    },
    {
      kind: "step",
      vectors: [{ dx: 0, dy: 1 }],
      range: 2,
      blockers: "all",
      firstMoveOnly: true,
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

const hegelType: PieceTypeDefinition = {
  id: "hegel",
  name: "Hegel",
  asset: "/assets/hegel.svg",
  movementRules: queenType.movementRules,
  captureRules: queenType.captureRules,
  pieceHooks: ["hegelDialectic"],
  defaultState: { lastDirectionClass: null },
  tags: [],
  price: 11,
};

const nietzscheType: PieceTypeDefinition = {
  id: "nietzsche",
  name: "Nietzsche",
  asset: "/assets/nietzsche.svg",
  movementRules: queenType.movementRules,
  captureRules: queenType.captureRules,
  pieceHooks: ["nietzscheStatic"],
  tags: ["untargetable"],
  price: 7,
};

const vygotskyType: PieceTypeDefinition = {
  id: "vygotsky",
  name: "Vygotsky",
  asset: "/assets/v.svg",
  movementRules: [...queenType.movementRules, ...knightType.movementRules, ...pawnType.movementRules],
  captureRules: [...queenType.movementRules, ...knightType.movementRules, ...pawnType.captureRules],
  pieceHooks: ["vygotskyEvolution"],
  defaultState: { stageIndex: 0 },
  behavior: { stageSequence: ["pawn", "knight", "bishop", "rook", "queen"] },
  tags: [],
  price: 8,
};

const skinnerType: PieceTypeDefinition = {
  id: "skinner",
  name: "Skinner",
  asset: "/assets/skinner.svg",
  movementRules: queenType.movementRules,
  captureRules: [],
  pieceHooks: ["skinnerReinforce"],
  defaultState: { mustRepeatAfterReward: false, lastMoveVector: null },
  tags: [],
  price: 8,
};

const freudType: PieceTypeDefinition = {
  id: "freud",
  name: "Freud",
  asset: "/assets/freud.svg",
  movementRules: queenType.movementRules,
  captureRules: [],
  pieceHooks: ["freudSlip"],
  behavior: { slipProbability: 1 },
  tags: [],
  price: 7,
};

const attentionType: PieceTypeDefinition = {
  id: "attention",
  name: "Attention Span",
  asset: "/assets/a.svg",
  movementRules: queenType.movementRules,
  captureRules: [],
  pieceHooks: ["attentionSpanLocal"],
  behavior: { attentionRadius: 1, attentionIdleLimit: 2 },
  defaultState: { turnsSinceMoved: 0 },
  tags: [],
  price: 6,
};

const placeboType: PieceTypeDefinition = {
  id: "placebo",
  name: "Placebo",
  asset: "/assets/placebo.svg",
  displayRepresentation: "queen",
  movementRules: bishopType.movementRules,
  captureRules: [],
  tags: [],
  price: 5,
};

function minimalSetup(placed: GameSetup["placedPieces"], types: PieceTypeDefinition[]): GameSetup {
  return {
    id: "s1",
    name: "Test",
    boardId: board.id,
    placedPieces: placed,
    sides: ["white", "black"],
    pieceTypes: types,
    winCondition: { type: "captureTag", tag: "king" },
  };
}

describe("serialize round-trip", () => {
  it("preserves game state", () => {
    const setup = minimalSetup([
      { instanceId: "wk", typeId: "king", side: "white", x: 4, y: 4, state: {} },
    ], [kingType]);
    const g = createGameFromSetup(setup, board);
    const back = deserializeGame(serializeGame(g));
    expect(back.pieces.size).toBe(1);
    expect(back.turnNumber).toBe(0);
  });
});

describe("existing core rules", () => {
  it("capture king wins", () => {
    const setup = minimalSetup([
      { instanceId: "wk", typeId: "king", side: "white", x: 2, y: 2, state: {} },
      { instanceId: "bk", typeId: "king", side: "black", x: 3, y: 2, state: {} },
    ], [kingType]);
    let g = createGameFromSetup(setup, board);
    const capture = generatePseudoLegalMoves(g, "wk").find((m) => m.captureId === "bk");
    expect(capture).toBeDefined();
    g = applyMove(g, capture!);
    expect(g.status).toBe("finished");
    expect(g.winnerSide).toBe("white");
  });

  it("castling still works", () => {
    const setup = minimalSetup([
      { instanceId: "wk", typeId: "king", side: "white", x: 4, y: 7, state: {} },
      { instanceId: "wr", typeId: "rook", side: "white", x: 7, y: 7, state: {} },
      { instanceId: "bk", typeId: "king", side: "black", x: 4, y: 0, state: {} },
    ], [kingType, rookType]);
    let g = createGameFromSetup(setup, board);
    const castle = generatePseudoLegalMoves(g, "wk").find((m) => m.to.x === 6 && m.companionMove?.pieceId === "wr");
    expect(castle).toBeDefined();
    g = applyMove(g, castle!);
    expect(g.pieces.get("wr")?.x).toBe(5);
  });
});

describe("new custom pieces", () => {
  it("Hegel cannot repeat direction class", () => {
    const setup = minimalSetup([
      { instanceId: "h", typeId: "hegel", side: "white", x: 2, y: 2, state: {} },
      { instanceId: "b", typeId: "king", side: "black", x: 7, y: 7, state: {} },
    ], [hegelType, kingType]);
    let g = createGameFromSetup(setup, board);
    const right = generatePseudoLegalMoves(g, "h").find((m) => m.to.x === 3 && m.to.y === 2);
    expect(right).toBeDefined();
    g = applyMove(g, right!);
    g = { ...g, currentTurnIndex: 0 };
    const moves2 = generatePseudoLegalMoves(g, "h");
    expect(moves2.some((m) => m.to.y === 2 && m.to.x > 3)).toBe(false);
  });

  it("Nietzsche cannot move and cannot be captured", () => {
    const setup = minimalSetup([
      { instanceId: "n", typeId: "nietzsche", side: "black", x: 4, y: 4, state: {} },
      { instanceId: "q", typeId: "queen", side: "white", x: 4, y: 1, state: {} },
      { instanceId: "wk", typeId: "king", side: "white", x: 0, y: 7, state: {} },
    ], [nietzscheType, queenType, kingType]);
    const g = createGameFromSetup(setup, board);
    expect(generatePseudoLegalMoves(g, "n")).toHaveLength(0);
    const qMoves = generatePseudoLegalMoves(g, "q");
    expect(qMoves.some((m) => m.to.x === 4 && m.to.y === 4)).toBe(false);
  });

  it("Vygotsky upgrades stage on capture", () => {
    const setup = minimalSetup([
      { instanceId: "v", typeId: "vygotsky", side: "white", x: 3, y: 6, state: { stageIndex: 0 } },
      { instanceId: "t", typeId: "rook", side: "black", x: 4, y: 5, state: {} },
      { instanceId: "bk", typeId: "king", side: "black", x: 7, y: 0, state: {} },
    ], [vygotskyType, rookType, kingType]);
    let g = createGameFromSetup(setup, board);
    const cap = generatePseudoLegalMoves(g, "v").find((m) => m.captureId === "t");
    expect(cap).toBeDefined();
    g = applyMove(g, cap!);
    expect(g.pieces.get("v")?.state.stageIndex).toBe(1);
  });

  it("Skinner enforces repeat vector after reward when possible", () => {
    const setup = minimalSetup([
      { instanceId: "s", typeId: "skinner", side: "white", x: 2, y: 2, state: {} },
      { instanceId: "t", typeId: "rook", side: "black", x: 4, y: 2, state: {} },
      { instanceId: "bk", typeId: "king", side: "black", x: 7, y: 0, state: {} },
    ], [skinnerType, rookType, kingType]);
    let g = createGameFromSetup(setup, board);
    const cap = generatePseudoLegalMoves(g, "s").find((m) => m.captureId === "t");
    expect(cap).toBeDefined();
    g = applyMove(g, cap!); // vector +2,0
    g = { ...g, currentTurnIndex: 0 };
    const next = generatePseudoLegalMoves(g, "s");
    expect(next.length).toBeGreaterThan(0);
    expect(next.every((m) => m.to.x - m.from.x === 2 && m.to.y - m.from.y === 0)).toBe(true);
  });

  it("Freud can slip to another legal move", () => {
    const setup = minimalSetup([
      { instanceId: "f", typeId: "freud", side: "white", x: 3, y: 3, state: {} },
      { instanceId: "bk", typeId: "king", side: "black", x: 7, y: 0, state: {} },
    ], [freudType, kingType]);
    const g = createGameFromSetup(setup, board);
    const legal = generatePseudoLegalMoves(g, "f");
    expect(legal.length).toBeGreaterThan(1);
    const intended = legal[0];

    const spy = vi.spyOn(Math, "random").mockReturnValue(0.99);
    const next = applyMove(g, intended);
    spy.mockRestore();

    const moved = next.pieces.get("f");
    expect(moved).toBeDefined();
    const intendedChanged = moved!.x !== intended.to.x || moved!.y !== intended.to.y;
    expect(intendedChanged).toBe(true);
  });

  it("Attention Span despawns if idle for owner turns", () => {
    const setup = minimalSetup([
      { instanceId: "a", typeId: "attention", side: "white", x: 1, y: 7, state: { turnsSinceMoved: 0 } },
      { instanceId: "wk", typeId: "king", side: "white", x: 4, y: 7, state: {} },
      { instanceId: "bk", typeId: "king", side: "black", x: 4, y: 0, state: {} },
    ], [attentionType, kingType]);
    let g = createGameFromSetup(setup, board);

    // white moves king (attention idle +1)
    const m1 = generatePseudoLegalMoves(g, "wk")[0];
    g = applyMove(g, m1);
    // black moves king (no white idle increment)
    const bm1 = generatePseudoLegalMoves(g, "bk")[0];
    g = applyMove(g, bm1);
    // white moves king again (attention idle +1 => reaches limit 2 and despawns)
    const m2 = generatePseudoLegalMoves(g, "wk")[0];
    g = applyMove(g, m2);

    expect(g.pieces.has("a")).toBe(false);
  });

  it("Placebo has bishop movement even if displayed differently", () => {
    const setup = minimalSetup([
      { instanceId: "p", typeId: "placebo", side: "white", x: 3, y: 3, state: {} },
      { instanceId: "bk", typeId: "king", side: "black", x: 7, y: 0, state: {} },
    ], [placeboType, kingType]);
    const g = createGameFromSetup(setup, board);
    const moves = generatePseudoLegalMoves(g, "p");
    expect(moves.some((m) => Math.abs(m.to.x - m.from.x) === Math.abs(m.to.y - m.from.y))).toBe(true);
    expect(moves.some((m) => (m.to.x === m.from.x) !== (m.to.y === m.from.y))).toBe(false);
  });
});
