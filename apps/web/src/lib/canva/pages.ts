import {
  IMPORT_TITLE_MAX_LENGTH,
  MAX_DECK_CARDS,
  MAX_UPLOAD_BYTES,
  formatBytes,
} from '@three-peaks/shared';
import { parsePageName } from './pageName.ts';
import { sniffImageType } from './sniff.ts';
import { ZipError, readZip } from './zip.ts';

export interface CanvaPage {
  page_number: number;
  title: string | null;
  content_type: string;
  byte_size: number;
  // Kept for the messages only. What a page is called once it lands is built
  // from its number and its title by deckPageFilename.
  entryName: string;
  bytes(): Promise<Uint8Array>;
}

// What the API's own title rule refuses. Stripping one instead would change the
// identity key, which tombstones the card the page came from.
// eslint-disable-next-line no-control-regex -- these bytes are what it looks for
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/u;

const NAMES_IN_REFUSAL = 5;

function isIgnorable(name: string): boolean {
  if (name.endsWith('/')) return true;
  const segments = name.split('/');
  const base = segments.at(-1) ?? '';
  return segments.includes('__MACOSX') || base.startsWith('._') || base === '.DS_Store';
}

function listNames(names: readonly string[]): string {
  const shown = names.slice(0, NAMES_IN_REFUSAL).join(', ');
  const rest = names.length - NAMES_IN_REFUSAL;
  return rest > 0 ? `${shown}, and ${rest} more` : shown;
}

interface ReadPage {
  parsedNumber: number | null;
  title: string | null;
  contentType: string;
  byteSize: number;
  entryName: string;
  read: () => Promise<Uint8Array>;
}

export async function readCanvaExport(file: Blob): Promise<CanvaPage[]> {
  const entries = await readZip(file);
  const skipped: string[] = [];
  const pages: ReadPage[] = [];

  for (const entry of entries) {
    if (isIgnorable(entry.name) || entry.uncompressedSize === 0) {
      skipped.push(entry.name);
      continue;
    }

    // The size the central directory declares, before anything is inflated:
    // the bytes of a page that cannot be uploaded are not worth paying for, and
    // zip.ts holds that declaration to what actually comes out.
    if (entry.uncompressedSize > MAX_UPLOAD_BYTES) {
      throw new ZipError(
        `“${entry.name}” is ${formatBytes(entry.uncompressedSize)}, over the ` +
          `${formatBytes(MAX_UPLOAD_BYTES)} limit for one page.`
      );
    }

    // Inflated here and then let go, and inflated again when the page is
    // posted: holding all of them means a sixty-page export sits in memory
    // twice over from the plan until the last upload. Judging by extension
    // instead is what puts "that page is not an image" at page 40 of 54.
    const bytes = await entry.bytes();
    const contentType = sniffImageType(bytes);
    if (contentType === null) {
      skipped.push(entry.name);
      continue;
    }

    const parsed = parsePageName(entry.name);
    pages.push({
      parsedNumber: parsed.page_number,
      title: parsed.title,
      contentType,
      byteSize: bytes.length,
      entryName: entry.name,
      read: () => entry.bytes(),
    });
  }

  if (pages.length === 0) {
    throw new ZipError(
      skipped.length === 0
        ? 'That ZIP has nothing in it at all. Download the export from Canva again.'
        : `That ZIP has no images in it. It contains: ${listNames(skipped)}.`
    );
  }

  for (const page of pages) {
    if (page.title !== null && page.title.length > IMPORT_TITLE_MAX_LENGTH) {
      throw new ZipError(
        `“${page.entryName}” has a title of ${page.title.length} characters; the limit ` +
          `is ${IMPORT_TITLE_MAX_LENGTH}. Rename the page in Canva and export it again.`
      );
    }
    if (page.title !== null && CONTROL_CHARACTERS.test(page.title)) {
      throw new ZipError(
        `“${page.entryName}” has a title with characters the import cannot store.`
      );
    }
  }

  if (pages.length > MAX_DECK_CARDS) {
    throw new ZipError(
      `That export has ${pages.length} pages; a deck holds at most ${MAX_DECK_CARDS}.`
    );
  }

  // Numbered pages first in their own order, then the rest in the order the
  // directory lists them.
  const ordered = pages
    .map((page, index) => ({ page, index }))
    .sort(
      (a, b) =>
        (a.page.parsedNumber ?? Number.MAX_SAFE_INTEGER) -
          (b.page.parsedNumber ?? Number.MAX_SAFE_INTEGER) || a.index - b.index
    )
    .map((entry) => entry.page);

  // The API takes 1..n, each once, so an export missing a page is renumbered
  // rather than passed through. That costs an untitled page its identity --
  // `n:<page number>` moves with it -- which is why the plan says, per row,
  // whether a card was matched by its number.
  return ordered.map((page, index) => ({
    page_number: index + 1,
    title: page.title,
    content_type: page.contentType,
    byte_size: page.byteSize,
    entryName: page.entryName,
    bytes: page.read,
  }));
}
