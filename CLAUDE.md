# three-peaks-hub

Board game design tools for Three Peaks Games, at **tools.threepeaksgames.com**.
A pnpm-workspace monorepo: a Hono + Kysely + Postgres API, a Svelte 5 + Vite
SPA, and a small Cloud Run edge that serves per-PR previews.

```
apps/api            Hono + Kysely + Postgres        -> GKE
apps/web            Svelte 5 runes + Vite SPA       -> GCS bucket behind a GCLB
apps/preview-edge   Cloud Run static edge           -> Cloud Run
packages/shared     generated API + realtime clients, and the constants both
                    sides must agree on
infra/terraform     the load balancer, buckets, certificates, monitoring
infra/k8s           raw manifests, {COMMITHASH} substituted by the deploy
```

# Package manager

pnpm, pinned by `packageManager`. **`pnpm-workspace.yaml` carries every pnpm
setting** — pnpm 11 reads them from nowhere else, `.npmrc` is auth and registry
only, and package.json's `pnpm` field is ignored. **Keys are camelCase**; a
kebab-case key is dropped silently, with no warning and exit 0.

Two behaviours that differ from npm and have already cost time in the reference
repos this is modelled on:

- **`pnpm run x -- <arg>` forwards the `--` into argv**, where npm swallowed it.
  Under vitest that reads as end-of-options and everything after is ignored, so
  `pnpm test -- --shard=1/2` silently runs the whole suite in every shard and
  passes green. Write `pnpm test <path>`.
- **A dependency may not run install scripts unless `allowBuilds` names it**
  (`strictDepBuilds`), and a _denial_ has to be written down rather than left
  out — an omission and a glob both match nothing.

`minimumReleaseAgeStrict` holds back versions published in the last few days.
Dependency ranges are written loose enough for pnpm to resolve to the newest
version that has aged past it; pinning an exact brand-new version needs an
explicit exclusion, which defeats the point. `vite` is pinned by an `overrides`
entry because the svelte and tailwind plugins peer-resolve it transitively.

**TypeScript is pinned to 6.0.3, not the 7.x that npm calls `latest`.**
typescript-eslint declares `typescript: >=4.8.4 <6.1.0` and svelte-check
declares `^5 || ^6`; adopting 7 silently costs type-aware linting and every
Svelte type check. Revisit when both peer ranges admit it.

# packages/shared, and the generation cycle

`packages/shared` is **source-only**: `exports` points at `.ts`, there is no
build step and no `dist/`. That is load-bearing. If it compiled, the order would
be build shared → dump the API spec (which imports shared) → rewrite shared's
source → rebuild — a real cycle. With no build, the generation edge is a plain
file write.

Two rules keep it that way, both enforced by eslint rather than by memory:

1. **`apps/api` may never import `@three-peaks/shared/api` or `/realtime`.**
   Those are generated _from_ the API.
2. **Nothing in `packages/shared` may import `node:*`, `hono`, `kysely` or
   `svelte`.** It is loaded by a Node server, a browser bundle and jsdom.

`pnpm run generate` dumps the spec and the realtime document and rewrites both
clients. The generated files are **committed**, so `apps/web` builds on a fresh
clone with no database, and so a breaking change to the API surface shows up as
a red diff in review. CI runs `pnpm run check:generated`, which regenerates and
fails on any diff — exact, because in one repo the spec is always the working
tree.

# API conventions

1. **All mutations run in a transaction.** `transactionMiddleware` wraps
   POST/PUT/PATCH/DELETE; handlers read `c.get('db')` and never import `db`.
   Hono's compose swallows a handler throw onto `c.error`, so the middleware
   rethrows it — without that, Kysely sees a clean return and commits the
   partial write. Side effects go on `c.get('postCommitHooks')`.
2. **Auth is global; opting out is a marker.** `app.use('*', authMiddleware)`,
   with `skipAuth` / `optionalAuth` matched by _handler identity_, and
   `assertPublicRoutes` failing the boot if the marked set drifts from the list
   in `apps/api/src/utils/assert-public-routes.ts`. A route that forgets auth
   cannot exist. Never `use('*', skipAuth)` on a sub-router — it matches every
   sibling sharing that mount prefix.
