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
