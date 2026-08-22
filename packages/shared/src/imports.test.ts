import { describe, expect, it } from 'vitest';
import { IMPORT_TITLE_MAX_LENGTH, deckIdentityKey, deckPageFilename } from './imports.ts';

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

describe('deckPageFilename', () => {
  it('reproduces the name the ZIP entry already has', () => {
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
