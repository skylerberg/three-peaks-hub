import { type } from 'arktype';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@three-peaks/shared';

export const uuid = type('string.uuid');
export const email = type('string.email').to('string <= 320');

// C0 and C1 control characters, plus the line and paragraph separators. Any of
// these renders as something other than what was stored wherever it is
// displayed, and a few of them reorder the text around them.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;

// Trims first, so a string of spaces is short rather than long.
export const stringWithLength = (min: number, max: number) =>
  type('string')
    .pipe((value: string) => value.trim())
    .narrow((value: string, ctx) => {
      if (value.length < min) return ctx.mustBe(`at least ${min} characters after trimming`);
      if (value.length > max) return ctx.mustBe(`at most ${max} characters`);
      if (CONTROL_CHARACTERS.test(value)) return ctx.mustBe('free of control characters');
      return true;
    });

// Normalizes an empty string to null, so "cleared" and "absent" are one value
// in the database rather than two that every read has to handle.
export const optionalText = (max: number) =>
  type('string | null | undefined').pipe((value: string | null | undefined) => {
    if (value === null || value === undefined) return null;
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed.slice(0, max);
  });

export const password = type(`string >= ${PASSWORD_MIN_LENGTH}`).to(
  `string <= ${PASSWORD_MAX_LENGTH}`
);

// A numeric bound written the way ArkType parses it. Generic over the two ends
// rather than taking `number`, because ArkType reads the string as a type:
// widened to `string` it has nothing to infer from.
export const numberRange = <Min extends number, Max extends number>([min, max]: readonly [
  Min,
  Max,
]) => `${min} <= number <= ${max}` as const;

export const idSchema = type({ id: uuid });

// Every project-scoped listing takes exactly this and nothing more. Shared
// rather than restated per route: two identical exports would give one shape
// two component names, and the $ref the spec writes would depend on the order
// the barrel happened to be walked in.
export const projectQuerySchema = type({ project_id: uuid });
