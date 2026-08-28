import { describe, expect, it } from 'vitest';
import { CARD_PRESETS, matchingCardPreset } from './cards.ts';
import {
  DEFAULT_BOARD_SETTINGS,
  DEFAULT_BOX_SETTINGS,
  DEFAULT_CARD_SETTINGS,
  DEFAULT_WOOD_SETTINGS,
  MODEL_KINDS,
  MODEL_LIMITS,
  WOOD_PRESETS,
  boxNetRegions,
  clampCornerRadius,
  defaultSettingsFor,
  matchingWoodPreset,
} from './models3d.ts';

describe('presets', () => {
  it('has a unique id for every card and wood preset', () => {
    const ids = [...CARD_PRESETS, ...WOOD_PRESETS].map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('names the default card size as a preset', () => {
    expect(matchingCardPreset(DEFAULT_CARD_SETTINGS)?.id).toBe('poker');
  });

  it('names the default wood thickness as a preset', () => {
    expect(matchingWoodPreset(DEFAULT_WOOD_SETTINGS)?.id).toBe('standard');
  });

  it('hands back a copy, so editing one model does not move the default', () => {
    const settings = defaultSettingsFor('card');
    settings.width_mm = 999;
    expect(DEFAULT_CARD_SETTINGS.width_mm).toBe(63);
  });

  it.each(MODEL_KINDS)('has a default for %s whose kind matches', (kind) => {
    expect(defaultSettingsFor(kind).kind).toBe(kind);
  });

  // Reading a field only one kind has is the narrowing itself: the overload has
  // to hand back that kind rather than the union, or this does not compile.
  it('narrows on a literal kind', () => {
    expect(defaultSettingsFor('box').depth_mm).toBe(70);
    expect(defaultSettingsFor('board').fold).toBe('bifold');
  });
});

describe('the defaults sit inside the limits the API enforces', () => {
  it.each(Object.entries(MODEL_LIMITS.card))('card %s', (field, [min, max]) => {
    const value = DEFAULT_CARD_SETTINGS[field as keyof typeof DEFAULT_CARD_SETTINGS];
    expect(value).toBeGreaterThanOrEqual(min);
    expect(value).toBeLessThanOrEqual(max);
  });

  it.each(Object.entries(MODEL_LIMITS.wood))('wood %s', (field, [min, max]) => {
    const value = DEFAULT_WOOD_SETTINGS[field as keyof typeof DEFAULT_WOOD_SETTINGS];
    expect(value).toBeGreaterThanOrEqual(min);
    expect(value).toBeLessThanOrEqual(max);
  });

  it.each(Object.entries(MODEL_LIMITS.box))('box %s', (field, [min, max]) => {
    const value = DEFAULT_BOX_SETTINGS[field as keyof typeof DEFAULT_BOX_SETTINGS];
    expect(value).toBeGreaterThanOrEqual(min);
    expect(value).toBeLessThanOrEqual(max);
  });

  it.each(Object.entries(MODEL_LIMITS.board))('board %s', (field, [min, max]) => {
    const value = DEFAULT_BOARD_SETTINGS[field as keyof typeof DEFAULT_BOARD_SETTINGS];
    expect(value).toBeGreaterThanOrEqual(min);
    expect(value).toBeLessThanOrEqual(max);
  });

  it.each(CARD_PRESETS)('the $id preset fits the card size limits', (preset) => {
    expect(preset.width_mm).toBeLessThanOrEqual(MODEL_LIMITS.card.width_mm[1]);
    expect(preset.height_mm).toBeLessThanOrEqual(MODEL_LIMITS.card.height_mm[1]);
  });
});

describe('clampCornerRadius', () => {
  it('leaves a radius that fits alone', () => {
    expect(clampCornerRadius({ ...DEFAULT_CARD_SETTINGS, corner_radius_mm: 3 })).toBe(3);
  });

  // Past half the shorter side the outline self-intersects rather than getting
  // rounder, so the slider has to stop somewhere.
  it('caps at half the shorter side', () => {
    const settings = { ...DEFAULT_CARD_SETTINGS, width_mm: 40, corner_radius_mm: 30 };
    expect(clampCornerRadius(settings)).toBe(20);
  });

  it('never returns a negative radius', () => {
    expect(clampCornerRadius({ ...DEFAULT_CARD_SETTINGS, corner_radius_mm: -5 })).toBe(0);
  });
});

describe('boxNetRegions', () => {
  const settings = { ...DEFAULT_BOX_SETTINGS, width_mm: 100, height_mm: 60, depth_mm: 40 };

  it('keeps every face inside the image, the right way up', () => {
    for (const [face, rect] of Object.entries(boxNetRegions(settings))) {
      expect(rect.u0, face).toBeGreaterThanOrEqual(0);
      expect(rect.v0, face).toBeGreaterThanOrEqual(0);
      expect(rect.u1, face).toBeLessThanOrEqual(1);
      expect(rect.v1, face).toBeLessThanOrEqual(1);
      expect(rect.u1, face).toBeGreaterThan(rect.u0);
      expect(rect.v1, face).toBeGreaterThan(rect.v0);
    }
  });

  it('never overlaps two faces', () => {
    const rects = Object.values(boxNetRegions(settings));
    for (let a = 0; a < rects.length; a += 1) {
      for (let b = a + 1; b < rects.length; b += 1) {
        const u = Math.min(rects[a].u1, rects[b].u1) - Math.max(rects[a].u0, rects[b].u0);
        const v = Math.min(rects[a].v1, rects[b].v1) - Math.max(rects[a].v0, rects[b].v0);
        expect(Math.min(u, v)).toBeLessThanOrEqual(0);
      }
    }
  });

  it('covers the whole surface and nothing else, leaving the net corners empty', () => {
    const { width_mm: w, height_mm: h, depth_mm: d } = settings;
    const covered = Object.values(boxNetRegions(settings)).reduce(
      (total, rect) => total + (rect.u1 - rect.u0) * (rect.v1 - rect.v0),
      0
    );
    const surface = 2 * (w * h + d * h + w * d);
    expect(covered).toBeCloseTo(surface / ((2 * d + 2 * w) * (2 * d + h)), 12);
  });

  it('gives a cube six faces of equal area', () => {
    const cube = { ...DEFAULT_BOX_SETTINGS, width_mm: 50, height_mm: 50, depth_mm: 50 };
    for (const rect of Object.values(boxNetRegions(cube))) {
      expect((rect.u1 - rect.u0) * (rect.v1 - rect.v0)).toBeCloseTo(1 / 12, 12);
    }
  });

  it('butts the faces edge to edge along the cross', () => {
    const net = boxNetRegions(settings);
    expect(net.left.u1).toBeCloseTo(net.front.u0, 12);
    expect(net.front.u1).toBeCloseTo(net.right.u0, 12);
    expect(net.right.u1).toBeCloseTo(net.back.u0, 12);
    expect(net.back.u1).toBeCloseTo(1, 12);
    expect(net.top.v1).toBeCloseTo(net.front.v0, 12);
    expect(net.front.v1).toBeCloseTo(net.bottom.v0, 12);
    expect(net.bottom.v1).toBeCloseTo(1, 12);
  });
});
