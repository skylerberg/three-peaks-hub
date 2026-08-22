// The dial-in for turning one uploaded image into one 3D component. Both sides
// need it: the API validates it, and the web app builds geometry from it.
//
// Every length is millimetres, because that is what a manufacturer's spec sheet
// is written in. The exporter is the only place that converts.

import { PANDA_CORNER_RADIUS_MM, cardPreset } from './cards.ts';

export const MODEL_KINDS = ['card', 'wood'] as const;
export type ModelKind = (typeof MODEL_KINDS)[number];

export interface CardModelSettings {
  kind: 'card';
  width_mm: number;
  height_mm: number;
  thickness_mm: number;
  corner_radius_mm: number;
  bevel_mm: number;
  // The image on the reverse. Null prints back_color instead, which is what a
  // deck with an undesigned back looks like.
  back_file_id: string | null;
  back_color: string;
  stock_color: string;
  seed: number;
}

export interface WoodModelSettings {
  kind: 'wood';
  longest_side_mm: number;
  thickness_mm: number;
  bevel_mm: number;
  // Where the outline comes from. Alpha is right for a cutout PNG; luminance
  // traces dark-on-light artwork, which is the only option a JPEG leaves.
  trace_source: 'alpha' | 'luminance';
  trace_threshold: number;
  simplify_tolerance: number;
  // Whether the artwork is also printed on the faces, as a screen-printed
  // token, or whether the wood is left bare and only the outline is used.
  printed: boolean;
  wood_color: string;
  grain_color: string;
  grain_scale: number;
  seed: number;
}

export type ModelSettings = CardModelSettings | WoodModelSettings;

export interface WoodPreset {
  id: string;
  name: string;
  thickness_mm: number;
}

export const WOOD_PRESETS: readonly WoodPreset[] = [
  { id: 'thin-ply', name: 'Thin ply (3 mm)', thickness_mm: 3 },
  { id: 'standard', name: 'Standard (8 mm)', thickness_mm: 8 },
  { id: 'thick', name: 'Thick (10 mm)', thickness_mm: 10 },
];

const DEFAULT_CARD_PRESET = cardPreset('poker');

export const DEFAULT_CARD_SETTINGS: CardModelSettings = {
  kind: 'card',
  width_mm: DEFAULT_CARD_PRESET?.width_mm ?? 63,
  height_mm: DEFAULT_CARD_PRESET?.height_mm ?? 88,
  // 300 gsm card stock, which is what most print houses default to.
  thickness_mm: 0.32,
  corner_radius_mm: PANDA_CORNER_RADIUS_MM,
  bevel_mm: 0.08,
  back_file_id: null,
  back_color: '#1f2933',
  stock_color: '#f5f2ea',
  seed: 1,
};

export const DEFAULT_WOOD_SETTINGS: WoodModelSettings = {
  kind: 'wood',
  longest_side_mm: 30,
  thickness_mm: 8,
  bevel_mm: 0.4,
  trace_source: 'alpha',
  trace_threshold: 0.5,
  simplify_tolerance: 1.2,
  printed: false,
  wood_color: '#c8a165',
  grain_color: '#8a6636',
  grain_scale: 4,
  seed: 1,
};

// Overloaded so a literal kind narrows: the caller that knows it asked for a
// card should not have to re-narrow the union it gets back.
export function defaultSettingsFor(kind: 'card'): CardModelSettings;
export function defaultSettingsFor(kind: 'wood'): WoodModelSettings;
export function defaultSettingsFor(kind: ModelKind): ModelSettings;
export function defaultSettingsFor(kind: ModelKind): ModelSettings {
  return kind === 'card' ? { ...DEFAULT_CARD_SETTINGS } : { ...DEFAULT_WOOD_SETTINGS };
}

// The bounds the API enforces, named once so the web app's number inputs cannot
// offer a value the server will reject.
export const MODEL_LIMITS = {
  card: {
    width_mm: [10, 300],
    height_mm: [10, 300],
    thickness_mm: [0.05, 5],
    corner_radius_mm: [0, 30],
    bevel_mm: [0, 2],
  },
  wood: {
    longest_side_mm: [5, 300],
    thickness_mm: [0.5, 50],
    bevel_mm: [0, 5],
    trace_threshold: [0.01, 0.99],
    simplify_tolerance: [0, 10],
    grain_scale: [0.1, 20],
  },
} as const satisfies Record<ModelKind, Record<string, readonly [number, number]>>;

export const MAX_MODEL_SEED = 2147483647;

// A radius larger than half the shorter side is not a rounder card, it is a
// self-intersecting outline. Clamped rather than rejected, so dragging the
// slider past the limit stops instead of erroring.
export function clampCornerRadius(settings: CardModelSettings): number {
  const limit = Math.min(settings.width_mm, settings.height_mm) / 2;
  return Math.max(0, Math.min(settings.corner_radius_mm, limit));
}

export function woodPreset(id: string): WoodPreset | undefined {
  return WOOD_PRESETS.find((preset) => preset.id === id);
}

export function matchingWoodPreset(settings: WoodModelSettings): WoodPreset | undefined {
  return WOOD_PRESETS.find((preset) => preset.thickness_mm === settings.thickness_mm);
}
