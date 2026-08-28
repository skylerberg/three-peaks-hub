import { type } from 'arktype';
import { MAX_MODEL_SEED, MODEL_LIMITS } from '@three-peaks/shared';
import { numberRange as range } from './common.ts';

const { board, box, card, wood } = MODEL_LIMITS;

// Bounds come from packages/shared so the web app's inputs cannot offer a value
// this rejects, and a number without them is how a thickness of 1e9 reaches the
// extruder and hangs the tab.

const seed = type(`0 <= number.integer <= ${MAX_MODEL_SEED}`);

// What <input type="color"> produces, and the only form the material builders
// parse.
const hexColor = type('/^#[0-9a-f]{6}$/');

export const cardModelSettingsSchema = type({
  kind: "'card'",
  width_mm: range(card.width_mm),
  height_mm: range(card.height_mm),
  thickness_mm: range(card.thickness_mm),
  corner_radius_mm: range(card.corner_radius_mm),
  bevel_mm: range(card.bevel_mm),
  back_file_id: 'string.uuid | null',
  back_color: hexColor,
  stock_color: hexColor,
  seed,
});

export const woodModelSettingsSchema = type({
  kind: "'wood'",
  longest_side_mm: range(wood.longest_side_mm),
  thickness_mm: range(wood.thickness_mm),
  bevel_mm: range(wood.bevel_mm),
  trace_source: "'alpha' | 'luminance'",
  trace_threshold: range(wood.trace_threshold),
  simplify_tolerance: range(wood.simplify_tolerance),
  printed: 'boolean',
  wood_color: hexColor,
  grain_color: hexColor,
  grain_scale: range(wood.grain_scale),
  seed,
});

// A box is wrapped in the row's own source image, so the net has no file ids
// of its own -- boxNetRegions in packages/shared decides which part of that one
// image lands on which face.
export const boxModelSettingsSchema = type({
  kind: "'box'",
  width_mm: range(box.width_mm),
  height_mm: range(box.height_mm),
  depth_mm: range(box.depth_mm),
  corner_bevel_mm: range(box.corner_bevel_mm),
  seed,
});

export const boardModelSettingsSchema = type({
  kind: "'board'",
  width_mm: range(board.width_mm),
  height_mm: range(board.height_mm),
  thickness_mm: range(board.thickness_mm),
  // Spelled out rather than joined from BOARD_FOLDS: ArkType reads the string
  // as a type, and a runtime join widens to `string` with nothing to infer.
  // A test walks BOARD_FOLDS so the two cannot drift apart unnoticed.
  fold: "'none' | 'bifold' | 'quadfold'",
  fold_gap_mm: range(board.fold_gap_mm),
  edge_color: hexColor,
  seed,
});

// Discriminated on `kind`, so a card field on a wooden component is a
// validation error rather than a value the builder silently ignores.
export const modelSettingsSchema = cardModelSettingsSchema
  .or(woodModelSettingsSchema)
  .or(boxModelSettingsSchema)
  .or(boardModelSettingsSchema);

export const componentModelSchema = type({
  source_file_id: 'string',
  project_id: 'string',
  settings: modelSettingsSchema,
  updated_by: 'string',
  created_at: 'string',
  updated_at: 'string',
});

export const putComponentModelRequestSchema = type({
  settings: modelSettingsSchema,
});
