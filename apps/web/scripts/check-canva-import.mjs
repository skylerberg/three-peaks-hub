// Drives a Canva export through the real import screen, against a real API.
//
// The reader is unit-tested against ZIPs the tests build, but jsdom has no
// Blob.prototype.stream, no file picker and no DataTransfer -- so everything
// between "the central directory parsed" and "the deck holds these cards" runs
// only here. And one assertion exists nowhere else at all: importing the same
// export twice must leave every card at the version it already had. That is a
// fact about bytes travelling through the browser, the page request and the
// version stack, and any one of the three getting it wrong writes a second
// version per card on every re-import.
//
// It needs an API. Point API_PROXY_TARGET at one (default localhost:17310) and
// it will sign up its own throwaway account.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createBrowser } from './lib/browser.mjs';
import { canvaZip, solidPng } from './lib/fixtures.mjs';
import { createProject, inspectApi, signUp } from './lib/session.mjs';

const PORT = Number(process.env.CANVA_PROBE_PORT ?? 17332);
const API = process.env.API_PROXY_TARGET ?? 'http://localhost:17310';
const selftest = process.argv.includes('--selftest');

// Named here rather than added to the shared list: an API without them is only
// too old for this probe, and every other one should still run.
const IMPORT_ROUTES = [
  ['post', '/api/decks/{deckId}/import/runs'],
  ['post', '/api/decks/import/runs/{runId}/pages'],
  ['post', '/api/decks/import/runs/{runId}/finish'],
];

// Four pages, chosen for what each one reaches:
//
// - page 2 is stored rather than deflated, which is a different branch of the
//   reader and the branch a real archiver takes on data that will not shrink;
// - page 4 carries UTF-8 name bytes with the language-encoding flag clear,
//   which is what macOS writes and what a CP437 fallback turns into "CafÃ©" --
//   a differently named card, and a tombstone of the original on re-import;
// - the numbers are contiguous, so nothing here depends on the renumbering.
const PAGES = [
  { name: '1.png', rgb: [220, 40, 40] },
  { name: '2 - Ace of coins.png', rgb: [40, 180, 90], method: 0 },
  { name: '3.png', rgb: [40, 80, 220] },
  { name: '4 - Café.png', rgb: [230, 190, 60], utf8: false },
];

// What an export off a Mac actually carries alongside the pages. None of it is
// a card, and a deck that gained one of these would be wrong in a way the
// counts alone would not show.
const JUNK = [
  { name: '__MACOSX/._1.png', bytes: Buffer.from('\x00\x05\x16\x07AppleDouble') },
  { name: '.DS_Store', bytes: Buffer.from('\x00\x00\x00\x01Bud1') },
  { name: 'notes.txt', bytes: Buffer.from('Not an image, and not junk either.') },
];

const EXPECTED_CARDS = PAGES.map((page) => page.name);

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

function writeExport() {
  const dir = mkdtempSync(join(tmpdir(), 'tph-canva-'));
  const path = join(dir, 'Deck export.zip');
  const entries = [
    ...PAGES.map((page) => ({
      name: page.name,
      bytes: solidPng({ width: 24, rgb: page.rgb }),
      method: page.method,
      utf8: page.utf8,
    })),
    ...JUNK,
  ];
  writeFileSync(path, canvaZip(entries));
  return path;
}

/**
 * The deck as the API holds it: the cards in their own order, where each one's
 * image lives, and how deep its version stack is.
 *
 * Read back through the API rather than off the screen. The summary is the
 * import telling you what it did; this is the deck saying what happened.
 */
async function readDeck(browser, deckId) {
  return browser.page.evaluate(async (id) => {
    const headers = { Authorization: `Bearer ${localStorage.getItem('tph.token')}` };
    const deck = await fetch(`/api/decks/${id}`, { headers }).then((r) => r.json());

    const cards = [];
    for (const card of deck.cards) {
      const history = await fetch(`/api/files/${card.file_id}/versions`, { headers }).then((r) =>
        r.json()
      );
      cards.push({
        fileId: card.file_id,
        position: card.position,
        filename: card.file.filename,
        deckId: card.file.deck_id,
        versions: history.versions.length,
      });
    }
    return { cards };
  }, deckId);
}

