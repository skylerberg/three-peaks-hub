// Runs axe-core over the real screens, in BOTH colour schemes. The palette is
// declared twice and half the tokens exist only under
// prefers-color-scheme: dark, so a light-only run reads none of them.
//
// It owns a named rule list rather than running all of axe, so a new axe
// release cannot turn the gate red on a rule nobody has adopted.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createBrowser } from './lib/browser.mjs';
import { TINY_PNG } from './lib/fixtures.mjs';
import { createProject, inspectApi, signOut, signUp } from './lib/session.mjs';

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const RULES = [
  'color-contrast',
  'label',
  'button-name',
  'link-name',
  'image-alt',
  'aria-valid-attr-value',
  'aria-required-attr',
  'aria-roles',
  'duplicate-id-aria',
  'form-field-multiple-labels',
  'html-has-lang',
  'landmark-one-main',
];

// `reach` says how to get to the screen. Signed-out screens are a URL; a screen
// behind the session needs an account, a project and something to open the
// screen on, so it names a function that leaves the browser sitting on it.
const SCREENS = [
  { name: 'login', path: '/login' },
  { name: 'signup', path: '/signup' },
  { name: 'forgot-password', path: '/forgot-password' },
  { name: 'model-studio', authed: true, reach: reachModelStudio },
  { name: 'file-versions', authed: true, reach: reachFileVersions },
  { name: 'deleted', authed: true, reach: reachDeleted },
];

const SCHEMES = ['light', 'dark'];

const selftest = process.argv.includes('--selftest');
const PORT = Number(process.env.A11Y_PROBE_PORT ?? 17330);
const API = process.env.API_PROXY_TARGET ?? 'http://localhost:17310';

// A fresh account per screen and per colour scheme: the probes upload files, and
// an account carried from one screen to the next would make each run depend on
// what the one before it left behind.
async function freshProject(browser, base, label) {
  const dir = mkdtempSync(join(tmpdir(), 'tph-a11y-'));
  const pngPath = join(dir, 'token.png');
  writeFileSync(pngPath, TINY_PNG);

  await signOut(browser, base);
  await signUp(browser, base, { name: 'A11y Probe', stamp: `${Date.now()}-${label}` });
  await createProject(browser, `A11y ${label}`);
  await browser.setInputFiles('input[type="file"]', pngPath);
  return 'token.png';
}

async function reachModelStudio(browser, base, scheme) {
  await freshProject(browser, base, `studio-${scheme}`);
  await browser.page.waitForSelector('a:has-text("Make 3D")', { timeout: 15_000 });
  await browser.click('a:has-text("Make 3D")');
  await expectCanvas(browser);
}

// A canvas that never appears is the studio having given up upstream -- an image
// it could not read, a project it could not resolve -- and it says which in a
// role="alert" that a bare selector timeout throws away.
async function expectCanvas(browser) {
  try {
    await browser.page.waitForSelector('canvas', { timeout: 15_000 });
  } catch (error) {
    const said = await browser.page
      .locator('[role="alert"]')
      .first()
      .textContent({ timeout: 1_000 })
      .catch(() => null);
    if (said === null) throw error;
    throw new Error(`the model studio rendered no canvas; the screen says: ${said.trim()}`, {
      cause: error,
    });
  }
}

async function reachFileVersions(browser, base, scheme) {
  const filename = await freshProject(browser, base, `versions-${scheme}`);
  await browser.page.waitForSelector(`button[aria-label="Download ${filename}"]`, {
    timeout: 15_000,
  });
  await browser.click('a:has-text("Versions")');
  // The upload control appears only once the member roster has answered, so
  // waiting for it is what keeps axe from reading a half-drawn screen.
  await browser.page.waitForSelector('button:has-text("Upload new version")', { timeout: 15_000 });
  await browser.page.waitForSelector(`button[aria-label="Download version 1 of ${filename}"]`, {
    timeout: 15_000,
  });
}

async function reachDeleted(browser, base, scheme) {
  const filename = await freshProject(browser, base, `deleted-${scheme}`);
  await browser.page.waitForSelector(`button[aria-label="Delete ${filename}"]`, {
    timeout: 15_000,
  });

  // Playwright dismisses a dialog nobody has claimed, so without this the
  // confirm is answered "no", the delete never happens, and axe reads an empty
  // screen while reporting green. Registered before the click, and the wait
  // afterwards is what turns a cancelled dialog into a failure.
  browser.page.once('dialog', (dialog) => dialog.accept());
  await browser.click(`button[aria-label="Delete ${filename}"]`);
  await browser.page.waitForSelector(`button[aria-label="Delete ${filename}"]`, {
    state: 'detached',
    timeout: 15_000,
  });

  await browser.click('a:has-text("Deleted")');
  // The restore controls appear only once the member roster has answered, so
  // waiting on one keeps axe from reading a half-drawn screen.
  await browser.page.waitForSelector(`button[aria-label="Restore ${filename}"]`, {
    timeout: 15_000,
  });
  await browser.page.waitForSelector(`button[aria-label="Permanently delete ${filename}"]`, {
    timeout: 15_000,
  });
}

