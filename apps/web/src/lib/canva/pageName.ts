// Four digits at most, because the page-upload route's own query pattern is
// `[1-9][0-9]{0,3}` -- a longer run of digits is a title that happens to be
// numeric, not a page number.
const BARE_NUMBER = /^(\d{1,4})$/u;
const NUMBER_AND_TITLE = /^(\d{1,4})\s*-\s*(.*)$/u;

export interface ParsedPageName {
  page_number: number | null;
  title: string | null;
}

// The number read here is a sort key and nothing else: the API demands page
// numbers of exactly 1..n, so the caller assigns the ones it sends.
export function parsePageName(entryName: string): ParsedPageName {
  const base = entryName.slice(entryName.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  // A leading dot is a dotfile rather than an extension, so only a dot with
  // something in front of it ends the stem.
  const stem = (dot > 0 ? base.slice(0, dot) : base).trim();

  const bare = BARE_NUMBER.exec(stem);
  if (bare) return { page_number: Number(bare[1]), title: null };

  // Only the first dash splits, so "3 - Ace - of - coins" keeps its own dashes.
  const titled = NUMBER_AND_TITLE.exec(stem);
  if (titled) return { page_number: Number(titled[1]), title: titled[2].trim() || null };

  return { page_number: null, title: stem || null };
}
