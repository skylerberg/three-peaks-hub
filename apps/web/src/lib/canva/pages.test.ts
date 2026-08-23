import {
  IMPORT_TITLE_MAX_LENGTH,
  MAX_DECK_CARDS,
  MAX_UPLOAD_BYTES,
  formatBytes,
} from '@three-peaks/shared';
import { describe, expect, it } from 'vitest';
import { readCanvaExport } from './pages.ts';
import { buildZip, zipBlob } from './testZip.ts';
import { ZipError } from './zip.ts';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function png(fill = 0, length = 32): Uint8Array {
  const bytes = new Uint8Array(length).fill(fill);
  bytes.set(PNG_MAGIC, 0);
  return bytes;
}

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

type Entries = Parameters<typeof buildZip>[0];

async function read(entries: Entries) {
  return await readCanvaExport(zipBlob(await buildZip(entries)));
}

async function refusal(entries: Entries) {
  try {
    await read(entries);
  } catch (caught) {
    expect(caught).toBeInstanceOf(ZipError);
    return (caught as ZipError).message;
  }
  throw new Error('readCanvaExport resolved where it should have refused');
}

describe('readCanvaExport', () => {
  // The API takes 1..n each exactly once and answers 422 otherwise, so an
  // export whose page 2 was deleted in Canva has to be closed up here.
  it('numbers the pages 1..n even when the export skips one', async () => {
    const pages = await read([
      { name: '1.png', bytes: png(1) },
      { name: '3 - Ace of coins.png', bytes: png(3) },
      { name: '4.png', bytes: png(4) },
    ]);

    expect(pages.map((page) => page.page_number)).toEqual([1, 2, 3]);
    expect(pages.map((page) => page.title)).toEqual([null, 'Ace of coins', null]);
  });

  it('orders numbered pages ahead of unnumbered ones, keeping directory order within each', async () => {
    const pages = await read([
      { name: 'cover.png', bytes: png(1) },
      { name: '2.png', bytes: png(2) },
      { name: 'back.png', bytes: png(3) },
      { name: '1.png', bytes: png(4) },
    ]);

    expect(pages.map((page) => page.entryName)).toEqual([
      '1.png',
      '2.png',
      'cover.png',
      'back.png',
    ]);
    expect(pages.map((page) => page.page_number)).toEqual([1, 2, 3, 4]);
  });

  // `title: ''` and `title: null` are both 422s on the manifest, so an untitled
  // page has to arrive with no title at all.
  it('omits the title for an untitled page rather than sending an empty one', async () => {
    const pages = await read([{ name: '1 -   .png', bytes: png(1) }]);

    expect(pages[0].title).toBeNull();
  });

  it('ignores __MACOSX entries, AppleDouble forks, .DS_Store and directory entries', async () => {
    const pages = await read([
      { name: 'export/', bytes: new Uint8Array(0) },
      { name: '__MACOSX/export/._1.png', bytes: png(9) },
      { name: 'export/._2.png', bytes: png(9) },
      { name: 'export/.DS_Store', bytes: encode('Bud1 junk') },
      { name: 'export/1.png', bytes: png(1) },
    ]);

    expect(pages).toHaveLength(1);
    expect(pages[0].entryName).toBe('export/1.png');
    expect(pages[0].content_type).toBe('image/png');
  });

  it('ignores an entry that is not an image', async () => {
    const pages = await read([
      { name: '1.png', bytes: png(1) },
      { name: 'notes.txt', bytes: encode('this is not a page') },
    ]);

    expect(pages.map((page) => page.entryName)).toEqual(['1.png']);
  });

  it('refuses an export with no pages, naming what it did contain', async () => {
    const message = await refusal([
      { name: 'notes.txt', bytes: encode('not a page') },
      { name: 'design.pdf', bytes: encode('%PDF-1.7 not a page either') },
    ]);

    expect(message).toContain('no images');
    expect(message).toContain('notes.txt');
    expect(message).toContain('design.pdf');
  });

  // The bytes of a page that cannot be uploaded are never worth materialising,
  // and the directory declared their size before anything was inflated. Nothing
  // here can inflate: reaching the refusal is the proof nothing tried.
  it('refuses an oversized page on the size the directory declares, before inflating it', async () => {
    const message = await refusal([
      {
        name: '1.png',
        bytes: png(1),
        uncompressedSizeOverride: MAX_UPLOAD_BYTES * 2,
        dataOverride: new Uint8Array([9, 9, 9, 9]),
        method: 8,
      },
    ]);

    expect(message).toBe(
      `“1.png” is ${formatBytes(MAX_UPLOAD_BYTES * 2)}, over the ` +
        `${formatBytes(MAX_UPLOAD_BYTES)} limit for one upload.`
    );
  });

  // A sixty-page export otherwise holds every page inflated at once, from the
  // moment the plan is drawn to the moment the last one is posted.
  it('lets go of a page after reading it, inflating again for the upload', async () => {
    const pages = await read([{ name: '1.png', bytes: png(1, 64), method: 8 }]);

    const first = await pages[0].bytes();
    const second = await pages[0].bytes();

    expect(second).toEqual(png(1, 64));
    expect(second).not.toBe(first);
  });

  // Truncating would change the folded identity key, so the page would land on
  // a new card and tombstone the one it came from.
  it('refuses a title longer than the import limit rather than truncating it', async () => {
    const title = 'a'.repeat(IMPORT_TITLE_MAX_LENGTH + 1);

    const message = await refusal([{ name: `1 - ${title}.png`, bytes: png(1) }]);

    expect(message).toContain(String(IMPORT_TITLE_MAX_LENGTH + 1));
    expect(message).toContain('Rename the page in Canva');
  });

  it('refuses an export with more pages than a deck can hold', async () => {
    const entries = Array.from({ length: MAX_DECK_CARDS + 1 }, (_unused, index) => ({
      name: `${index + 1}.png`,
      bytes: png(index % 256),
    }));

    const message = await refusal(entries);

    expect(message).toContain(`${MAX_DECK_CARDS + 1} pages`);
    expect(message).toContain(String(MAX_DECK_CARDS));
  });
});
