import { describe, expect, it } from 'vitest';
import {
  CARD_PRESETS,
  DEFAULT_CARD_SETTINGS,
  DEFAULT_WOOD_SETTINGS,
  MODEL_LIMITS,
  WOOD_PRESETS,
  clampCornerRadius,
  defaultSettingsFor,
  matchingCardPreset,
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
    expect(DEFAULT_CARD_SETTINGS.width_mm).toBe(63.5);
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
