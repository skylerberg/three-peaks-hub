import { describe, expect, it } from 'vitest';
import { parsePageName } from './pageName.ts';

describe('parsePageName', () => {
  it('reads "3 - Draft Deck Back.png" as page 3 titled Draft Deck Back', () => {
    expect(parsePageName('3 - Draft Deck Back.png')).toEqual({
      page_number: 3,
      title: 'Draft Deck Back',
    });
  });

  it('reads "12.png" as page 12 with no title', () => {
    expect(parsePageName('12.png')).toEqual({ page_number: 12, title: null });
  });

  it('keeps an unnumbered stem as the title, with no page number', () => {
    expect(parsePageName('Ace of coins.png')).toEqual({
      page_number: null,
      title: 'Ace of coins',
    });
  });

  it('tolerates the spacing around the dash', () => {
    for (const name of ['4-Knight.png', '4 -Knight.png', '4- Knight.png', '4   -   Knight.png']) {
      expect(parsePageName(name)).toEqual({ page_number: 4, title: 'Knight' });
    }
  });

  it('keeps a hyphen inside a title', () => {
    expect(parsePageName('3 - Ace - of - coins.png')).toEqual({
      page_number: 3,
      title: 'Ace - of - coins',
    });
  });

  it('strips only the last extension', () => {
    expect(parsePageName('1 - v1.2.png')).toEqual({ page_number: 1, title: 'v1.2' });
  });

  it('reads a name with no extension at all', () => {
    expect(parsePageName('7 - Knight')).toEqual({ page_number: 7, title: 'Knight' });
    expect(parsePageName('7')).toEqual({ page_number: 7, title: null });
  });

  it('reads the basename out of a path', () => {
    expect(parsePageName('export/pages/2 - Ace of coins.png')).toEqual({
      page_number: 2,
      title: 'Ace of coins',
    });
  });

  it('does not read a run of five digits as a page number', () => {
    expect(parsePageName('12345.png')).toEqual({ page_number: null, title: '12345' });
  });

  it('keeps a dotfile whole rather than reading it as an extension', () => {
    expect(parsePageName('__MACOSX/.DS_Store')).toEqual({
      page_number: null,
      title: '.DS_Store',
    });
  });

  it('has no title when the stem is only whitespace', () => {
    expect(parsePageName('   .png')).toEqual({ page_number: null, title: null });
    expect(parsePageName('5 -   .png')).toEqual({ page_number: 5, title: null });
  });
});
