// A hand-rolled History router. The whole app is a handful of screens, and a
// discriminated-union Route means App.svelte switches exhaustively -- a new
// route that nothing renders is a compile error rather than a blank page.

export type Route =
  | { name: 'projects' }
  | { name: 'project'; params: { projectId: string; folderId: string | null } }
  | { name: 'members'; params: { projectId: string } }
  | { name: 'deleted'; params: { projectId: string } }
  | { name: 'decks'; params: { projectId: string } }
  | { name: 'deck'; params: { projectId: string; deckId: string } }
  | { name: 'print'; params: { projectId: string; deckId: string | null } }
  | { name: 'model'; params: { projectId: string; fileId: string } }
  | { name: 'versions'; params: { projectId: string; fileId: string } }
  | { name: 'account' }
  | { name: 'login' }
  | { name: 'signup' }
  | { name: 'forgot-password' }
  | { name: 'reset-password'; params: { token: string } }
  | { name: 'not-found' };

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

export function matchRoute(path: string, search = ''): Route {
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read once and discarded; nothing renders from it
  const params = new URLSearchParams(search);
  const clean = path.replace(/\/+$/, '') || '/';

  if (clean === '/' || clean === '/projects') return { name: 'projects' };
  if (clean === '/account') return { name: 'account' };
  if (clean === '/login') return { name: 'login' };
  if (clean === '/signup') return { name: 'signup' };
  if (clean === '/forgot-password') return { name: 'forgot-password' };
  if (clean === '/reset-password') {
    return { name: 'reset-password', params: { token: params.get('token') ?? '' } };
  }

  const members = new RegExp(`^/projects/(${UUID})/members$`).exec(clean);
  if (members) return { name: 'members', params: { projectId: members[1] } };

  const deleted = new RegExp(`^/projects/(${UUID})/deleted$`).exec(clean);
  if (deleted) return { name: 'deleted', params: { projectId: deleted[1] } };

  const deck = new RegExp(`^/projects/(${UUID})/decks/(${UUID})$`).exec(clean);
  if (deck) return { name: 'deck', params: { projectId: deck[1], deckId: deck[2] } };

  const decks = new RegExp(`^/projects/(${UUID})/decks$`).exec(clean);
  if (decks) return { name: 'decks', params: { projectId: decks[1] } };

  const print = new RegExp(`^/projects/(${UUID})/print$`).exec(clean);
  if (print) {
    // A deck named in the query arrives pre-selected, so "print this deck" from
    // the editor is one click rather than a screen and then a checkbox.
    const deckId = params.get('deck');
    return {
      name: 'print',
      params: { projectId: print[1], deckId: deckId && deckId.length > 0 ? deckId : null },
    };
  }

  const model = new RegExp(`^/projects/(${UUID})/files/(${UUID})/3d$`).exec(clean);
  if (model) return { name: 'model', params: { projectId: model[1], fileId: model[2] } };

  const versions = new RegExp(`^/projects/(${UUID})/files/(${UUID})/versions$`).exec(clean);
  if (versions)
    return { name: 'versions', params: { projectId: versions[1], fileId: versions[2] } };

  const project = new RegExp(`^/projects/(${UUID})$`).exec(clean);
  if (project) {
    const folderId = params.get('folder');
    return {
      name: 'project',
      params: {
        projectId: project[1],
        folderId: folderId && folderId.length > 0 ? folderId : null,
      },
    };
  }

  return { name: 'not-found' };
}

const MAX_REDIRECTS = 10;

class Router {
  current = $state.raw<Route>(matchRoute('/'));
  path = $state('/');

  // Returning a path from this redirects instead of navigating. It runs on
  // navigate() and on popstate but NOT on the initial page load -- the caller
  // has to guard that once, after the session store knows whether there is a
  // signed-in account.
  beforeNavigate: ((to: Route, path: string) => string | undefined | void) | null = null;

  start(): void {
    this.#apply(location.pathname + location.search, { push: false, guard: false });
    addEventListener('popstate', () => {
      this.#apply(location.pathname + location.search, { push: false, guard: true });
    });
  }

  navigate(path: string): void {
    this.#apply(path, { push: true, guard: true });
  }

  redirect(path: string): void {
    this.#apply(path, { push: false, guard: true, replace: true });
  }

  #apply(target: string, options: { push: boolean; guard: boolean; replace?: boolean }): void {
    let path = target;

    if (options.guard && this.beforeNavigate) {
      // Bounded: a pair of guards that each redirect to the other would
      // otherwise hang the tab with no stack to read.
      for (let hop = 0; hop < MAX_REDIRECTS; hop += 1) {
        const [pathname, search = ''] = path.split('?');
        const redirected = this.beforeNavigate(matchRoute(pathname, search), path);
        if (typeof redirected !== 'string' || redirected === path) break;
        path = redirected;
        if (hop === MAX_REDIRECTS - 1) {
          throw new Error(`Redirect loop while navigating to ${target}`);
        }
      }
    }

    const [pathname, search = ''] = path.split('?');
    this.current = matchRoute(pathname, search);
    this.path = path;

    if (options.replace) history.replaceState({}, '', path);
    else if (options.push) history.pushState({}, '', path);
  }
}

export const router = new Router();

// Put this on an anchor, or on any container of anchors. It respects modifier
// keys, middle-click, target="_blank", downloads and external origins, so a
// link that should leave the app still does.
export function link(node: HTMLElement) {
  function onClick(event: MouseEvent) {
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const anchor = (event.target as HTMLElement | null)?.closest('a');
    if (!anchor) return;
    if (anchor.target && anchor.target !== '_self') return;
    if (anchor.hasAttribute('download')) return;

    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:')) return;

    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read once inside the handler; nothing retains it
    const url = new URL(anchor.href, location.href);
    if (url.origin !== location.origin) return;

    event.preventDefault();
    router.navigate(url.pathname + url.search);
  }

  node.addEventListener('click', onClick);
  return {
    destroy() {
      node.removeEventListener('click', onClick);
    },
  };
}
