import { z } from "zod";

export const SideSchema = z.string().min(1);
export type Side = z.infer<typeof SideSchema>;

export const VectorSchema = z.object({
  dx: z.number().int(),
  dy: z.number().int(),
});

export const BlockerModeSchema = z.enum(["none", "all", "first"]);
export type BlockerMode = z.infer<typeof BlockerModeSchema>;

/** Declarative movement/capture pattern */
export const PatternSchema = z.object({
  kind: z.enum(["step", "slide", "jump"]),
  vectors: z.array(VectorSchema).min(1),
  /** For step/jump: max steps in that direction; omit or 1 for single step. For slide: ignored, slides until edge/block */
  range: z.number().int().positive().optional(),
  blockers: BlockerModeSchema.default("all"),
  firstMoveOnly: z.boolean().optional(),
  requiresUnmoved: z.boolean().optional(),
  moveOnly: z.boolean().optional(),
  captureOnly: z.boolean().optional(),
  hookId: z.string().optional(),
  /** If true, dy is mirrored by side (white = forward up, black = forward down). */
  relativeToSide: z.boolean().optional(),
});

export type Pattern = z.infer<typeof PatternSchema>;

export const PieceTypeDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  asset: z.string(),
  assetBySide: z
    .object({
      white: z.string().optional(),
      black: z.string().optional(),
    })
    .optional(),
  movementRules: z.array(PatternSchema).default([]),
  captureRules: z.array(PatternSchema).default([]),
  constraints: z.record(z.unknown()).optional(),
  stateSchema: z.array(z.string()).optional(),
  tags: z.array(z.string()).default([]),
  defaultState: z.record(z.unknown()).optional(),
  /** Piece-level hooks applied after pattern generation (e.g. noRepeatDirection) */
  pieceHooks: z.array(z.string()).optional(),
  /** Relative in-game purchase cost for budget mode. */
  price: z.number().nonnegative().default(1),
  /** Optional UI-only representation (e.g. placebo displays as queen). */
  displayRepresentation: z.string().optional(),
  /** Behavior config for custom pieces. */
  behavior: z
    .object({
      slipProbability: z.number().min(0).max(1).optional(),
      attentionRadius: z.number().int().positive().optional(),
      attentionIdleLimit: z.number().int().positive().optional(),
      skinnerForceRepeat: z.boolean().optional(),
      stageSequence: z.array(z.string()).optional(),
    })
    .optional(),
});

export type PieceTypeDefinition = z.infer<typeof PieceTypeDefinitionSchema>;

export const PieceInstanceSchema = z.object({
  instanceId: z.string().min(1),
  typeId: z.string().min(1),
  side: SideSchema,
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  state: z.record(z.unknown()).default({}),
});

export type PieceInstance = z.infer<typeof PieceInstanceSchema>;

export const BoardDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  squareMeta: z.record(z.unknown()).optional(),
});

export type BoardDefinition = z.infer<typeof BoardDefinitionSchema>;

export const WinConditionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("captureTag"),
    tag: z.string().min(1),
  }),
]);

export type WinCondition = z.infer<typeof WinConditionSchema>;

export const GameSetupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  boardId: z.string().min(1),
  placedPieces: z.array(PieceInstanceSchema),
  sides: z.array(SideSchema).min(1),
  /** Piece type definitions required for this setup (embedded for portability) */
  pieceTypes: z.array(PieceTypeDefinitionSchema).min(1),
  rulesetId: z.string().optional(),
  winCondition: WinConditionSchema.default({ type: "captureTag", tag: "king" }),
  budgetMode: z
    .object({
      enabled: z.boolean().default(false),
      startingBudget: z.number().int().nonnegative().default(40),
    })
    .optional(),
});

export type GameSetup = z.infer<typeof GameSetupSchema>;