async function run() {
  // The signed-out screens need no API, and check:a11y is part of check:all --
  // which has to keep passing on a checkout with nothing else running. An
  // authenticated screen cannot be reached without one, so those are skipped
  // rather than allowed to fail, except under CI where an absent API is a
  // broken gate rather than a local convenience.
  const api = await inspectApi(API);
  // A server that is there but is not this build is a failure everywhere: the
  // screens behind the session cannot be reached, and saying so beats both
  // skipping them and letting them time out.
  if (!api.ok && !api.absent) {
    console.error(`[check:a11y] ${api.reason}`);
    return 1;
  }
  if (!api.ok) {
    if (process.env.CI) {
      console.error(`[check:a11y] ${api.reason}; refusing to skip its screens under CI`);
      return 1;
    }
    console.warn(
      `[check:a11y] ${api.reason}; skipping ${SCREENS.filter((s) => s.authed).length} ` +
        'screen(s) behind the session. Start one with `pnpm dev:api`.'
    );
  }

  const screens = SCREENS.filter((screen) => api.ok || !screen.authed);

  const server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    // /ws as well as /api: without it the app's socket opens against this
    // server, fails its handshake, and reconnects for the length of the run.
    server: {
      port: PORT,
      strictPort: false,
      proxy: { '/api': API, '/ws': { target: API, ws: true } },
    },
    logLevel: 'error',
  });
  await server.listen();
  const base = `http://localhost:${server.config.server.port ?? PORT}`;

  const failures = [];
  let cases = 0;

  for (const scheme of SCHEMES) {
    const browser = await createBrowser({ colorScheme: scheme });
    if (!browser) {
      await server.close();
      console.warn('[check:a11y] no browser engine available; skipping');
      return 0;
    }

    for (const screen of screens) {
      try {
        if (screen.reach) await screen.reach(browser, base, scheme);
        else await browser.goto(`${base}${screen.path}`, { wait: 250 });
      } catch (error) {
        // What the API said, not only which element never appeared: reaching a
        // screen drives the real app, and its request failing is the reason far
        // more often than the selector being wrong.
        const said = browser.serverErrors;
        throw new Error(
          `[check:a11y] could not reach ${screen.name} (${scheme}): ${error.message}` +
            (said.length > 0 ? `\n  the API answered: ${said.join(', ')}` : ''),
          { cause: error }
        );
      }
      await browser.page.addScriptTag({ content: axeSource });

      const result = await browser.page.evaluate(
        ([rules]) =>
          window.axe.run(document, {
            runOnly: { type: 'rule', values: rules },
            resultTypes: ['violations'],
          }),
        [RULES]
      );

      cases += 1;
      for (const violation of result.violations) {
        failures.push(
          `${screen.name} (${scheme}): ${violation.id} — ${violation.help} [${violation.nodes.length} node(s)]`
        );
      }
    }

    await browser.close();
  }

  await server.close();

  if (selftest) {
    // Sensitivity, not correctness. A check that measures nothing reports green
    // exactly like one that passes, so prove the rules can actually fire.
    console.log(`[selftest] ran ${cases} cases across ${SCHEMES.length} colour schemes`);
    if (cases !== screens.length * SCHEMES.length) {
      console.error('[selftest] FAILED: not every screen/scheme combination ran');
      return 1;
    }
    const planted = await plantedViolationIsCaught(PORT);
    if (!planted) {
      console.error('[selftest] FAILED: a deliberately broken page was not flagged');
      return 1;
    }
    console.log('[selftest] a deliberately broken page was flagged, as expected');
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} accessibility violation(s):`);
    for (const failure of failures) console.error(`  ${failure}`);
    return 1;
  }

  console.log(`check:a11y passed (${cases} screen/scheme combinations)`);
  return 0;
}

// Serves markup that violates two of the rules above and requires axe to say so.
async function plantedViolationIsCaught() {
  const browser = await createBrowser({ colorScheme: 'light' });
  if (!browser) return true;

  const html = `<!doctype html><html><body>
    <button></button>
    <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
  </body></html>`;

  await browser.goto(`data:text/html,${encodeURIComponent(html)}`);
  await browser.page.addScriptTag({ content: axeSource });

  const result = await browser.page.evaluate(
    ([rules]) =>
      window.axe.run(document, {
        runOnly: { type: 'rule', values: rules },
        resultTypes: ['violations'],
      }),
    [RULES]
  );
  await browser.close();

  // Names the rules it expects: with any violation accepted, an unrelated one
  // would pass for the planted bug being caught.
  const found = new Set(result.violations.map((violation) => violation.id));
  return found.has('button-name') && found.has('image-alt');
}

process.exit(await run());
