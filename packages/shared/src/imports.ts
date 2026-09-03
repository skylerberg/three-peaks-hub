// What a page of an export is called, and which card it is. Both are decided
// here so the browser and the API agree rather than each folding a title its
// own way.
//
// A design is read by the Canva app, which knows three things about a page: its
// number, its title, and the page's own id. The id is the strongest of them and
// is a column of its own rather than a third prefix on the identity key: a card
// keeps its title key as well, so a page that is copied -- minting a new id and
// keeping the title -- still lands on the card it is a copy of.
//
// Measured against Canva rather than assumed: a page id survives a rename, a
// reorder, and being carried into a duplicate of the whole design. What mints a
// new one is duplicating a PAGE -- the copy gets its own id and keeps the
// title, which is the case only the id can tell apart.

export const IMPORT_OUTCOMES = ['added', 'updated', 'unchanged', 'removed'] as const;

// The tiers a page can match a card on, strongest first. Reported per row,
// because which one caught a page is what says how much to trust it.
export const IMPORT_MATCHED_BY = ['page_id', 'identity', 'page_number'] as const;

export const IMPORT_TITLE_MAX_LENGTH = 200;

// A source's own id for a page. Canva's are short and opaque; the bound is
// generous because nothing here parses one, and it exists so an identity key
// cannot be made arbitrarily long by the caller.
export const IMPORT_PAGE_ID_MAX_LENGTH = 128;

// What the API keeps when it is handed the name a design goes by: trimmed, cut
// to the length above, and nothing at all when that leaves it empty. It is what
// a deck shows as the thing it was last imported from. Trimming precedes the
// cut, or a name cut mid-space carries a trailing space into the row.
export function normalizeSourceLabel(label: string | null | undefined): string | null {
  if (label === null || label === undefined) return null;
  const trimmed = label.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, IMPORT_TITLE_MAX_LENGTH);
}

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
// are different bytes and the unique index compares bytes -- and which of the
// two a title arrives as is not something the sending end promises.
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

// The one page of an export that is not a card. A deck has one back and every
// export carries it as an ordinary page, so its title is the only thing saying
// which -- folded exactly the way an identity key is, so "BACK" and " Back "
// name the back rather than two more cards.
//
// Not a tier of its own and not folded into the identity key: a back is matched,
// renamed, versioned and carried forward like every other page. What it is not
// is a face, which is why the import gives it no copies.
const DECK_BACK_TITLE = 'back';

export function isDeckBackTitle(title: string | null | undefined): boolean {
  if (title === null || title === undefined) return false;
  return foldTitle(title) === DECK_BACK_TITLE;
}

// Reserved so the suffix a taken name gets -- " (999)" -- never has to truncate
// what is left.
const SUFFIX_RESERVE = 6;

const MAX_FILENAME_LENGTH = 255;

// What an imported page is called once it is a card: the page number and the
// page's own title, which is how somebody reading the deck finds the page they
// are looking at in Canva. `extension` carries no dot.
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
