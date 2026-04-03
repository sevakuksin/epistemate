import { describe, expect, it } from "vitest";
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
    const setup = minimalSetup(
      [
        {
          instanceId: "wk",
          typeId: "king",
          side: "white",
          x: 4,
          y: 4,
          state: {},
        },
      ],
      [kingType]
    );
    const g = createGameFromSetup(setup, board);
    const back = deserializeGame(serializeGame(g));
    expect(back.pieces.size).toBe(1);
    expect(back.board.width).toBe(8);
  });
});

describe("king moves", () => {
  it("generates adjacent moves", () => {
    const setup = minimalSetup(
      [
        {
          instanceId: "wk",
          typeId: "king",
          side: "white",
          x: 4,
          y: 4,
          state: {},
        },
      ],
      [kingType]
    );
    const g = createGameFromSetup(setup, board);
    const moves = generatePseudoLegalMoves(g, "wk");
    expect(moves.length).toBe(8);
  });
});

describe("capture king wins", () => {
  it("ends game when king tagged piece is captured", () => {
    const setup = minimalSetup(
      [
        { instanceId: "wk", typeId: "king", side: "white", x: 2, y: 2, state: {} },
        { instanceId: "bk", typeId: "king", side: "black", x: 3, y: 2, state: {} },
      ],
      [kingType]
    );
    let g = createGameFromSetup(setup, board);
    const moves = generatePseudoLegalMoves(g, "wk");
    const capture = moves.find((m) => m.captureId === "bk");
    expect(capture).toBeDefined();
    g = applyMove(g, capture!);
    expect(g.status).toBe("finished");
    expect(g.winnerSide).toBe("white");
  });
});

describe("noRepeatDirection", () => {
  it("blocks move in same direction as previous", () => {
    const setup = minimalSetup(
      [
        { instanceId: "w1", typeId: "wiggler", side: "white", x: 2, y: 2, state: {} },
        { instanceId: "b1", typeId: "rook", side: "black", x: 0, y: 0, state: {} },
      ],
      [wigglerType, rookType]
    );
    let g = createGameFromSetup(setup, board);
    let moves = generatePseudoLegalMoves(g, "w1");
    const east = moves.find((m) => m.to.x === 3 && m.to.y === 2);
    expect(east).toBeDefined();
    g = applyMove(g, east!);
    g = { ...g, currentTurnIndex: 0 };
    moves = generatePseudoLegalMoves(g, "w1");
    const eastAgain = moves.find((m) => m.to.x === 4 && m.to.y === 2);
    expect(eastAgain).toBeUndefined();
  });
});

describe("castleLike hook", () => {
  it("creates a castling move and shifts rook companion", () => {
    const setup = minimalSetup(
      [
        { instanceId: "wk", typeId: "king", side: "white", x: 4, y: 7, state: {} },
        { instanceId: "wr", typeId: "rook", side: "white", x: 7, y: 7, state: {} },
        { instanceId: "bk", typeId: "king", side: "black", x: 4, y: 0, state: {} },
      ],
      [kingType, rookType]
    );
    let g = createGameFromSetup(setup, board);
    const moves = generatePseudoLegalMoves(g, "wk");
    const castle = moves.find((m) => m.to.x === 6 && m.to.y === 7 && m.companionMove?.pieceId === "wr");
    expect(castle).toBeDefined();
    g = applyMove(g, castle!);
    expect(g.pieces.get("wk")?.x).toBe(6);
    expect(g.pieces.get("wr")?.x).toBe(5);
  });

  it("blocks castling through attacked intermediate square", () => {
    const setup = minimalSetup(
      [
        { instanceId: "wk", typeId: "king", side: "white", x: 4, y: 7, state: {} },
        { instanceId: "wr", typeId: "rook", side: "white", x: 7, y: 7, state: {} },
        { instanceId: "bk", typeId: "king", side: "black", x: 0, y: 0, state: {} },
        // Attacks f1-equivalent transit square (5,7)
        { instanceId: "br", typeId: "rook", side: "black", x: 5, y: 0, state: {} },
      ],
      [kingType, rookType]
    );
    const g = createGameFromSetup(setup, board);
    const moves = generatePseudoLegalMoves(g, "wk");
    const castle = moves.find((m) => m.to.x === 6 && m.to.y === 7 && m.companionMove?.pieceId === "wr");
    expect(castle).toBeUndefined();
  });
});

describe("relativeToSide pawn", () => {
  it("moves forward based on side using one piece type", () => {
    const setup = minimalSetup(
      [
        { instanceId: "wp", typeId: "pawn", side: "white", x: 3, y: 6, state: {} },
        { instanceId: "bp", typeId: "pawn", side: "black", x: 4, y: 1, state: {} },
      ],
      [pawnType]
    );
    const g = createGameFromSetup(setup, board);
    const whiteMoves = generatePseudoLegalMoves(g, "wp");
    expect(whiteMoves.some((m) => m.to.x === 3 && m.to.y === 5)).toBe(true);
    expect(whiteMoves.some((m) => m.to.x === 3 && m.to.y === 4)).toBe(true);

    const gBlackTurn = { ...g, currentTurnIndex: 1 };
    const blackMoves = generatePseudoLegalMoves(gBlackTurn, "bp");
    expect(blackMoves.some((m) => m.to.x === 4 && m.to.y === 2)).toBe(true);
    expect(blackMoves.some((m) => m.to.x === 4 && m.to.y === 3)).toBe(true);
  });
});
