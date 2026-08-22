import { describe, expect, it } from 'vitest';
import { buildZip, extraField, zipBlob } from './testZip.ts';
import { readZip, ZipError } from './zip.ts';
import type { ZipEntry } from './zip.ts';

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

function byName(entries: ZipEntry[], name: string): ZipEntry {
  const found = entries.find((entry) => entry.name === name);
  if (!found) throw new Error(`no entry named ${name} in ${entries.map((e) => e.name).join(', ')}`);
  return found;
}

async function refusal(bytes: Uint8Array): Promise<string> {
  try {
    await readZip(zipBlob(bytes));
  } catch (caught) {
    expect(caught).toBeInstanceOf(ZipError);
    return (caught as ZipError).message;
  }
  throw new Error('readZip resolved where it should have refused');
}

describe('readZip', () => {
  it('reads a stored entry and a deflated entry from one archive', async () => {
    const bytes = await buildZip([
      { name: '1.png', bytes: encode('stored page'), method: 0 },
      { name: '2 - Ace of coins.png', bytes: encode('deflated page '.repeat(20)), method: 8 },
    ]);

    const entries = await readZip(zipBlob(bytes));

    expect(entries.map((entry) => entry.name)).toEqual(['1.png', '2 - Ace of coins.png']);
    expect(text(await entries[0].bytes())).toBe('stored page');
    expect(text(await entries[1].bytes())).toBe('deflated page '.repeat(20));
    expect(entries[1].uncompressedSize).toBe('deflated page '.repeat(20).length);
  });

  it('finds the end-of-central-directory past a signature planted in the archive comment', async () => {
    // A trailing-signature search lands here instead, 27 bytes past the record.
    const comment = new Uint8Array(24);
    comment.set([0x50, 0x4b, 0x05, 0x06], 0);
    const bytes = await buildZip([{ name: '1.png', bytes: encode('page one') }], { comment });

    const entries = await readZip(zipBlob(bytes));

    expect(entries).toHaveLength(1);
    expect(text(await entries[0].bytes())).toBe('page one');
  });

  it("reads each entry's data offset from its own local header, not the central directory's", async () => {
    const bytes = await buildZip([
      {
        name: '1.png',
        bytes: encode('page one'),
        localExtra: extraField(0xdead, 24),
        centralExtra: extraField(0xdead, 20),
      },
    ]);

    const entries = await readZip(zipBlob(bytes));

    expect(text(await entries[0].bytes())).toBe('page one');
  });

  it('takes the sizes from the central directory when the local header defers them', async () => {
    const bytes = await buildZip([
      {
        name: '1.png',
        bytes: encode('a page ditto wrote '.repeat(10)),
        method: 8,
        flags: 0x0008,
        zeroLocalSizes: true,
      },
    ]);

    const entries = await readZip(zipBlob(bytes));

    expect(entries[0].uncompressedSize).toBe('a page ditto wrote '.repeat(10).length);
    expect(text(await entries[0].bytes())).toBe('a page ditto wrote '.repeat(10));
  });

  it('decodes a UTF-8 entry name whose language-encoding flag is clear', async () => {
    const bytes = await buildZip([
      { name: '3 - Déck Bäck.png', bytes: encode('page three'), flags: 0 },
    ]);

    const entries = await readZip(zipBlob(bytes));

    expect(entries[0].name).toBe('3 - Déck Bäck.png');
  });

  it('decodes a CP437 entry name that is not valid UTF-8', async () => {
    // 0x82 is "é" in CP437 and a stray continuation byte in UTF-8.
    const nameBytes = new Uint8Array([0x44, 0x82, 0x63, 0x6b, 0x2e, 0x70, 0x6e, 0x67]);
    const bytes = await buildZip([{ name: 'ignored', nameBytes, bytes: encode('page'), flags: 0 }]);

    const entries = await readZip(zipBlob(bytes));

    expect(entries[0].name).toBe('Déck.png');
  });

  it('reads an archive with no entries as an empty list rather than refusing', async () => {
    const entries = await readZip(zipBlob(await buildZip([])));

    expect(entries).toEqual([]);
  });

  it('keeps directory entries, AppleDouble forks and non-image entries for the caller to judge', async () => {
    const bytes = await buildZip([
      { name: 'export/', bytes: new Uint8Array(0) },
      { name: '__MACOSX/export/._1.png', bytes: encode('resource fork') },
      { name: 'export/.DS_Store', bytes: encode('finder junk') },
      { name: 'export/notes.txt', bytes: encode('not an image') },
      { name: 'export/1.png', bytes: encode('page one') },
    ]);

    const entries = await readZip(zipBlob(bytes));

    expect(entries.map((entry) => entry.name)).toEqual([
      'export/',
      '__MACOSX/export/._1.png',
      'export/.DS_Store',
      'export/notes.txt',
      'export/1.png',
    ]);
    expect(text(await byName(entries, 'export/notes.txt').bytes())).toBe('not an image');
  });

  it('returns no bytes for an entry whose compressed size is zero, without inflating', async () => {
    // Zero bytes into DecompressionStream rejects with the same empty
    // TypeError a corrupt stream does, so this cannot go through the inflater.
    const bytes = await buildZip([
      { name: '1.png', bytes: new Uint8Array(0), method: 8, dataOverride: new Uint8Array(0) },
    ]);

    const entries = await readZip(zipBlob(bytes));

    expect(await entries[0].bytes()).toEqual(new Uint8Array(0));
  });

  it('names the entry when its bytes will not inflate', async () => {
    const bytes = await buildZip([
      {
        name: '2 - Ace of coins.png',
        bytes: encode('page two'),
        method: 8,
        dataOverride: new Uint8Array([9, 9, 9, 9, 9, 9]),
      },
    ]);

    const entries = await readZip(zipBlob(bytes));

    await expect(entries[0].bytes()).rejects.toThrow(
      '“2 - Ace of coins.png” could not be decompressed. The download may be incomplete.'
    );
  });

  it('refuses an entry whose data runs past the end of the file', async () => {
    const bytes = await buildZip([
      { name: '1.png', bytes: encode('page one'), compressedSizeOverride: 4096 },
    ]);

    const entries = await readZip(zipBlob(bytes));

    await expect(entries[0].bytes()).rejects.toThrow(
      '“1.png” is not where the ZIP says it is. Download the export again.'
    );
  });

  it('refuses an entry that is not the size the central directory declares', async () => {
    const bytes = await buildZip([
      { name: '1.png', bytes: encode('page one'), dataOverride: encode('short') },
    ]);

    const entries = await readZip(zipBlob(bytes));

    await expect(entries[0].bytes()).rejects.toThrow(
      '“1.png” holds 5 bytes where the ZIP says 8. Download the export again.'
    );
  });

  it('refuses an entry whose bytes do not match the central directory checksum', async () => {
    // The same length, different bytes: nothing but the crc can tell.
    const bytes = await buildZip([
      { name: '1.png', bytes: encode('page one'), dataOverride: encode('page ONE') },
    ]);

    const entries = await readZip(zipBlob(bytes));

    await expect(entries[0].bytes()).rejects.toThrow(
      '“1.png” does not match the checksum in the ZIP. Download the export again.'
    );
  });

  it('refuses a file with no end-of-central-directory record', async () => {
    expect(await refusal(encode('this is a PNG, not a ZIP'))).toBe(
      'That file is not a ZIP: it has no end-of-central-directory record. Download the export from Canva again.'
    );
  });

  it('refuses a compression method it cannot read, naming the entry and the method', async () => {
    const bytes = await buildZip([
      { name: '1.png', bytes: encode('page one'), method: 14 as unknown as 0 },
    ]);

    expect(await refusal(bytes)).toBe(
      '“1.png” uses compression method 14, which this cannot read. Re-export it from Canva.'
    );
  });

  it('names the compression method for the versions APPNOTE gives BZIP2 and LZMA', async () => {
    // 4.6 and 6.3 are those two methods, not ZIP64, so a ZIP64 test that reads
    // version-needed first refuses these with a reason that is simply untrue.
    const bzip2 = await buildZip([
      { name: '1.png', bytes: encode('x'), method: 12 as unknown as 0, versionNeeded: 46 },
    ]);
    const lzma = await buildZip([
      { name: '2.png', bytes: encode('x'), method: 14 as unknown as 0, versionNeeded: 63 },
    ]);

    expect(await refusal(bzip2)).toBe(
      '“1.png” uses compression method 12, which this cannot read. Re-export it from Canva.'
    );
    expect(await refusal(lzma)).toBe(
      '“2.png” uses compression method 14, which this cannot read. Re-export it from Canva.'
    );
  });

  it('refuses a password-protected entry', async () => {
    const classic = await buildZip([{ name: '1.png', bytes: encode('x'), flags: 0x0001 }]);
    const strong = await buildZip([{ name: '1.png', bytes: encode('x'), flags: 0x0040 }]);
    const masked = await buildZip([{ name: '1.png', bytes: encode('x'), flags: 0x2000 }]);

    for (const bytes of [classic, strong, masked]) {
      expect(await refusal(bytes)).toBe(
        'That ZIP is password-protected, so its pages cannot be read.'
      );
    }
  });

  it('refuses a multi-volume archive', async () => {
    const split = await buildZip([{ name: '1.png', bytes: encode('x') }], { startDisk: 1 });
    const counted = await buildZip([{ name: '1.png', bytes: encode('x') }], { diskEntries: 0 });
    const elsewhere = await buildZip([{ name: '1.png', bytes: encode('x'), entryDisk: 2 }]);

    for (const bytes of [split, counted, elsewhere]) {
      expect(await refusal(bytes)).toBe(
        'That ZIP is split across several volumes, which this cannot read.'
      );
    }
  });

  it('refuses a ZIP64 archive however it says so', async () => {
    const page = { name: '1.png', bytes: encode('page one') };
    // What a ZIP64 writer actually lays down between the directory and the
    // tail: its own end record, then the 20-byte locator.
    const locator = new Uint8Array(20);
    locator.set([0x50, 0x4b, 0x06, 0x07], 0);
    const endRecord = new Uint8Array(56);
    endRecord.set([0x50, 0x4b, 0x06, 0x06], 0);
    const tail = new Uint8Array([...endRecord, ...locator]);

    const cases = [
      await buildZip([page], { directoryOffset: 0xffffffff }),
      await buildZip([page], { directorySize: 0xffffffff }),
      await buildZip([page], { totalEntries: 0xffff, diskEntries: 0xffff }),
      await buildZip([page], { beforeEnd: locator }),
      await buildZip([page], { beforeEnd: tail }),
      await buildZip([{ ...page, sizeSentinel: true }]),
      await buildZip([{ ...page, versionNeeded: 45 }]),
      await buildZip([{ ...page, centralExtra: extraField(0x0001, 16) }]),
    ];

    for (const bytes of cases) {
      expect(await refusal(bytes)).toBe(
        'That ZIP uses the ZIP64 format, which this cannot read. Export fewer pages at a time, or unzip it and upload the images.'
      );
    }
  });

  it('refuses a central directory that runs past its own length', async () => {
    const bytes = await buildZip(
      [
        { name: '1.png', bytes: encode('page one') },
        { name: '2.png', bytes: encode('page two') },
      ],
      { directorySize: 40 }
    );

    expect(await refusal(bytes)).toBe(
      'That ZIP’s directory is damaged (entry 1 of 2). Download the export again.'
    );
  });

  it('refuses a central directory that is not where the end record says', async () => {
    const bytes = await buildZip([{ name: '1.png', bytes: encode('page one') }], {
      directoryOffset: 0,
    });

    expect(await refusal(bytes)).toBe(
      'That ZIP’s directory is damaged (entry 1 of 1). Download the export again.'
    );
  });
});
