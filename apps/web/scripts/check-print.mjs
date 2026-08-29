// Drives the print builder in a real browser and reads the PDF it produces.
//
// Nothing else in the repo can. The sheet arithmetic is unit-tested in node, but
// the step between "the slot coordinates are right" and "a file a printer lays
// down correctly came out" runs through a canvas, an image decoder and a PDF
// writer that only exist in a browser -- and the one thing that has to be true
// of the result, that every card's own back sits behind it after the paper is
// flipped, is a fact about coordinates inside the finished file.
//
// It needs an API. Point API_PROXY_TARGET at one (default localhost:17310) and
// it will sign up its own throwaway account.
import { inflateSync } from 'node:zlib';
import { createServer } from 'vite';
import { createBrowser } from './lib/browser.mjs';
import { solidPng } from './lib/fixtures.mjs';
import { createProject, inspectApi, signUp } from './lib/session.mjs';

const PORT = Number(process.env.PRINT_PROBE_PORT ?? 17331);
const API = process.env.API_PROXY_TARGET ?? 'http://localhost:17310';
const selftest = process.argv.includes('--selftest');

// US Letter in PDF points, which is the unit a MediaBox is written in.
const LETTER_WIDTH_PT = 612;
const LETTER_HEIGHT_PT = 792;
const MM_PER_PT = 25.4 / 72;

// Poker cards on Letter inside the default printer margin. Kept here rather than
// derived, so the probe fails if the packing quietly changes.
const PER_SHEET = 9;
const COLUMNS = 3;

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

/**
 * Every image placement in the document, page by page.
 *
 * jsPDF writes each one as `q <w> 0 0 <h> <x> <y> cm /I<n> Do Q`, where the
 * matrix is the image's box in PDF points measured from the bottom-left. Reading
 * that back is the only way to assert where a card actually landed -- a
 * screenshot cannot tell a correctly mirrored back page from an incorrect one.
 */
function readPlacements(bytes) {
  const latin = Buffer.from(bytes).toString('latin1');
  const pages = [];

  const streams = /stream\r?\n/g;
  let match;
  while ((match = streams.exec(latin)) !== null) {
    const start = match.index + match[0].length;
    const end = latin.indexOf('endstream', start);
    if (end < 0) continue;

    const body = Buffer.from(bytes).subarray(start, end);
    let text;
    try {
      text = inflateSync(body).toString('latin1');
    } catch {
      // Not a Flate stream: an embedded JPEG, or the image data itself.
      continue;
    }
    if (!/\bDo\b/.test(text)) continue;

    const placements = [];
    const draw = /([\d.-]+) 0 0 ([\d.-]+) ([\d.-]+) ([\d.-]+) cm\s*(?:[\d.\s-]+cm\s*)?\/(I\d+) Do/g;
    let placement;
    while ((placement = draw.exec(text)) !== null) {
      placements.push({
        image: placement[5],
        width: Number(placement[1]),
        height: Number(placement[2]),
        x: Number(placement[3]),
        // Flipped to a top-left origin, which is what the layout code works in
        // and therefore what the assertions below can be written against.
        y: LETTER_HEIGHT_PT - Number(placement[4]) - Number(placement[2]),
      });
    }
    pages.push(placements);
  }

  return pages;
}

