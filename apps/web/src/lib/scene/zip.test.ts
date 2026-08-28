import { describe, expect, it } from 'vitest';
import { readZip } from '../canva/zip.ts';
import { writeZip, ZipWriteError } from './zip.ts';

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);
const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

async function roundTrip(blob: Blob): Promise<Map<string, Uint8Array>> {
  const entries = await readZip(blob);
  const out = new Map<string, Uint8Array>();
  for (const entry of entries) out.set(entry.name, await entry.bytes());
  return out;
}

describe('writeZip', () => {
  it('round-trips a stored entry and a deflated entry through the reader', async () => {
    const scene = JSON.stringify({ format: 'three-peaks-scene', shots: [] }).repeat(20);
    const glb = new Uint8Array(512).map((_, at) => (at * 7) % 251);

    const read = await roundTrip(
      await writeZip([
        { name: 'scene.json', bytes: encode(scene), compress: true },
        { name: 'assets/card-1.glb', bytes: glb },
      ])
    );

    expect([...read.keys()]).toEqual(['scene.json', 'assets/card-1.glb']);
    expect(text(read.get('scene.json')!)).toBe(scene);
    expect(read.get('assets/card-1.glb')).toEqual(glb);
  });

  it('deflates the entry it is told to and stores the one it is not', async () => {
    const repetitive = encode('{"kind":"card"}'.repeat(400));

    const compressed = await writeZip([{ name: 'a', bytes: repetitive, compress: true }]);
    const stored = await writeZip([{ name: 'a', bytes: repetitive }]);

    expect(compressed.size).toBeLessThan(repetitive.length / 4);
    expect(stored.size).toBeGreaterThan(repetitive.length);
    expect(text((await roundTrip(compressed)).get('a')!)).toBe(text(repetitive));
  });

  it('writes an empty entry the reader can read back', async () => {
    // A genuinely empty deflate stream is two bytes rather than none, and the
    // reader short-circuits zero compressed bytes rather than handing them to a
    // decompressor that rejects them without a message.
    const read = await roundTrip(
      await writeZip([
        { name: 'empty.bin', bytes: new Uint8Array(0) },
        { name: 'empty.json', bytes: new Uint8Array(0), compress: true },
      ])
    );

    expect(read.get('empty.bin')).toEqual(new Uint8Array(0));
    expect(read.get('empty.json')).toEqual(new Uint8Array(0));
  });

  it('flags its names as UTF-8 so a non-ASCII one survives', async () => {
    const name = 'assets/Château—déck.glb';

    const read = await roundTrip(await writeZip([{ name, bytes: encode('art') }]));

    expect([...read.keys()]).toEqual([name]);
  });

  it('is found by the reader past an end-record signature planted in an entry', async () => {
    // Binary artwork is free to contain those four bytes, and a reader scanning
    // backwards for them lands inside this entry instead of on the record.
    const planted = new Uint8Array(64);
    planted.set([0x50, 0x4b, 0x05, 0x06], 30);

    const read = await roundTrip(await writeZip([{ name: 'assets/card-1.glb', bytes: planted }]));

    expect(read.get('assets/card-1.glb')).toEqual(planted);
  });

  it('keeps every offset straight across an archive of many entries', async () => {
    const inputs = Array.from({ length: 300 }, (_, index) => ({
      name: `assets/card-${index + 1}.glb`,
      bytes: encode(`component ${index}`.repeat(index + 1)),
      compress: index % 3 === 0,
    }));

    const read = await roundTrip(await writeZip(inputs));

    expect(read.size).toBe(300);
    expect(text(read.get('assets/card-300.glb')!)).toBe('component 299'.repeat(300));
  });

  it('writes the same bytes twice for the same inputs', async () => {
    const inputs = [
      { name: 'scene.json', bytes: encode('{"version":1}'), compress: true },
      { name: 'assets/card-1.glb', bytes: encode('glb') },
    ];

    const first = new Uint8Array(await (await writeZip(inputs)).arrayBuffer());
    const second = new Uint8Array(await (await writeZip(inputs)).arrayBuffer());

    expect(second).toEqual(first);
  });

  it('stamps every entry with the time it is given', async () => {
    const at = new Date(2026, 7, 27, 14, 35, 20);

    const blob = await writeZip([{ name: 'a', bytes: encode('x') }], at);
    const view = new DataView(await blob.arrayBuffer());

    expect(view.getUint16(10, true)).toBe((14 << 11) | (35 << 5) | 10);
    expect(view.getUint16(12, true)).toBe(((2026 - 1980) << 9) | (8 << 5) | 27);
  });

  it("agrees with itself: the local header repeats the directory's sizes and checksum", async () => {
    // Nothing in the reader compares the two, and an inflate walks past a wrong
    // local size without noticing -- so this is the one place the halves of the
    // writer are held together.
    const payload = encode('deck card artwork '.repeat(50));

    const blob = await writeZip([{ name: 'assets/card-1.glb', bytes: payload, compress: true }]);
    const view = new DataView(await blob.arrayBuffer());
    const nameLength = view.getUint16(26, true);
    const central = 30 + nameLength + view.getUint32(18, true);

    expect(view.getUint32(central, true)).toBe(0x02014b50);
    expect(view.getUint32(central + 16, true)).toBe(view.getUint32(14, true));
    expect(view.getUint32(central + 20, true)).toBe(view.getUint32(18, true));
    expect(view.getUint32(central + 24, true)).toBe(view.getUint32(22, true));
    expect(view.getUint32(central + 42, true)).toBe(0);
  });

  it('refuses two entries under one name', async () => {
    await expect(
      writeZip([
        { name: 'assets/card-1.glb', bytes: encode('one') },
        { name: 'assets/card-1.glb', bytes: encode('two') },
      ])
    ).rejects.toBeInstanceOf(ZipWriteError);
  });
});