// Every complaint the deck could raise, as strings, so the same function can be
// asked to find some. Comparing NFC on both sides: a title that went out as one
// code point can come back decomposed and read identically in a terminal.
function deckProblems(deck, deckId) {
  const problems = [];
  const ordered = [...deck.cards].sort((a, b) => a.position - b.position);

  if (ordered.length !== EXPECTED_CARDS.length) {
    problems.push(`${ordered.length} cards, expected ${EXPECTED_CARDS.length}`);
  }

  EXPECTED_CARDS.forEach((expected, index) => {
    const card = ordered[index];
    if (!card) {
      problems.push(`no card in position ${index + 1}, expected “${expected}”`);
      return;
    }
    if (card.filename.normalize('NFC') !== expected.normalize('NFC')) {
      problems.push(`position ${index + 1} is “${card.filename}”, expected “${expected}”`);
    }
    if (card.versions !== 1) {
      problems.push(`“${card.filename}” is at ${card.versions} versions, expected 1`);
    }
    if (card.deckId !== deckId) {
      problems.push(`“${card.filename}” is not held by the deck it was imported into`);
    }
  });

  return problems;
}

/**
 * One import, from choosing the file to the summary.
 *
 * The plan is waited for by its counts, which only render while no summary is
 * showing -- so reaching them is also what proves the previous run's summary has
 * been cleared, and the "Imported" heading waited for afterwards is this run's.
 */
async function importExport(browser, zipPath, expectedPlan) {
  await browser.page.getByLabel('Canva export (.zip)').setInputFiles(zipPath);
  const planned = await browser.page
    .waitForSelector(`text=${expectedPlan}`, { timeout: 60_000 })
    .then(() => true)
    .catch(() => false);
  if (!planned) {
    const said = await browser.page
      .locator('[role="alert"]')
      .first()
      .textContent({ timeout: 1_000 })
      .catch(() => null);
    const counts = await browser.page
      .textContent('section:has(h2:has-text("What this import will do")) p')
      .catch(() => null);
    return { planned: false, detail: said?.trim() ?? counts?.trim() ?? 'no plan and no reason' };
  }

  await browser.click(`button:has-text("Import ${PAGES.length} pages")`);
  await browser.page.waitForSelector('h2:has-text("Imported")', { timeout: 120_000 });
  const summary = await browser.page.textContent('section:has(h2:has-text("Imported")) p');
  return { planned: true, summary: summary.replace(/\s+/gu, ' ').trim() };
}