// Slot order: left to right, top to bottom, the order a person reads a sheet in.
function inSlotOrder(placements) {
  return [...placements].sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * The assertion the whole probe exists for.
 *
 * A printer flips the paper, and that flip is what mirrors the page. So a back
 * belongs at the horizontal reflection of its front: the two boxes have to add
 * up to the width of the sheet.
 *
 * Position alone is not enough to check, and that is worth spelling out because
 * the obvious test is wrong. On a three-column grid the set of x positions is
 * symmetric -- the outer columns swap and the middle one maps to itself -- so a
 * backing page drawn in the same order as the fronts occupies exactly the right
 * set of boxes and is still wrong on six cards out of nine. What has to hold is
 * the pairing: every card showing a given front must find the same back at its
 * mirror, and two decks' cards must find different ones.
 */
function pairFrontsToBacks(fronts, backs, pageWidth) {
  const atPosition = new Map(
    backs.map((back) => [`${back.x.toFixed(1)}:${back.y.toFixed(1)}`, back])
  );
  const pairs = new Map();
  const problems = [];

  for (const front of fronts) {
    const mirrored = pageWidth - front.x - front.width;
    const back = atPosition.get(`${mirrored.toFixed(1)}:${front.y.toFixed(1)}`);
    if (!back) {
      problems.push(`no back at x=${mirrored.toFixed(1)} y=${front.y.toFixed(1)}`);
      continue;
    }

    const already = pairs.get(front.image);
    if (already !== undefined && already !== back.image) {
      problems.push(`${front.image} is backed by both ${already} and ${back.image}`);
    }
    pairs.set(front.image, back.image);
  }

  return { pairs, problems };
}

async function run() {
  const api = await inspectApi(API);
  if (!api.ok) {
    const message = `[check:print] ${api.reason}`;
    if (!api.absent) {
      console.error(message);
      return 1;
    }
    // Same contract as the other probes: absent locally is a skip, absent under
    // CI is a failure. A gate that silently measures nothing is worse than none.
    if (process.env.CI) {
      console.error(`${message}; refusing to skip under CI`);
      return 1;
    }
    console.warn(`${message}; skipping. Start it with \`pnpm dev:api\`.`);
    return 0;
  }

  const server = await createServer({
    root: new URL('..', import.meta.url).pathname,
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
    console.warn('[check:print] no browser engine available; skipping');
    return 0;
  }

  const pageErrors = [];
  browser.page.on('pageerror', (error) => pageErrors.push(error.message));
  browser.page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(message.text());
  });

  try {
    await signUp(browser, base, { name: 'Print Probe', stamp: Date.now() });
    await createProject(browser, 'Print Project');

    // Fronts, backs and the two decks are set up through the API rather than the
    // editor: this probe is about the file that comes out, and check-upload
    // already drives the real picker. The card art is a different flat colour
    // each, which is what makes the placements tellable apart in the PDF.
    const artwork = {
      alpha: [200, 40, 40],
      beta: [40, 160, 90],
      gamma: [60, 90, 200],
      'back-one': [30, 30, 30],
      'back-two': [230, 210, 120],
    };
    const files = Object.fromEntries(
      Object.entries(artwork).map(([name, rgb]) => [
        name,
        [...solidPng({ width: 372, height: 520, rgb })],
      ])
    );

    const setup = await browser.page.evaluate(async (uploads) => {
      const token = localStorage.getItem('tph.token');
      const headers = { Authorization: `Bearer ${token}` };
      const projectId = (await fetch('/api/projects', { headers }).then((r) => r.json()))
        .projects[0].id;

      // Into the deck, not into the project: a deck owns its cards and its back,
      // so each one is created first and its artwork uploaded into it.
      const makeDeck = async (name, back, cards) => {
        const deck = await fetch('/api/decks', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project_id: projectId,
            name,
            card_width_mm: 63,
            card_height_mm: 88,
          }),
        }).then((r) => r.json());

        const into = async (image, role) => {
          const query = new URLSearchParams({
            project_id: projectId,
            filename: `${image}.png`,
            deck_id: deck.id,
            ...(role ? { role } : {}),
          });
          const created = await fetch(`/api/files/upload?${query}`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'image/png' },
            body: new Uint8Array(uploads[image]),
          }).then((r) => r.json());
          return created.id;
        };

        const placed = [];
        for (const card of cards) placed.push({ ...card, file_id: await into(card.image) });

        await fetch(`/api/decks/${deck.id}`, {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ back_file_id: await into(back, 'back') }),
        });

        await fetch(`/api/decks/${deck.id}/cards`, {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cards: placed.map((card) => ({ file_id: card.file_id, quantity: card.quantity })),
          }),
        });
        return deck.id;
      };

      // Eight cards in the first deck and three in the second: the first sheet
      // then carries both decks, which is the case a per-sheet back would get
      // wrong and a per-slot back gets right.
      await makeDeck('Alpha deck', 'back-one', [
        { image: 'alpha', quantity: 6 },
        { image: 'beta', quantity: 2 },
      ]);
      await makeDeck('Beta deck', 'back-two', [{ image: 'gamma', quantity: 3 }]);

      return { projectId };
    }, files);

    await browser.goto(`${base}/projects/${setup.projectId}/print`, { wait: 0 });
    await browser.page.waitForSelector('h1:has-text("Print sheets")', { timeout: 15_000 });
    check('the print screen opens', true);

    // The button only renders once every deck has been read, so waiting for it
    // is what tells the loading spinner apart from the summary -- both carry
    // role="status", and reading too early found "Loading decks".
    await browser.page.waitForSelector('button:has-text("Generate PDF")', { timeout: 30_000 });

    // 11 poker cards at 9 a sheet is two sheets, and a backing page behind each.
    const said = await browser.page.textContent('p:has-text("sheets of US Letter")');
    check(
      'the screen counts the cards and the sheets before printing',
      /11\s+cards on 4\s+sheets/.test(said ?? ''),
      said ?? ''
    );

    // The bytes are captured from the object URL the button builds rather than
    // through a download: the app hands the visitor a Blob it made in the page,
    // and reading it here is both simpler and exactly what they receive.
    await browser.page.evaluate(() => {
      const original = URL.createObjectURL.bind(URL);
      window.__printed = null;
      URL.createObjectURL = (blob) => {
        window.__printed = blob;
        return original(blob);
      };
    });

    await browser.click('button:has-text("Generate PDF")');
    await browser.page.waitForFunction(() => window.__printed !== null, { timeout: 120_000 });

    const produced = await browser.page.evaluate(async () => {
      const blob = window.__printed;
      return { type: blob.type, bytes: [...new Uint8Array(await blob.arrayBuffer())] };
    });

    const bytes = Uint8Array.from(produced.bytes);
    const latin = Buffer.from(bytes).toString('latin1');

    check('the file is a PDF', latin.startsWith('%PDF-'), latin.slice(0, 8));
    check('it is handed over as a PDF blob', produced.type === 'application/pdf', produced.type);

    const mediaBoxes = [...latin.matchAll(/\/MediaBox \[([^\]]*)\]/g)].map((box) =>
      box[1].trim().split(/\s+/).map(Number)
    );
    check(
      'every page is US Letter',
      mediaBoxes.length > 0 &&
        mediaBoxes.every(
          (box) => Math.abs(box[2] - LETTER_WIDTH_PT) < 1 && Math.abs(box[3] - LETTER_HEIGHT_PT) < 1
        ),
      JSON.stringify(mediaBoxes[0])
    );

    const pageCount = (latin.match(/\/Type \/Page[^s]/g) ?? []).length;
    check('fronts and backs come to four pages', pageCount === 4, String(pageCount));

    // Three fronts and two backs. Without the alias every one of the 11 cards
    // and 11 backs would be embedded separately.
    const embedded = (latin.match(/\/Subtype \/Image/g) ?? []).length;
    check('each distinct artwork is embedded once', embedded === 5, `${embedded} image XObjects`);

    const pages = readPlacements(bytes);
    if (
      !check('the page contents could be read back', pages.length >= 4, `${pages.length} pages`)
    ) {
      return 1;
    }

    const [frontOne, backOne, frontTwo, backTwo] = pages.map(inSlotOrder);

    check('the first sheet is full', frontOne.length === PER_SHEET, String(frontOne.length));
    check(
      'the second sheet holds the remaining two',
      frontTwo.length === 2,
      String(frontTwo.length)
    );

    const cardWidthMm = frontOne[0].width * MM_PER_PT;
    const cardHeightMm = frontOne[0].height * MM_PER_PT;
    check(
      'a card measures 63 x 88 mm on the page',
      Math.abs(cardWidthMm - 63) < 0.2 && Math.abs(cardHeightMm - 88) < 0.2,
      `${cardWidthMm.toFixed(2)} x ${cardHeightMm.toFixed(2)} mm`
    );

    // Cards butt against each other, so a column boundary is one cut.
    const adjacent = Math.abs(frontOne[1].x - (frontOne[0].x + frontOne[0].width)) < 0.5;
    check('neighbouring cards share a cut line', adjacent);

    const firstSheet = pairFrontsToBacks(frontOne, backOne, LETTER_WIDTH_PT);
    const secondSheet = pairFrontsToBacks(frontTwo, backTwo, LETTER_WIDTH_PT);

    for (const [label, sheet] of [
      ['first', firstSheet],
      ['second', secondSheet],
    ]) {
      check(
        `every card on the ${label} sheet finds its own back at its mirror`,
        sheet.problems.length === 0,
        sheet.problems.join('; ')
      );
    }

    // The deck boundary. Alpha's eight cards take slots 0-7 of the first sheet
    // and Beta's first card takes slot 8, so that one sheet has to carry both
    // decks' backs -- which is the case a per-sheet back gets wrong.
    check(
      'the sheet drawn from two decks uses both of their backs',
      new Set(firstSheet.pairs.values()).size === 2,
      `fronts ${JSON.stringify([...firstSheet.pairs])}`
    );
    check(
      'the two artworks from one deck share that deck’s back',
      firstSheet.pairs.size === 3 && new Set(firstSheet.pairs.values()).size === 2,
      `${firstSheet.pairs.size} distinct fronts on the sheet`
    );

    if (pageErrors.length > 0) {
      check('the page threw nothing while building the sheets', false, pageErrors.join(' | '));
    }

    if (selftest) {
      // Sensitivity. The mirror assertion is the one that matters and the one
      // that would pass vacuously if it were reading the wrong numbers, so run
      // it against a backing page that was laid out without the mirror -- the
      // exact bug it is there to catch -- and require it to complain.
      console.log('\n[selftest] the same assertions against a backing page that was not mirrored:');

      // The exact bug: each card's back drawn at that card's own slot rather
      // than at its mirror. Every box on the page is still occupied and every
      // back still appears the right number of times -- which is why position
      // alone cannot see it, and why this arm exists.
      const mirrorSlot = (slot) =>
        Math.floor(slot / COLUMNS) * COLUMNS + (COLUMNS - 1 - (slot % COLUMNS));
      const correctBacks = inSlotOrder(backOne);
      const unmirrored = correctBacks.map((back, slot) => ({
        ...back,
        image: correctBacks[mirrorSlot(slot)].image,
      }));

      const notMirrored = pairFrontsToBacks(frontOne, unmirrored, LETTER_WIDTH_PT);
      if (notMirrored.problems.length === 0) {
        console.error('[selftest] FAILED: an unmirrored backing page was accepted');
        return 1;
      }
      console.log(
        `  ok   an unmirrored backing page is rejected (${notMirrored.problems.join('; ')})`
      );

      // And the second assertion the real run makes has to see it too: with the
      // mirror gone, one deck's cards no longer agree on a back, so the sheet
      // stops carrying two distinct ones.
      if (new Set(notMirrored.pairs.values()).size === 2) {
        console.error('[selftest] FAILED: an unmirrored page still looked like two decks of backs');
        return 1;
      }
      console.log('  ok   an unmirrored page no longer reads as two decks of backs');

      const shifted = backOne.map((back) => ({ ...back, x: back.x + 2 }));
      if (pairFrontsToBacks(frontOne, shifted, LETTER_WIDTH_PT).problems.length === 0) {
        console.error('[selftest] FAILED: a backing page shifted by 2pt was accepted');
        return 1;
      }
      console.log('  ok   a backing page off by two points is rejected');
    }
  } finally {
    await browser.close();
    await server.close();
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} failure(s): ${failures.join(', ')}`);
    return 1;
  }
  console.log('\ncheck:print passed');
  return 0;
}

process.exit(await run());
