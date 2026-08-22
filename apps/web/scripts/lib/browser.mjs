// A deliberately small wrapper around Playwright. The returned object is
// { setViewport, goto, eval, press, click, screenshot, close } and nothing
// more, so a check cannot quietly start depending on the rest of the Playwright
// API and become something only its author can read.
//
// Chromium is not the target, it is the default. `engine: 'webkit'` runs the
// same probe under the engine every iOS browser uses, and the two disagree --
// Chromium is the optimistic one. Any question about focus, the on-screen
// keyboard, or what an unmount does to a focused field wants both.

const ENGINES = ['chromium', 'firefox', 'webkit'];

export async function createBrowser(options = {}) {
  const engineName = options.engine ?? 'chromium';
  if (!ENGINES.includes(engineName)) {
    throw new Error(`Unknown engine ${engineName}; expected one of ${ENGINES.join(', ')}`);
  }

  const playwright = await import('playwright');
  const engine = playwright[engineName];

  let browser;
  try {
    browser = await engine.launch();
  } catch (error) {
    // Locally a missing engine is a skip, so a check can tell you to install it
    // rather than failing. Under CI it must fail: a gate that silently measures
    // nothing is worse than no gate.
    if (process.env.CI) throw error;
    console.warn(`[browser] ${engineName} is not installed; skipping. ${error.message}`);
    return null;
  }

  const context = await browser.newContext({
    colorScheme: options.colorScheme ?? 'light',
    viewport: { width: 1280, height: 800 },
  });
  let page = await context.newPage();

  // Every 5xx the app sees, kept for whoever reports a failure. A probe that
  // waits for an element the screen could not draw otherwise times out naming
  // the selector and nothing about the request that made drawing it impossible
  // -- a migration the local database has not had, most recently.
  const serverErrors = [];
  const watchResponses = (target) => {
    target.on('response', (response) => {
      if (response.status() < 500) return;
      const path = new URL(response.url()).pathname;
      serverErrors.push(`${response.request().method()} ${path} -> ${response.status()}`);
    });
  };
  watchResponses(page);

  return {
    async setViewport({ width, height, mobile = true }) {
      // Playwright fixes viewport and colour scheme per context, so changing
      // either discards the page. goto() again afterwards rather than
      // navigating once and resizing around it.
      await page.close();
      const next = await browser.newContext({
        colorScheme: options.colorScheme ?? 'light',
        viewport: { width, height },
        isMobile: mobile,
        hasTouch: mobile,
      });
      page = await next.newPage();
      watchResponses(page);
    },
    async goto(url, { wait = 0 } = {}) {
      await page.goto(url, { waitUntil: 'load' });
      if (wait > 0) await page.waitForTimeout(wait);
    },
    async eval(expression) {
      return page.evaluate(expression);
    },
    async press(key, { selector } = {}) {
      if (selector) await page.focus(selector);
      await page.keyboard.press(key);
    },
    async click(selector) {
      // A real mouse press at the element's centre, not a synthesized event.
      // The gap between the two is invisible from the probe's side, because a
      // listener answers both -- and it is where "the menu just closes" bugs
      // live.
      await page.click(selector);
    },
    async setInputFiles(selector, files) {
      await page.setInputFiles(selector, files);
    },
    async screenshot() {
      return page.screenshot();
    },
    async close() {
      await browser.close();
    },
    get page() {
      return page;
    },
    get serverErrors() {
      return [...serverErrors];
    },
  };
}
