import { db, nowIso, upsertDoc } from "./db.js";

type PieceTypeDefinition = {
  id: string;
  name: string;
  asset: string;
  movementRules: unknown[];
  captureRules: unknown[];
  tags: string[];
  pieceHooks?: string[];
  defaultState?: Record<string, unknown>;
};

type BoardDefinition = {
  id: string;
  name: string;
  width: number;
  height: number;
  squareMeta?: Record<string, unknown>;
};

type GameSetup = {
  id: string;
  name: string;
  boardId: string;
  sides: string[];
  pieceTypes: PieceTypeDefinition[];
  winCondition: { type: "captureTag"; tag: string };
  placedPieces: Array<{ instanceId: string; typeId: string; side: string; x: number; y: number; state: Record<string, unknown> }>;
};

export const DEMO_USER_ID = "demo-user";

export function ensureDemoUser(): void {
  const existing = db.prepare("SELECT id FROM users WHERE id = ?").get(DEMO_USER_ID);
  if (existing) return;
  db.prepare("INSERT INTO users (id, username, created_at) VALUES (?, ?, ?)").run(
    DEMO_USER_ID,
    "demo",
    nowIso()
  );
}

export function ensureDemoPreset(): void {
  ensureDemoUser();

  const king: PieceTypeDefinition = {
    id: "king",
    name: "King",
    asset: "/assets/placeholders/king.svg",
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

  const rook: PieceTypeDefinition = {
    id: "rook",
    name: "Rook",
    asset: "/assets/placeholders/rook.svg",
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
    tags: ["heavy"],
  };

  const wiggler: PieceTypeDefinition = {
    id: "wiggler",
    name: "Wiggler",
    asset: "/assets/placeholders/wiggler.svg",
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
    tags: ["custom"],
    pieceHooks: ["noRepeatDirection"],
    defaultState: {
      hasMoved: false,
      moveCount: 0,
      lastMoveDirection: null,
    },
  };

  const board: BoardDefinition = {
    id: "board_demo_6x6",
    name: "Demo 6x6",
    width: 6,
    height: 6,
    squareMeta: {
      light: "#f0d9b5",
      dark: "#b58863",
    },
  };

  const setup: GameSetup = {
    id: "setup_demo",
    name: "Demo: King, Rook, Wiggler",
    boardId: board.id,
    sides: ["white", "black"],
    pieceTypes: [king, rook, wiggler],
    winCondition: { type: "captureTag", tag: "king" },
    placedPieces: [
      { instanceId: "wk1", typeId: "king", side: "white", x: 1, y: 5, state: {} },
      { instanceId: "wr1", typeId: "rook", side: "white", x: 0, y: 5, state: {} },
      { instanceId: "ww1", typeId: "wiggler", side: "white", x: 2, y: 5, state: {} },
      { instanceId: "bk1", typeId: "king", side: "black", x: 4, y: 0, state: {} },
      { instanceId: "br1", typeId: "rook", side: "black", x: 5, y: 0, state: {} },
      { instanceId: "bw1", typeId: "wiggler", side: "black", x: 3, y: 0, state: {} },
    ],
  };

  upsertDoc("piece_type", DEMO_USER_ID, king.id, king.name, king);
  upsertDoc("piece_type", DEMO_USER_ID, rook.id, rook.name, rook);
  upsertDoc("piece_type", DEMO_USER_ID, wiggler.id, wiggler.name, wiggler);
  upsertDoc("board", DEMO_USER_ID, board.id, board.name, board);
  upsertDoc("setup", DEMO_USER_ID, setup.id, setup.name, setup);

  const queen: PieceTypeDefinition = {
    id: "queen",
    name: "Queen",
    asset: "/assets/placeholders/queen.svg",
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
    tags: ["royal"],
  };

  const bishop: PieceTypeDefinition = {
    id: "bishop",
    name: "Bishop",
    asset: "/assets/placeholders/bishop.svg",
    movementRules: [
      {
        kind: "slide",
        vectors: [
          { dx: 1, dy: 1 },
          { dx: 1, dy: -1 },
          { dx: -1, dy: 1 },
          { dx: -1, dy: -1 },
        ],
        blockers: "all",
      },
    ],
    captureRules: [],
    tags: ["minor"],
  };

  const knight: PieceTypeDefinition = {
    id: "knight",
    name: "Knight",
    asset: "/assets/placeholders/knight.svg",
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
    tags: ["minor"],
  };

  // Side-specific pawn types keep the engine generic while allowing directional behavior.
  const pawnWhite: PieceTypeDefinition = {
    id: "pawn_white",
    name: "Pawn (White)",
    asset: "/assets/placeholders/pawn.svg",
    movementRules: [
      {
        kind: "step",
        vectors: [{ dx: 0, dy: -1 }],
        range: 1,
        blockers: "all",
      },
      {
        kind: "step",
        vectors: [{ dx: 0, dy: -1 }],
        range: 2,
        blockers: "all",
        firstMoveOnly: true,
      },
    ],
    captureRules: [
      {
        kind: "step",
        vectors: [
          { dx: -1, dy: -1 },
          { dx: 1, dy: -1 },
        ],
        range: 1,
        blockers: "all",
        captureOnly: true,
      },
    ],
    tags: ["pawn"],
  };

  const pawnBlack: PieceTypeDefinition = {
    id: "pawn_black",
    name: "Pawn (Black)",
    asset: "/assets/placeholders/pawn.svg",
    movementRules: [
      {
        kind: "step",
        vectors: [{ dx: 0, dy: 1 }],
        range: 1,
        blockers: "all",
      },
      {
        kind: "step",
        vectors: [{ dx: 0, dy: 1 }],
        range: 2,
        blockers: "all",
        firstMoveOnly: true,
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
      },
    ],
    tags: ["pawn"],
  };

  const classicBoard: BoardDefinition = {
    id: "board_classic_8x8",
    name: "Classic 8x8",
    width: 8,
    height: 8,
    squareMeta: {
      light: "#f0d9b5",
      dark: "#b58863",
    },
  };

  const classicPieces: GameSetup["placedPieces"] = [
    // White back rank (y=7)
    { instanceId: "w_r1", typeId: "rook", side: "white", x: 0, y: 7, state: {} },
    { instanceId: "w_n1", typeId: "knight", side: "white", x: 1, y: 7, state: {} },
    { instanceId: "w_b1", typeId: "bishop", side: "white", x: 2, y: 7, state: {} },
    { instanceId: "w_q", typeId: "queen", side: "white", x: 3, y: 7, state: {} },
    { instanceId: "w_k", typeId: "king", side: "white", x: 4, y: 7, state: {} },
    { instanceId: "w_b2", typeId: "bishop", side: "white", x: 5, y: 7, state: {} },
    { instanceId: "w_n2", typeId: "knight", side: "white", x: 6, y: 7, state: {} },
    { instanceId: "w_r2", typeId: "rook", side: "white", x: 7, y: 7, state: {} },
    // White pawns (y=6)
    ...Array.from({ length: 8 }).map((_, x) => ({
      instanceId: `w_p${x + 1}`,
      typeId: "pawn_white",
      side: "white",
      x,
      y: 6,
      state: {},
    })),
    // Black back rank (y=0)
    { instanceId: "b_r1", typeId: "rook", side: "black", x: 0, y: 0, state: {} },
    { instanceId: "b_n1", typeId: "knight", side: "black", x: 1, y: 0, state: {} },
    { instanceId: "b_b1", typeId: "bishop", side: "black", x: 2, y: 0, state: {} },
    { instanceId: "b_q", typeId: "queen", side: "black", x: 3, y: 0, state: {} },
    { instanceId: "b_k", typeId: "king", side: "black", x: 4, y: 0, state: {} },
    { instanceId: "b_b2", typeId: "bishop", side: "black", x: 5, y: 0, state: {} },
    { instanceId: "b_n2", typeId: "knight", side: "black", x: 6, y: 0, state: {} },
    { instanceId: "b_r2", typeId: "rook", side: "black", x: 7, y: 0, state: {} },
    // Black pawns (y=1)
    ...Array.from({ length: 8 }).map((_, x) => ({
      instanceId: `b_p${x + 1}`,
      typeId: "pawn_black",
      side: "black",
      x,
      y: 1,
      state: {},
    })),
  ];

  const classicSetup: GameSetup = {
    id: "setup_classic_8x8",
    name: "Classic Chess Start (Capture-the-King)",
    boardId: classicBoard.id,
    sides: ["white", "black"],
    pieceTypes: [king, queen, rook, bishop, knight, pawnWhite, pawnBlack],
    winCondition: { type: "captureTag", tag: "king" },
    placedPieces: classicPieces,
  };

  upsertDoc("piece_type", DEMO_USER_ID, queen.id, queen.name, queen);
  upsertDoc("piece_type", DEMO_USER_ID, bishop.id, bishop.name, bishop);
  upsertDoc("piece_type", DEMO_USER_ID, knight.id, knight.name, knight);
  upsertDoc("piece_type", DEMO_USER_ID, pawnWhite.id, pawnWhite.name, pawnWhite);
  upsertDoc("piece_type", DEMO_USER_ID, pawnBlack.id, pawnBlack.name, pawnBlack);
  upsertDoc("board", DEMO_USER_ID, classicBoard.id, classicBoard.name, classicBoard);
  upsertDoc("setup", DEMO_USER_ID, classicSetup.id, classicSetup.name, classicSetup);
}
