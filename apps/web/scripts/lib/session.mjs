// Signing up and creating a project, driven through the real forms. Two probes
// need an authenticated screen to look at, and neither should be the one that
// owns how an account comes into being.

// The routes these probes drive, named the way the spec names them. `/health`
// answers 200 from whatever holds the port -- on one machine that was a sibling
// project's API, and on the same machine a copy of this one started before the
// studio's cold-load route existed and never restarted. Both left a probe
// failing fifteen seconds later inside a screen with nothing to say about why,
// so the port is asked what it is and what it serves before a browser starts.
const REQUIRED_PATHS = [
  ['post', '/api/auth/signup'],
  ['post', '/api/projects'],
  ['post', '/api/files/upload'],
  ['get', '/api/files/directory'],
  ['get', '/api/files/{id}'],
  ['get', '/api/files/{id}/versions'],
];

const APP_NAME = 'three-peaks-hub';

/**
 * Three outcomes, because they call for three different things: `ok` runs the
 * probe, `absent` is the local convenience of a checkout with nothing running,
 * and the third -- something is there and it is not this build -- is a failure
 * wherever it happens. Skipping that one would report a pass for a gate that
 * measured nothing; proceeding is the fifteen-second mystery this replaces.
 *
 * `also` names the routes one probe needs and the others do not, in the same
 * `[method, path]` shape. They belong to the caller rather than to the shared
 * list: a route only one probe drives should fail in that probe, by name, and
 * not make every other one refuse an API that serves them perfectly well.
 */
export async function inspectApi(api, also = []) {
  let root;
  try {
    root = await fetch(`${api}/`);
  } catch {
    return { ok: false, absent: true, reason: `no API at ${api}` };
  }

  if (!root.ok) {
    return { ok: false, absent: true, reason: `no API at ${api} (GET / answered ${root.status})` };
  }

  const identity = await root.json().catch(() => ({}));
  if (identity.name !== APP_NAME) {
    return {
      ok: false,
      absent: false,
      reason:
        `the server at ${api} is not this API: GET / named ` +
        `${JSON.stringify(identity.name ?? null)}, expected ${JSON.stringify(APP_NAME)}. ` +
        'Point API_PROXY_TARGET at this checkout.',
    };
  }

  const response = await fetch(`${api}/api/openapi.json`);
  const spec = response.ok ? await response.json().catch(() => ({})) : {};
  const missing = [...REQUIRED_PATHS, ...also].filter(
    ([method, path]) => spec.paths?.[path]?.[method] === undefined
  );
  if (missing.length > 0) {
    return {
      ok: false,
      absent: false,
      reason:
        `the API at ${api} is older than this checkout: it does not serve ` +
        `${missing.map(([method, path]) => `${method.toUpperCase()} ${path}`).join(', ')}. ` +
        'Restart it.',
    };
  }

  return { ok: true, absent: false, reason: '' };
}

// A fresh throwaway account per run: the probes upload files and save models,
// and a shared one would accumulate both until a quota check started failing
// for reasons that have nothing to do with the change under test.
export async function signUp(browser, base, { name, stamp }) {
  const email = `probe-${stamp}@example.test`;
  const password = 'correct horse battery staple';

  await browser.goto(`${base}/signup`, { wait: 300 });
  await browser.page.fill('input[autocomplete="name"]', name);
  await browser.page.fill('input[type="email"]', email);
  await browser.page.fill('input[type="password"]', password);
  await browser.click('button[type="submit"]');
  await browser.page.waitForSelector('text=Projects', { timeout: 10_000 });

  return { email, password };
}

// One browser context serves every screen of a colour scheme, and the session
// guard bounces an already-signed-in visitor straight off /signup -- where the
// next signUp's page.fill then waits for a field that is not there. Signing out
// first makes each authenticated screen independent of the order they run in.
//
// Through the real control rather than by emptying localStorage: init() adopts
// the stored token and writes it back, so a clear that lands mid-boot is undone
// a moment later.
export async function signOut(browser, base) {
  // Asked for on a public route: the guard remembers where a signed-out visitor
  // was headed and sends them back to it after the next sign-up, so probing for
  // a session on /account is what lands the account screen instead of Projects.
  await browser.goto(`${base}/login`, { wait: 0 });
  const signedIn = await browser.page.evaluate(() => localStorage.getItem('tph.token') !== null);
  if (!signedIn) return;

  await browser.goto(`${base}/account`, { wait: 0 });
  await browser.page.waitForSelector('button:has-text("Sign out")', { timeout: 10_000 });
  await browser.click('button:has-text("Sign out")');
  await browser.page.waitForSelector('h1:has-text("Sign in")', { timeout: 10_000 });
}

export async function createProject(browser, projectName) {
  await browser.click('button:has-text("New project")');
  await browser.page.fill('input[placeholder="Colori"]', projectName);
  await browser.click('button[type="submit"]');
  await browser.page.waitForSelector(`a:has-text("${projectName}")`, { timeout: 10_000 });
  await browser.click(`a:has-text("${projectName}")`);
  // The project screen is a list of sections, so this leaves the browser at the
  // way in to all of them rather than inside one.
  await browser.page.waitForSelector('a:has-text("Assets")', { timeout: 10_000 });
}

// The file explorer, which is one section among the others: what belongs to no
// deck and no component.
export async function openAssets(browser) {
  await browser.click('a:has-text("Assets")');
  await browser.page.waitForSelector('button:has-text("Upload files")', { timeout: 10_000 });
}