3. **Two Hono context types.** Handlers on an `AppHono` get a `user`; handlers
   on a `PublicHono` get `AuthenticatedUser | undefined`. Reading the user on a
   public route is a compile error. A router hosting both exports a second
   `PublicHono` for its public half.
4. **404 for a caller with no access; 403 only for a caller who can already read
   the row.** Centralised in `apps/api/src/services/authorization.ts`. Reads
   assert access, mutations assert write; a mutating route that asserts only
   access is a defect.
5. **Client-supplied ids on POST**, duplicate → 409, mapped from Postgres 23505
   via `isUniqueViolation` — a pre-check alone races.
6. **Re-export every schema from `apps/api/src/schemas/index.ts`.** The OpenAPI
   component-name registry reads that barrel; a schema left out appears inline
   and the generated client gets an anonymous duplicate instead of a named type.
7. Length limits in ArkType, not CHECK constraints. All FKs cascade except
   `project.created_by`, which is RESTRICT.
8. **Query and path parameters are declared, not just read.** `c.req.query()`
   alone leaves them out of the spec, so the generated client cannot type them.
9. Comments are minimal and explain only non-obvious _why_.

## Realtime

`/ws` rides the raw HTTP upgrade on the same server, and is deliberately never
part of the OpenAPI spec — it has no request or response to describe. Its types
are a second document at `GET /api/realtime-events.json`.

Three tables are pinned to each other: `eventCatalog.ts` says which types exist,
`payloads.ts` gives each a shape (keyed by the catalog, so a type with no
payload does not compile), and `closeCodes.ts` is the set a client must route
on. `publishAfterCommit` is generic over the type, so a payload that disagrees
with its row is a type error at the publish site.

The bus is in-process until `REDIS_URL` is set. **Subscribing is not
authorization**: a socket may name any project id, and delivery re-checks access
for every event — which is what makes membership removal take effect without a
reconnect. The wire frame is `{ type, ...payload }`, flattened at the socket
boundary from the bus's `{ type, payload }`; an e2e test holds the two together.

## Migrations

Deploys are rolling and the migrate Job runs **before** the rollout, so old and
new pods serve side by side. **Every migration must be backward-compatible with
the previous release** — drop or rename a column in a follow-up release.

`pnpm --filter @three-peaks/api run kysely-codegen` migrates a scratch database,
introspects that and drops it. It never reads the database you develop against;
introspecting that is how a column left behind by an abandoned branch gets
committed looking exactly like a real one.

# Web conventions

Svelte 5 **runes only** (`runes: true` in `svelte.config.js`, so `export let`,
`$:` and svelte/store are compile errors). No SvelteKit, no state library, no
router library.

- Shared state is a class instance exported from a `*.svelte.ts` module.
- `src/lib/router.svelte.ts` is a hand-rolled History router with a
  discriminated-union `Route`. `beforeNavigate` **does not run on the initial
  page load** — `App.svelte` guards that once by hand, after the session store
  settles.
- Session status is four-valued. `offline` is a signed-in session whose token
  could not be _checked_; collapsing it into `anon` is what makes launching
  without a network land on the login screen with every store reset.
- The API client is same-origin (`baseUrl: ''`). There is no base URL to
  configure anywhere.
- Optimistic updates: apply, send, and on failure toast and refetch — never
  snapshot-rollback.
- Styling uses the tokens in `src/app.css` (`bg-canvas`, `bg-surface`,
  `border-edge`, `text-ink`, `text-muted`, `bg-accent`). Never hardcode
  `gray-*`. Tap targets ≥ 44px (`min-h-11`).
- **A test that needs runes must be named `*.svelte.test.ts`.** Without the
  infix the runes are never compiled and the failure is silent: a `$derived`
  keeps handing back its first value.
- Two Svelte 5 traps: `$state` returns a _proxy_, so a value captured for later
  must be read back off the `$state` variable after assignment; and **writing**
  `$state` during teardown silently does not survive, so bookkeeping that must
  outlive an unmount belongs in a plain binding.

# Running things

```sh
pnpm install && pnpm setup:env   # once per checkout or worktree
pnpm dev                         # api on :3001, web on :5173
```