async function run() {
  const api = await inspectApi(API, IMPORT_ROUTES);
  if (!api.ok) {
    const message = `[check:canva-import] ${api.reason}`;
    if (!api.absent) {
      console.error(message);
      return 1;
    }
    // Absent locally is the convenience of a checkout with nothing running;
    // absent under CI is a gate that measured nothing.
    if (process.env.CI) {
      console.error(`${message}; refusing to skip under CI`);
      return 1;
    }
    console.warn(`${message}; skipping. Start it with \`pnpm dev:api\`.`);
    return 0;
  }

  const server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    server: {
      port: PORT,
      strictPort: false,
      proxy: { '/api': API, '/ws': { target: API, ws: true } },
    },
    logLevel: 'error',
  });
  await server.listen();
  const base = `http://localhost:${server.config.server.port ?? PORT}`;

  const browser = await createBrowser();
  if (!browser) {
    await server.close();
    console.warn('[check:canva-import] no browser engine available; skipping');
    return 0;
  }

  const pageErrors = [];
  browser.page.on('pageerror', (error) => pageErrors.push(error.message));

  const zipPath = writeExport();

  try {
    const stamp = `${Date.now()}-canva`;
    await signUp(browser, base, { name: 'Canva Probe', stamp });
    await createProject(browser, `Canva ${stamp}`);
    const projectId = new URL(browser.page.url()).pathname.split('/')[2];

    await browser.page.waitForSelector('a:has-text("Decks")', { timeout: 15_000 });
    await browser.click('a:has-text("Decks")');
    await browser.page.waitForSelector('button:has-text("New deck")', { timeout: 15_000 });
    await browser.click('button:has-text("New deck")');
    await browser.page.fill('input[maxlength="120"]', 'Imported deck');
    await browser.click('button[type="submit"]');
    await browser.page.waitForSelector('h2:has-text("Cards")', { timeout: 15_000 });
    const deckId = new URL(browser.page.url()).pathname.split('/')[4];

    // The entry point is on the deck editor, behind edit access, and it is a
    // route rather than a download -- so a plain link the router handles.
    await browser.click('a:has-text("Import from Canva")');
    await browser.page.waitForSelector('h1:has-text("Import from Canva")', { timeout: 15_000 });
    check('the deck editor links to the import screen', true);

    // Nothing to set up first: the deck is where the artwork lands, so the file
    // input is on the screen the moment it opens.
    await browser.page.waitForSelector('input[type="file"]', { timeout: 15_000 });
    check('the import screen offers a ZIP straight away', true);

    // --- the first import --------------------------------------------------
    const first = await importExport(browser, zipPath, '4 new · 0 updated · 0 removed');
    if (!check('the plan offers four new cards and nothing else', first.planned, first.detail)) {
      return 1;
    }
    check(
      'the summary counts four pages added',
      first.summary === '4 pages · 4 added · 0 updated · 0 unchanged · 0 removed · 0 restored',
      first.summary
    );

    const imported = await readDeck(browser, deckId);
    const firstProblems = deckProblems(imported, deckId);
    check(
      'the deck holds the export’s pages, in order, each at version 1',
      firstProblems.length === 0,
      firstProblems.join('; ')
    );
    // The junk is dropped by name and by magic bytes rather than by extension,
    // and a deck five cards long is what a reader that trusted the extension
    // would leave -- which the counts above would report as a clean import.
    check(
      'the AppleDouble forks, the .DS_Store and the stray text file became no cards',
      imported.cards.length === PAGES.length,
      `${imported.cards.length} cards`
    );

    // --- the same export, a second time ------------------------------------
    const second = await importExport(browser, zipPath, '0 new · 4 updated · 0 removed');
    if (!check('the plan matches every page to the card it made', second.planned, second.detail)) {
      return 1;
    }
    check(
      'the summary counts four pages unchanged',
      second.summary === '4 pages · 0 added · 0 updated · 4 unchanged · 0 removed · 0 restored',
      second.summary
    );

    const reimported = await readDeck(browser, deckId);
    const secondProblems = deckProblems(reimported, deckId);
    check(
      're-importing identical bytes writes no new version',
      secondProblems.length === 0,
      secondProblems.join('; ')
    );

    const sameFiles =
      imported.cards.length === reimported.cards.length &&
      imported.cards.every((card, index) => card.fileId === reimported.cards[index]?.fileId);
    check(
      'every card is the same file it was, not a replacement',
      sameFiles,
      `${imported.cards.map((c) => c.fileId).join(',')} vs ${reimported.cards.map((c) => c.fileId).join(',')}`
    );

    if (pageErrors.length > 0) {
      check('the page threw nothing while importing', false, pageErrors.join(' | '));
    }
    if (browser.serverErrors.length > 0) {
      check('nothing answered 5xx during the import', false, browser.serverErrors.join(' | '));
    }

    if (selftest) {
      // Sensitivity. Every assertion above is a comparison against a deck read
      // back over the network, and a selector or a field name that quietly
      // stopped resolving would read as a clean import. So put the same
      // assertions on a deck the import never touched, and on a card that did
      // gain a version, and require both to complain.
      console.log('\n[selftest] the same assertions against a deck that was never imported into:');

      const emptyDeckId = await browser.page.evaluate(async (project) => {
        const headers = {
          Authorization: `Bearer ${localStorage.getItem('tph.token')}`,
          'Content-Type': 'application/json',
        };
        const deck = await fetch('/api/decks', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            project_id: project,
            name: 'Never imported',
            card_width_mm: 63,
            card_height_mm: 88,
          }),
        }).then((r) => r.json());
        return deck.id;
      }, projectId);

      const untouched = deckProblems(await readDeck(browser, emptyDeckId), deckId);
      if (untouched.length === 0) {
        console.error('[selftest] FAILED: a deck with no cards passed the deck assertions');
        return 1;
      }
      console.log(`  ok   a deck with no cards is rejected (${untouched[0]})`);

      const versioned = {
        cards: reimported.cards.map((card, index) =>
          index === 1 ? { ...card, versions: 2 } : card
        ),
      };
      if (deckProblems(versioned, deckId).length === 0) {
        console.error('[selftest] FAILED: a card at two versions passed the version assertion');
        return 1;
      }
      console.log('  ok   a card that gained a second version is rejected');

      const relocated = { cards: reimported.cards.map((card) => ({ ...card, deckId: null })) };
      if (deckProblems(relocated, deckId).length === 0) {
        console.error('[selftest] FAILED: artwork the deck does not hold was accepted');
        return 1;
      }
      console.log('  ok   artwork the deck does not hold is rejected');
    }
  } finally {
    await browser.close();
    await server.close();
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} failure(s): ${failures.join(', ')}`);
    return 1;
  }
  console.log('\ncheck:canva-import passed');
  return 0;
}

process.exit(await run());
