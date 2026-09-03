import { describe, expect, it } from 'vitest';
import {
  IMPORT_TITLE_MAX_LENGTH,
  deckIdentityKey,
  deckPageFilename,
  isDeckBackTitle,
  normalizeSourceLabel,
} from './imports.ts';

describe('deckIdentityKey', () => {
  it('gives a composed and a decomposed title the same key', () => {
    expect(deckIdentityKey(1, 'Café')).toBe(deckIdentityKey(1, 'Café'));
  });

  it('ignores a double space somebody typed between two exports', () => {
    expect(deckIdentityKey(2, 'Goblin  Scout ')).toBe(deckIdentityKey(2, 'Goblin Scout'));
  });

  it('folds case, so a re-titled capital is not a new card', () => {
    expect(deckIdentityKey(3, 'GOBLIN')).toBe(deckIdentityKey(3, 'goblin'));
  });

  it('falls back to the page number when there is no title', () => {
    expect(deckIdentityKey(7)).toBe('n:7');
    expect(deckIdentityKey(7, '   ')).toBe('n:7');
  });

  it('keeps a page titled "#7" apart from untitled page 7', () => {
    expect(deckIdentityKey(7, '#7')).not.toBe(deckIdentityKey(7));
  });

  it('stays inside the bound even when lower-casing lengthens the title', () => {
    const key = deckIdentityKey(1, 'İ'.repeat(IMPORT_TITLE_MAX_LENGTH));
    expect(key.length).toBeLessThanOrEqual(IMPORT_TITLE_MAX_LENGTH + 2);
  });
});

describe('isDeckBackTitle', () => {
  it('reads the page an export names the back', () => {
    expect(isDeckBackTitle('Back')).toBe(true);
  });

  it('folds case and spacing the way the identity key does', () => {
    expect(isDeckBackTitle('BACK')).toBe(true);
    expect(isDeckBackTitle('  back ')).toBe(true);
  });

  it('leaves a card that merely mentions a back alone', () => {
    expect(isDeckBackTitle('Back of beyond')).toBe(false);
    expect(isDeckBackTitle('Player back')).toBe(false);
    expect(isDeckBackTitle('Backs')).toBe(false);
  });

  it('is false for a page with no title at all', () => {
    expect(isDeckBackTitle(null)).toBe(false);
    expect(isDeckBackTitle(undefined)).toBe(false);
    expect(isDeckBackTitle('   ')).toBe(false);
  });
});

describe('deckPageFilename', () => {
  it('names a card after the page number and the page title', () => {
    expect(deckPageFilename(3, 'Draft Deck Back', 'png')).toBe('3 - Draft Deck Back.png');
  });

  it('is the page number alone when the page has no title', () => {
    expect(deckPageFilename(1, null, 'png')).toBe('1.png');
  });

  it('keeps a separator out of the name', () => {
    expect(deckPageFilename(4, 'Fire/Ice', 'jpeg')).toBe('4 - Fire-Ice.jpeg');
  });

  it('leaves room for the suffix a taken name gets', () => {
    const name = deckPageFilename(9, 'x'.repeat(400), 'png');
    expect(name.length).toBeLessThanOrEqual(255 - 6);
  });
});

describe('normalizeSourceLabel', () => {
  it('leaves an ordinary design name alone', () => {
    expect(normalizeSourceLabel('Base game')).toBe('Base game');
  });

  it('trims, so a padded name and the label stored from it are one value', () => {
    expect(normalizeSourceLabel('  Base game  ')).toBe('Base game');
  });

  it('truncates to the length the label column takes', () => {
    const name = `${'a'.repeat(IMPORT_TITLE_MAX_LENGTH)} and more`;
    expect(normalizeSourceLabel(name)).toBe(name.slice(0, IMPORT_TITLE_MAX_LENGTH));
  });

  // Trimming after truncating would leave the space a cut in the middle of one
  // exposes, and the two sides would disagree by exactly that.
  it('trims before it truncates', () => {
    const name = ` ${'a'.repeat(IMPORT_TITLE_MAX_LENGTH + 5)}`;
    expect(normalizeSourceLabel(name)).toBe('a'.repeat(IMPORT_TITLE_MAX_LENGTH));
  });

  it('reads a name that is nothing but whitespace as no label at all', () => {
    expect(normalizeSourceLabel('   ')).toBeNull();
    expect(normalizeSourceLabel(null)).toBeNull();
    expect(normalizeSourceLabel(undefined)).toBeNull();
  });

  it('is idempotent, so a stored label folds to itself', () => {
    const once = normalizeSourceLabel(` ${'b'.repeat(400)} `);
    expect(normalizeSourceLabel(once)).toBe(once);
  });
});
