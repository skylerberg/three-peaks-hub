// Signing up and creating a project, driven through the real forms. Two probes
// need an authenticated screen to look at, and neither should be the one that
// owns how an account comes into being.

export async function apiReachable(api) {
  try {
    const response = await fetch(`${api}/health`);
    return response.ok;
  } catch {
    return false;
  }
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
  await browser.page.waitForSelector('button:has-text("Upload files")', { timeout: 10_000 });
}
