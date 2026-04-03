import { db, nowIso, upsertDoc } from "./db.js";

type PieceTypeDefinition = {
  id: string;
  name: string;
  asset: string;
  assetBySide?: { white?: string; black?: string };
  movementRules: unknown[];
  captureRules: unknown[];
  tags: string[];
  pieceHooks?: string[];
  defaultState?: Record<string, unknown>;
  price?: number;
  displayRepresentation?: string;
  behavior?: {
    slipProbability?: number;
    attentionRadius?: number;
    attentionIdleLimit?: number;
    skinnerForceRepeat?: boolean;
    stageSequence?: string[];
  };
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
  budgetMode?: { enabled: boolean; startingBudget: number };
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

const ORTHO = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];
const DIAG = [
  { dx: 1, dy: 1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: 1 },
  { dx: -1, dy: -1 },
];

export function ensureDemoPreset(): void {
  ensureDemoUser();

  const king: PieceTypeDefinition = {
    id: "king",
    name: "King",
    asset: "/assets/placeholders/king.svg",
    assetBySide: {
      white: "/assets/placeholders/king_white.svg",
      black: "/assets/placeholders/king.svg",
    },
    movementRules: [{ kind: "step", vectors: [...ORTHO, ...DIAG], range: 1, blockers: "all" }],
    captureRules: [],
    tags: ["king"],
    pieceHooks: ["castleLike"],
    price: 12,
  };

  const queen: PieceTypeDefinition = {
    id: "queen",
    name: "Queen",
    asset: "/assets/placeholders/queen.svg",
    assetBySide: {
      white: "/assets/placeholders/queen_white.svg",
      black: "/assets/placeholders/queen.svg",
    },
    movementRules: [{ kind: "slide", vectors: [...ORTHO, ...DIAG], blockers: "all" }],
    captureRules: [],
    tags: ["royal"],
    price: 9,
  };

  const rook: PieceTypeDefinition = {
    id: "rook",
    name: "Rook",
    asset: "/assets/placeholders/rook.svg",
    assetBySide: {
      white: "/assets/placeholders/rook_white.svg",
      black: "/assets/placeholders/rook.svg",
    },
    movementRules: [{ kind: "slide", vectors: ORTHO, blockers: "all" }],
    captureRules: [],
    tags: ["heavy"],
    price: 6,
  };

  const bishop: PieceTypeDefinition = {
    id: "bishop",
    name: "Bishop",
    asset: "/assets/placeholders/bishop.svg",
    assetBySide: {
      white: "/assets/placeholders/bishop_white.svg",
      black: "/assets/placeholders/bishop.svg",
    },
    movementRules: [{ kind: "slide", vectors: DIAG, blockers: "all" }],
    captureRules: [],
    tags: ["minor"],
    price: 4,
  };

  const knight: PieceTypeDefinition = {
    id: "knight",
    name: "Knight",
    asset: "/assets/placeholders/knight.svg",
    assetBySide: {
      white: "/assets/placeholders/knight_white.svg",
      black: "/assets/placeholders/knight.svg",
    },
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
    price: 3,
  };

  const pawn: PieceTypeDefinition = {
    id: "pawn",
    name: "Pawn",
    asset: "/assets/placeholders/pawn.svg",
    assetBySide: {
      white: "/assets/placeholders/pawn_white.svg",
      black: "/assets/placeholders/pawn.svg",
    },
    movementRules: [
      { kind: "step", vectors: [{ dx: 0, dy: 1 }], range: 1, blockers: "all", relativeToSide: true },
      { kind: "step", vectors: [{ dx: 0, dy: 1 }], range: 2, blockers: "all", firstMoveOnly: true, relativeToSide: true },
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

  const wiggler: PieceTypeDefinition = {
    id: "wiggler",
    name: "Wiggler",
    asset: "/assets/placeholders/wiggler.svg",
    assetBySide: {
      white: "/assets/placeholders/wiggler_white.svg",
      black: "/assets/placeholders/wiggler.svg",
    },
    movementRules: [{ kind: "step", vectors: ORTHO, range: 1, blockers: "all" }],
    captureRules: [],
    tags: ["custom"],
    pieceHooks: ["noRepeatDirection"],
    defaultState: {
      hasMoved: false,
      moveCount: 0,
      lastMoveDirection: null,
    },
    price: 5,
  };

  const hegel: PieceTypeDefinition = {
    id: "hegel",
    name: "Hegel",
    asset: "/assets/placeholders/queen.svg",
    movementRules: [{ kind: "slide", vectors: [...ORTHO, ...DIAG], blockers: "all" }],
    captureRules: [],
    pieceHooks: ["hegelDialectic"],
    defaultState: { lastDirectionClass: null },
    tags: ["philosophy"],
    price: 11,
  };

  const nietzsche: PieceTypeDefinition = {
    id: "nietzsche",
    name: "Nietzsche",
    asset: "/assets/placeholders/king.svg",
    movementRules: [{ kind: "slide", vectors: [...ORTHO, ...DIAG], blockers: "all" }],
    captureRules: [],
    pieceHooks: ["nietzscheStatic"],
    tags: ["untargetable", "philosophy"],
    price: 7,
  };

  const vygotsky: PieceTypeDefinition = {
    id: "vygotsky",
    name: "Vygotsky",
    asset: "/assets/placeholders/pawn.svg",
    movementRules: [
      { kind: "slide", vectors: [...ORTHO, ...DIAG], blockers: "all" },
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
      { kind: "step", vectors: [{ dx: 0, dy: 1 }], range: 2, blockers: "all", relativeToSide: true },
    ],
    captureRules: [
      { kind: "slide", vectors: [...ORTHO, ...DIAG], blockers: "all" },
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
    pieceHooks: ["vygotskyEvolution"],
    defaultState: { stageIndex: 0 },
    behavior: { stageSequence: ["pawn", "knight", "bishop", "rook", "queen"] },
    tags: ["psychology"],
    price: 8,
  };

  const skinner: PieceTypeDefinition = {
    id: "skinner",
    name: "Skinner",
    asset: "/assets/placeholders/rook.svg",
    movementRules: [{ kind: "slide", vectors: [...ORTHO, ...DIAG], blockers: "all" }],
    captureRules: [],
    pieceHooks: ["skinnerReinforce"],
    defaultState: { mustRepeatAfterReward: false, lastMoveVector: null },
    behavior: { skinnerForceRepeat: true },
    tags: ["psychology"],
    price: 8,
  };

  const freud: PieceTypeDefinition = {
    id: "freud",
    name: "Freud",
    asset: "/assets/placeholders/bishop.svg",
    movementRules: [{ kind: "slide", vectors: [...ORTHO, ...DIAG], blockers: "all" }],
    captureRules: [],
    pieceHooks: ["freudSlip"],
    behavior: { slipProbability: 0.25 },
    tags: ["psychology"],
    price: 7,
  };

  const attention: PieceTypeDefinition = {
    id: "attention_span",
    name: "Attention Span",
    asset: "/assets/placeholders/knight.svg",
    movementRules: [{ kind: "slide", vectors: [...ORTHO, ...DIAG], blockers: "all" }],
    captureRules: [],
    pieceHooks: ["attentionSpanLocal"],
    behavior: { attentionRadius: 1, attentionIdleLimit: 4 },
    defaultState: { turnsSinceMoved: 0 },
    tags: ["cognitive"],
    price: 6,
  };

  const placebo: PieceTypeDefinition = {
    id: "placebo",
    name: "Placebo",
    asset: "/assets/placeholders/queen.svg",
    movementRules: [{ kind: "slide", vectors: DIAG, blockers: "all" }],
    captureRules: [],
    displayRepresentation: "queen",
    tags: ["ui-deception"],
    price: 5,
  };

  const boardDemo: BoardDefinition = {
    id: "board_demo_6x6",
    name: "Demo 6x6",
    width: 6,
    height: 6,
    squareMeta: { light: "#f0d9b5", dark: "#b58863" },
  };

  const setupDemo: GameSetup = {
    id: "setup_demo",
    name: "Demo: King, Rook, Wiggler",
    boardId: boardDemo.id,
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
    budgetMode: { enabled: true, startingBudget: 40 },
  };

  const boardClassic: BoardDefinition = {
    id: "board_classic_8x8",
    name: "Classic 8x8",
    width: 8,
    height: 8,
    squareMeta: { light: "#f0d9b5", dark: "#b58863" },
  };

  const classicPieces: GameSetup["placedPieces"] = [
    { instanceId: "w_r1", typeId: "rook", side: "white", x: 0, y: 7, state: {} },
    { instanceId: "w_n1", typeId: "knight", side: "white", x: 1, y: 7, state: {} },
    { instanceId: "w_b1", typeId: "bishop", side: "white", x: 2, y: 7, state: {} },
    { instanceId: "w_q", typeId: "queen", side: "white", x: 3, y: 7, state: {} },
    { instanceId: "w_k", typeId: "king", side: "white", x: 4, y: 7, state: {} },
    { instanceId: "w_b2", typeId: "bishop", side: "white", x: 5, y: 7, state: {} },
    { instanceId: "w_n2", typeId: "knight", side: "white", x: 6, y: 7, state: {} },
    { instanceId: "w_r2", typeId: "rook", side: "white", x: 7, y: 7, state: {} },
    ...Array.from({ length: 8 }).map((_, x) => ({ instanceId: `w_p${x + 1}`, typeId: "pawn", side: "white", x, y: 6, state: {} })),
    { instanceId: "b_r1", typeId: "rook", side: "black", x: 0, y: 0, state: {} },
    { instanceId: "b_n1", typeId: "knight", side: "black", x: 1, y: 0, state: {} },
    { instanceId: "b_b1", typeId: "bishop", side: "black", x: 2, y: 0, state: {} },
    { instanceId: "b_q", typeId: "queen", side: "black", x: 3, y: 0, state: {} },
    { instanceId: "b_k", typeId: "king", side: "black", x: 4, y: 0, state: {} },
    { instanceId: "b_b2", typeId: "bishop", side: "black", x: 5, y: 0, state: {} },
    { instanceId: "b_n2", typeId: "knight", side: "black", x: 6, y: 0, state: {} },
    { instanceId: "b_r2", typeId: "rook", side: "black", x: 7, y: 0, state: {} },
    ...Array.from({ length: 8 }).map((_, x) => ({ instanceId: `b_p${x + 1}`, typeId: "pawn", side: "black", x, y: 1, state: {} })),
  ];

  const setupClassic: GameSetup = {
    id: "setup_classic_8x8",
    name: "Classic Chess Start (Capture-the-King)",
    boardId: boardClassic.id,
    sides: ["white", "black"],
    pieceTypes: [king, queen, rook, bishop, knight, pawn],
    winCondition: { type: "captureTag", tag: "king" },
    placedPieces: classicPieces,
    budgetMode: { enabled: true, startingBudget: 40 },
  };

  const catalog = [
    king,
    queen,
    rook,
    bishop,
    knight,
    pawn,
    wiggler,
    hegel,
    nietzsche,
    vygotsky,
    skinner,
    freud,
    attention,
    placebo,
  ];

  for (const piece of catalog) {
    upsertDoc("piece_type", DEMO_USER_ID, piece.id, piece.name, piece);
  }

  upsertDoc("board", DEMO_USER_ID, boardDemo.id, boardDemo.name, boardDemo);
  upsertDoc("board", DEMO_USER_ID, boardClassic.id, boardClassic.name, boardClassic);
  upsertDoc("setup", DEMO_USER_ID, setupDemo.id, setupDemo.name, setupDemo);
  upsertDoc("setup", DEMO_USER_ID, setupClassic.id, setupClassic.name, setupClassic);
}
