// Drives the 3D studio in a real browser and inspects the .glb it produces.
//
// Nothing else in the repo can. The geometry maths is unit-tested in jsdom, but
// GLTFExporter needs a real canvas to serialise a texture and a real WebGL
// context to have drawn anything at all -- so the step between "the vertices
// are right" and "a file Blender can open came out" has no other cover.
//
// It needs an API. Point API_PROXY_TARGET at one (default localhost:3001) and
// it will sign up its own throwaway account.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { createServer } from 'vite';
import { createBrowser } from './lib/browser.mjs';
import { apiReachable, createProject, signUp } from './lib/session.mjs';

const PORT = Number(process.env.MODEL_PROBE_PORT ?? 5230);
const API = process.env.API_PROXY_TARGET ?? 'http://localhost:3001';
const selftest = process.argv.includes('--selftest');

const failures = [];
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
    failures.push(name);
  }
  return condition;
}

const CRC_TABLE = Array.from({ length: 256 }, (_value, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// A 16x16 PNG, written by hand rather than checked in: the fixture is then the
// same shape the assertions describe, and there is no binary in the tree whose
// contents nobody can read in a diff.
//
// An opaque disc on a transparent field, so the alpha tracer has one closed
// contour to find and the card path has something to print.
function discPng() {
  const width = 16;
  const raw = Buffer.alloc(width * (width * 4 + 1));
  for (let y = 0; y < width; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const inside = (x - 7.5) ** 2 + (y - 7.5) ** 2 <= 6 ** 2;
      const offset = rowStart + 1 + x * 4;
      raw[offset] = 200;
      raw[offset + 1] = 120;
      raw[offset + 2] = 40;
      raw[offset + 3] = inside ? 255 : 0;
    }
  }

  const chunk = (type, body) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed) >>> 0);
    return Buffer.concat([length, typed, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(width, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Reads the container rather than trusting that a file arrived: a zero-length
// upload and a truncated export both produce a row in the explorer.
function inspectGlb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (magic !== 'glTF') return { magic, version: null, json: null };

  const version = view.getUint32(4, true);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).replace(/\0+$/, '')
  );
  return { magic, version, json };
}

// The widest span of any POSITION accessor, read from the min/max glTF requires
// every one of them to declare.
function positionExtent(json) {
  const accessors = (json?.meshes?.[0]?.primitives ?? [])
    .map((primitive) => json.accessors?.[primitive.attributes?.POSITION])
    .filter((accessor) => accessor?.min && accessor?.max);
  if (accessors.length === 0) return null;

  return Math.max(
    ...accessors.flatMap((accessor) => accessor.max.map((high, axis) => high - accessor.min[axis]))
  );
}

