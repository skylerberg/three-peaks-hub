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

export async function createProject(browser, projectName) {
  await browser.click('button:has-text("New project")');
  await browser.page.fill('input[placeholder="Colori"]', projectName);
  await browser.click('button[type="submit"]');
  await browser.page.waitForSelector(`a:has-text("${projectName}")`, { timeout: 10_000 });
  await browser.click(`a:has-text("${projectName}")`);
  await browser.page.waitForSelector('button:has-text("Upload files")', { timeout: 10_000 });
}
