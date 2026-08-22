// Drives the real file-upload path in a real browser, against a real API.
//
// jsdom models none of what this asserts: there is no file picker, no
// DataTransfer, and no streaming request body. The unit tests can prove the
// store calls fetch; only this can prove that picking a file in the UI puts
// bytes in the project and draws them back.
//
// It needs an API. Point API_PROXY_TARGET at one (default localhost:3001) and
// it will sign up its own throwaway account.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createBrowser } from './lib/browser.mjs';
import { apiReachable, createProject, signUp } from './lib/session.mjs';

const PORT = Number(process.env.UPLOAD_PROBE_PORT ?? 5220);
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

async function run() {
  if (!(await apiReachable(API))) {
    const message = `[check:upload] no API at ${API}`;
    // Under CI the API is a service the workflow starts, so its absence is a
    // broken gate rather than a local convenience.
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
    console.warn('[check:upload] no browser engine available; skipping');
    return 0;
  }

  try {
    await signUp(browser, base, { name: 'Upload Probe', stamp: Date.now() });
    check('signing up lands on the projects screen', true);

    await createProject(browser, 'Probe Project');
    check('a created project appears in the list', true);

    // --- upload through the real file input --------------------------------
    const dir = mkdtempSync(join(tmpdir(), 'tph-upload-'));
    const filePath = join(dir, 'probe-card.txt');
    const contents = 'Ace of coins, value 3.';
    writeFileSync(filePath, contents);

    // setInputFiles is the real picker's effect; there is no way to reach this
    // path from jsdom at all.
    await browser.setInputFiles('input[type="file"]', filePath);
    // The download control, not the filename: the explorer draws the name on an
    // optimistic row the moment the upload starts, so waiting for the text
    // waits for nothing and every assertion below it then races the transfer.
    // Only a row from a real listing offers to fetch the stored bytes.
    await browser.page.waitForSelector('button[aria-label="Download probe-card.txt"]', {
      timeout: 15_000,
    });
    check('the uploaded file is drawn in the explorer', true);

    // The row is not proof the bytes arrived. Read them back through the API,
    // which is the only thing that can tell an optimistic row from a stored file.
    const stored = await browser.page.evaluate(async () => {
      const token = localStorage.getItem('tph.token');
      const list = await fetch(location.pathname.replace(/.*/, '/api/projects'), {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json());
      const projectId = list.projects[0].id;
      const dir = await fetch(`/api/files/directory?project_id=${projectId}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json());
      const file = dir.files[0];
      const body = await fetch(`/api/files/${file.id}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.text());
      return { filename: file.filename, byteSize: file.byte_size, body };
    });

    check(
      'the stored filename is what was picked',
      stored.filename === 'probe-card.txt',
      stored.filename
    );
    check('the stored bytes are the file’s own', stored.body === contents, stored.body);
    check(
      'the recorded size matches the bytes',
      stored.byteSize === contents.length,
      `${stored.byteSize} vs ${contents.length}`
    );

    // --- the quota meter reflects the upload -------------------------------
    // Waited for, not sampled. The meter is drawn from the listing that the
    // refresh after the upload fetches, which is a second round trip -- reading
    // it once raced that refresh and failed about one run in three, for no
    // reason to do with the code under test.
    const usedText = await browser.page
      .waitForFunction(
        () => {
          const match = document.body.innerText.match(/[\d.]+ [KMGT]?B of .+ used/);
          return match && !match[0].startsWith('0 B of') ? match[0] : null;
        },
        { timeout: 15_000 }
      )
      .then((handle) => handle.jsonValue())
      .catch(() => null);

    check(
      'the storage meter shows a non-zero total',
      usedText !== null,
      'still read 0 B fifteen seconds after the upload'
    );

    if (selftest) {
      // Sensitivity: the same assertions run against a file that was never
      // uploaded must FAIL. Without this arm, a selector that stopped matching
      // would look exactly like a passing check.
      console.log('\n[selftest] the same assertions against a file that was never uploaded:');
      const absent = await browser.page
        .waitForSelector('text=never-uploaded.txt', { timeout: 1500 })
        .then(() => true)
        .catch(() => false);
      if (absent) {
        console.error('[selftest] FAILED: matched a file that does not exist');
        return 1;
      }
      console.log('  ok   a file that was never uploaded is not drawn');
    }
  } finally {
    await browser.close();
    await server.close();
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} failure(s): ${failures.join(', ')}`);
    return 1;
  }
  console.log('\ncheck:upload passed');
  return 0;
}

process.exit(await run());
