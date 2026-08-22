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
import { apiReachable, createProject, signUp } from './lib/session.mjs';

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
];

const SCHEMES = ['light', 'dark'];

const selftest = process.argv.includes('--selftest');
const PORT = Number(process.env.A11Y_PROBE_PORT ?? 5200);
const API = process.env.API_PROXY_TARGET ?? 'http://localhost:3001';

// A 4x4 opaque PNG. The studio only needs something it will accept as a source;
// what it looks like does not change a single contrast ratio.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFElEQVR4nGP8//8/AzZgYsAB6CcBAFcMAwHKQGQCAAAAAElFTkSuQmCC',
  'base64'
);

async function reachModelStudio(browser, base, scheme) {
  const dir = mkdtempSync(join(tmpdir(), 'tph-a11y-'));
  const pngPath = join(dir, 'token.png');
  writeFileSync(pngPath, TINY_PNG);

  // A fresh account per colour scheme: the browser context is recreated for
  // each, and with it the storage the session lives in.
  await signUp(browser, base, { name: 'A11y Probe', stamp: `${Date.now()}-${scheme}` });
  await createProject(browser, `A11y ${scheme}`);
  await browser.setInputFiles('input[type="file"]', pngPath);
  await browser.page.waitForSelector('a:has-text("Make 3D")', { timeout: 15_000 });
  await browser.click('a:has-text("Make 3D")');
  await browser.page.waitForSelector('canvas', { timeout: 15_000 });
}

async function run() {
  // The signed-out screens need no API, and check:a11y is part of check:all --
  // which has to keep passing on a checkout with nothing else running. An
  // authenticated screen cannot be reached without one, so those are skipped
  // rather than allowed to fail, except under CI where an absent API is a
  // broken gate rather than a local convenience.
  const authed = await apiReachable(API);
  if (!authed) {
    if (process.env.CI) {
      console.error(`[check:a11y] no API at ${API}; refusing to skip its screens under CI`);
      return 1;
    }
    console.warn(
      `[check:a11y] no API at ${API}; skipping ${SCREENS.filter((s) => s.authed).length} ` +
        'screen(s) behind the session. Start one with `pnpm dev:api`.'
    );
  }

  const screens = SCREENS.filter((screen) => authed || !screen.authed);

  const server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    server: { port: PORT, strictPort: false, proxy: { '/api': API } },
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
      if (screen.reach) await screen.reach(browser, base, scheme);
      else await browser.goto(`${base}${screen.path}`, { wait: 250 });
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
