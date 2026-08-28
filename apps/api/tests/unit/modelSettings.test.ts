import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import {
  BOARD_FOLDS,
  DEFAULT_BOARD_SETTINGS,
  DEFAULT_BOX_SETTINGS,
  DEFAULT_CARD_SETTINGS,
  MAX_MODEL_SEED,
  MODEL_KINDS,
  MODEL_LIMITS,
  defaultSettingsFor,
} from '@three-peaks/shared';
import { modelSettingsSchema } from '../../src/schemas/models.ts';

// Read against the schema rather than through the route, because what is at
// stake is that every bound in MODEL_LIMITS reached a field. ArkType accepts an
// undeclared key, so a bound nobody wired up is indistinguishable from one that
// works until a value beyond it is offered -- and the e2e round trip would need
// an upload per number to say so.
function rejects(settings: unknown): boolean {
  return modelSettingsSchema(settings) instanceof type.errors;
}

describe('model settings validation', () => {
  for (const kind of MODEL_KINDS) {
    describe(kind, () => {
      const limits: Record<string, readonly [number, number]> = MODEL_LIMITS[kind];

      it('accepts the defaults the studio starts from', () => {
        expect(rejects(defaultSettingsFor(kind))).toBe(false);
      });

      for (const [field, [min, max]] of Object.entries(limits)) {
        it(`holds ${field} between ${min} and ${max}`, () => {
          const at = (value: number) => ({ ...defaultSettingsFor(kind), [field]: value });
          expect(rejects(at(min))).toBe(false);
          expect(rejects(at(max))).toBe(false);
          expect(rejects(at(min - 0.001))).toBe(true);
          expect(rejects(at(max + 0.001))).toBe(true);
        });
      }
    });
  }

  // Walked rather than listed, because the schema spells the three out as an
  // ArkType string literal and nothing else would notice the two drifting.
  it('accepts every fold BOARD_FOLDS names, and no other', () => {
    for (const fold of BOARD_FOLDS) {
      expect(rejects({ ...DEFAULT_BOARD_SETTINGS, fold })).toBe(false);
    }
    expect(rejects({ ...DEFAULT_BOARD_SETTINGS, fold: 'trifold' })).toBe(true);
  });

  it('refuses a kind outside MODEL_KINDS', () => {
    expect(rejects({ ...DEFAULT_BOX_SETTINGS, kind: 'metal' })).toBe(true);
  });

  it('refuses a colour that is not a six-digit lowercase hex', () => {
    expect(rejects({ ...DEFAULT_CARD_SETTINGS, stock_color: 'bone' })).toBe(true);
    expect(rejects({ ...DEFAULT_BOARD_SETTINGS, edge_color: '#ABCDEF' })).toBe(true);
  });

  // Seeded noise is what makes two exports of one component identical, and a
  // seed the generator cannot represent is a component that renders differently
  // each time it is opened.
  it('refuses a seed that is not an integer inside the generator range', () => {
    expect(rejects({ ...DEFAULT_BOX_SETTINGS, seed: 1.5 })).toBe(true);
    expect(rejects({ ...DEFAULT_BOARD_SETTINGS, seed: MAX_MODEL_SEED + 1 })).toBe(true);
    expect(rejects({ ...DEFAULT_BOARD_SETTINGS, seed: MAX_MODEL_SEED })).toBe(false);
  });

  // A box wraps its own source image, so a second file id is a field the union
  // does not declare -- and one that reached the jsonb column would name a file
  // no access check has ever seen.
  it('does not declare a card back on a box', () => {
    const withBack = { ...DEFAULT_BOX_SETTINGS, back_file_id: null };
    expect(modelSettingsSchema.onDeepUndeclaredKey('delete')(withBack)).not.toHaveProperty(
      'back_file_id'
    );
  });
});