Native Postgres 18 and Redis (`brew`), no Docker for development. `API_PROXY_TARGET`
moves the Vite proxy, which matters as soon as a second branch is in flight and
the main checkout already holds 3001.

**Run only the tests your change touches; let CI run the rest.**
`pnpm --filter @three-peaks/api test <path>` takes seconds. Reach for the whole
suite when a change is broad enough that you cannot name the files it affects,
and once before opening the PR.

The test database name is **derived, never configured**: `vitest.config.ts`
appends this checkout's directory name and a hash of its path, and both the
config and every forked worker assert it. That is what lets parallel worktrees
run the suite at once. `globalSetup` also takes a Postgres advisory lock, so a
second run in the _same_ checkout refuses to start rather than truncating out
from under the first.

# Checks

`pnpm run check:all` is the whole gate. Three parts of it are worth knowing:

- **`check:test-guards`** is mutation testing. Every entry in
  `scripts/test-guards.mjs` names a bug and the edit that puts it back, and the
  named tests must **fail** with it in place. Nothing is written to the source
  tree — the edit rides in `GUARD_MUTATION` and is applied by a Vite transform.
  Each `find` must match **exactly once**: a pattern matching nothing leaves the
  source correct and the tests green, which is indistinguishable from a guard
  that works. Guards sharing a database run serially, because the advisory run
  lock refuses two suites against one database — correctly.
- **`check:comments`** reads the prose and fails on the same sentence in two
  files, and on a file or symbol named in prose that no longer resolves. When it
  fires, give the rule one owner — the module that implements it — and cut the
  other copy down to what is local.
- **`check:a11y`** runs axe-core over the real screens in **both colour
  schemes**; half the tokens exist only under `prefers-color-scheme: dark`, so a
  light-only run reads none of them.
- **`check:k8s`** renders the manifests with a full-length SHA, the way the
  deploy does, and checks the name and label lengths that a client-side
  `kubectl --dry-run` silently accepts. It caught a migrate Job whose name was
  64 bytes; only the API server had been rejecting it, at deploy time.
- **`check:dockerfiles`** asserts that every path a Dockerfile COPYs survives
  `.dockerignore`. That mismatch is invisible to every other check — the API
  image copies the other packages' manifests, because pnpm reads the whole
  workspace to validate the lockfile even for a filtered install, and excluding
  those directories fails a line that reads perfectly well.

**All of these take `--selftest`**, which re-runs them against something
deliberately put back on the bug and fails if it still _passes_. They share a
failure mode a unit test mostly does not: measuring nothing and reporting green.
CI runs them without the flag; the flag is how you earn the right to believe
them.

`check:upload` drives the real file picker in a real browser against a real API.
It needs one running (`pnpm dev:api`); it skips locally without one and fails
under CI rather than skipping.

**Never run `prettier --write` or `eslint --fix` by hand.** `.githooks/post-commit`
runs both over the files each commit touched and amends the result in. The
consequence: `format:check` is only meaningful on a _committed_ tree — failing
it on uncommitted edits means nothing has fixed them yet. It stays in the gate
as the assertion that the hook actually ran.

`scripts/tmp-*` and `apps/*/scripts/tmp-*` are the sanctioned throwaway-probe
prefixes, ignored by git, eslint, vitest discovery and `check:comments`.

# Deployment

The SPA is a static bundle in a public GCS bucket behind a Terraform-managed
GCLB. The API runs in GKE, exposed through a **standalone NEG** created from the
Service annotation — there is no Ingress object anywhere. The URL map sends
`/api/`, `/ws` and `/health` to the API and everything else to the bucket, with
a catch-all rule rewriting 404 to `/index.html`; `/assets/` sits above it with
no error policy, because those names are content-hashed and a miss must stay a
404 rather than becoming HTML a `<script>` fails to parse.

`infra/terraform/README.md` has the bootstrap ordering. The one thing to know
before a first apply: **the NEG is created by GKE, so the first deploy has to
run before the `data` source resolves** — it is a two-pass apply.

Secrets are created once by hand. Workload Identity means the pod needs no key
file for GCS at all.