async function run() {
  if (!(await apiReachable(API))) {
    const message = `[check:model3d] no API at ${API}`;
    // Same contract as check-upload.mjs, which explains why.
    if (process.env.CI) {
      console.error(`${message}; refusing to skip under CI`);
      return 1;
    }
    console.warn(`${message}; skipping. Start it with \`pnpm dev:api\`.`);
    return 0;
  }

  const server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    server: { port: PORT, strictPort: false, proxy: { '/api': API } },
    logLevel: 'error',
  });
  await server.listen();
  const base = `http://localhost:${server.config.server.port ?? PORT}`;

  const browser = await createBrowser();
  if (!browser) {
    await server.close();
    console.warn('[check:model3d] no browser engine available; skipping');
    return 0;
  }

  try {
    await signUp(browser, base, { name: 'Model Probe', stamp: Date.now() });
    await createProject(browser, 'Model Project');

    const dir = mkdtempSync(join(tmpdir(), 'tph-model-'));
    const pngPath = join(dir, 'token.png');
    writeFileSync(pngPath, discPng());

    await browser.setInputFiles('input[type="file"]', pngPath);
    await browser.page.waitForSelector('a:has-text("Make 3D")', { timeout: 15_000 });
    check('an image offers the 3D studio', true);

    await browser.click('a:has-text("Make 3D")');
    await browser.page.waitForSelector('canvas', { timeout: 15_000 });
    check('the studio opens on a canvas', true);

    // WebGL is what the viewer needs, and a headless browser without it draws
    // nothing while every other assertion still passes.
    const drawing = await browser.page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      return Boolean(canvas && canvas.width > 0 && canvas.getContext('webgl2'));
    });
    check('the canvas has a live WebGL context', drawing);

    await browser.click('button:has-text("Wooden component")');
    await browser.page.waitForSelector('text=Longest side', { timeout: 10_000 });
    check('the wooden settings replace the card settings', true);

    await browser.click('button:has-text("Save to project")');
    await browser.page.waitForSelector('text=/Saved token\\.glb/', { timeout: 30_000 });

    const stored = await browser.page.evaluate(async () => {
      const token = localStorage.getItem('tph.token');
      const headers = { Authorization: `Bearer ${token}` };
      const list = await fetch('/api/projects', { headers }).then((r) => r.json());
      const projectId = list.projects[0].id;
      const listing = await fetch(`/api/files/directory?project_id=${projectId}`, {
        headers,
      }).then((r) => r.json());
      const glb = listing.files.find((file) => file.filename.endsWith('.glb'));
      if (!glb) return null;
      const buffer = await fetch(`/api/files/${glb.id}/download`, { headers }).then((r) =>
        r.arrayBuffer()
      );
      return { contentType: glb.content_type, bytes: [...new Uint8Array(buffer)] };
    });

    if (!check('the exported model was stored in the project', stored !== null)) {
      return 1;
    }

    const bytes = Uint8Array.from(stored.bytes);
    const glb = inspectGlb(bytes);

    check('the stored file is a glTF container', glb.magic === 'glTF', glb.magic);
    check('the container is glTF 2', glb.version === 2, String(glb.version));
    // The sniffer decides this from the bytes, so it is also the proof that a
    // .glb is not stored as an opaque stream.
    check(
      'the API typed it as a binary glTF',
      stored.contentType === 'model/gltf-binary',
      stored.contentType
    );
    check('the model has a mesh', (glb.json?.meshes?.length ?? 0) > 0);
    check('the model has materials', (glb.json?.materials?.length ?? 0) > 0);
    // Procedural wood is generated in the browser and has to be baked in, or
    // the file opens in Blender as untextured grey.
    check('the textures are embedded', (glb.json?.images?.length ?? 0) > 0);
    check(
      'the mesh has as many primitives as it has material slots',
      (glb.json?.meshes?.[0]?.primitives?.length ?? 0) >= 2,
      String(glb.json?.meshes?.[0]?.primitives?.length)
    );

    // The reason the whole thing exists: a piece has to import measuring what it
    // was told to measure. glTF's unit is the metre, the studio's is the
    // millimetre, and the wooden default is 30 mm on its longest side -- so the
    // accessor bounds have to span 0.03. A model built in millimetres and
    // exported unconverted lands here a thousand times too big.
    const extent = positionExtent(glb.json);
    check(
      'the piece measures its longest side in metres',
      extent !== null && Math.abs(extent - 0.03) < 0.0005,
      `${extent} m across, expected 0.03`
    );

    if (selftest) {
      // Sensitivity: the same assertions against something that is not a GLB
      // must fail. Without this arm, an inspector that always returned nulls
      // would look exactly like a passing check.
      console.log('\n[selftest] the same assertions against bytes that are not a model:');
      const notAModel = inspectGlb(new TextEncoder().encode('this is not a model at all'));
      if (notAModel.magic === 'glTF' || notAModel.json !== null) {
        console.error('[selftest] FAILED: plain text was read as a glTF container');
        return 1;
      }
      console.log('  ok   plain text is not read as a glTF container');
    }
  } finally {
    await browser.close();
    await server.close();
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} failure(s): ${failures.join(', ')}`);
    return 1;
  }
  console.log('\ncheck:model3d passed');
  return 0;
}

process.exit(await run());
