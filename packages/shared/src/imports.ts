// A Canva export is a ZIP whose entries are named after the page number and the
// page title -- `1.png`, `3 - Draft Deck Back.png`. Both halves of that name are
// read here so the browser and the API agree on what a page is called and which
// card it is, rather than each folding a title its own way.

export const IMPORT_SOURCE_KINDS = ['zip'] as const;

export const IMPORT_OUTCOMES = ['added', 'updated', 'unchanged', 'removed'] as const;

export const IMPORT_MATCHED_BY = ['identity', 'page_number'] as const;

export const IMPORT_TITLE_MAX_LENGTH = 200;

// What a run did, cached on the row and derived again on every read.
export interface ImportRunSummary {
  pages: number;
  added: number;
  updated: number;
  unchanged: number;
  removed: number;
  restored: number;
}

// NFC first, because "é" as one code point and as "e" plus a combining accent
// are different bytes and the unique index compares bytes -- a title that made
// the round trip through a ZIP entry name on macOS arrives decomposed.
// Whitespace is collapsed next, or an invisible double space between two
// exports reads as a different card and tombstones the original. The slice
// comes last, because lower-casing a string can lengthen it.
function foldTitle(title: string): string {
  return title
    .normalize('NFC')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase()
    .slice(0, IMPORT_TITLE_MAX_LENGTH);
}

// Prefixed by kind, which is what keeps a page genuinely titled "#7" and an
// untitled page 7 apart instead of silently merging them. `p:` is the third
// prefix, taken from a mapping row's id when two pages in one export claim the
// same title.
export function deckIdentityKey(pageNumber: number, title?: string | null): string {
  const folded = title === null || title === undefined ? '' : foldTitle(title);
  return folded.length === 0 ? `n:${pageNumber}` : `t:${folded}`;
}

// Reserved so the suffix a taken name gets -- " (999)" -- never has to truncate
// what is left.
const SUFFIX_RESERVE = 6;

const MAX_FILENAME_LENGTH = 255;

// Reproduces the ZIP entry's own name, because that is what someone who
// unzipped the export by hand already has on disk. `extension` carries no dot.
export function deckPageFilename(
  pageNumber: number,
  title: string | null,
  extension: string
): string {
  const cleaned =
    title === null
      ? ''
      : title.normalize('NFC').replace(/[/\\]/gu, '-').replace(/\s+/gu, ' ').trim();
  const base = cleaned.length === 0 ? `${pageNumber}` : `${pageNumber} - ${cleaned}`;
  const room = MAX_FILENAME_LENGTH - extension.length - 1 - SUFFIX_RESERVE;
  return `${base.slice(0, room).trim()}.${extension}`;
}
