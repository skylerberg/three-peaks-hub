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

Two more that were learned here rather than inherited, both of which fail an
install or a build outright rather than degrading:

- **A version published in the last few days will not install.**
  `minimumReleaseAgeStrict` is the supply-chain gate that makes a compromised
  release published an hour ago a non-event, and it refuses with
  `ERR_PNPM_NO_MATURE_MATCHING_VERSION`. Write dependency ranges loose enough
  for pnpm to pick the newest version that has aged past it. Pinning an exact
  brand-new one forces an entry in `minimumReleaseAgeExclude`, which is
  precisely the protection being switched off. Watch for the transitive case:
  `vite` needs an `overrides` entry because the svelte and tailwind plugins
  peer-resolve it, and a peer-resolved package ignores the range you wrote.
- **An install that shrinks the dependency set wants to purge `node_modules`,
  and will not do it without a terminal.** Anywhere non-interactive — a
  container build, most obviously — it stops on
  `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`. Pass
  `--config.confirmModulesPurge=false` on that one command rather than turning
  the setting off workspace-wide; interactively the prompt is worth having.

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
   `project.created_by` and `file_version.created_by`, which are RESTRICT.
8. **Query and path parameters are declared, not just read.** `c.req.query()`
   alone leaves them out of the spec, so the generated client cannot type them.
9. **Take `validator` and `resolver` from `hono-openapi`, never from
   `@hono/standard-validator` directly.** Both packages export a `validator`,
   the import looks equally reasonable either way, and the wrong one type-checks
   and validates requests correctly at runtime — it simply registers nothing in
   the spec. The symptom appears two steps away: a request body missing from
   `openapi.json`, and a generated client whose body is typed `never`. Response
   schemas have the same shape of trap; they have to be wrapped in `resolver()`
   or they are not schema objects at all.
10. Comments are minimal and explain only non-obvious _why_.

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

## File versions

A file is the newest of a stack. `file_version` holds the stack and the current
version is **`max(version_number)`** — there is no pointer column, because a
pointer is a second answer to "which one is current" that can disagree with the
list itself.

`file` keeps `storage_key`, `content_type`, `byte_size`, `checksum` and the
image dimensions as a mirror of that newest version, for two reasons: a rolling
deploy leaves pods on the previous release reading those columns, and the
directory listing stays a single query. `appendFileVersion` writes every
`file_version` row and every later change to the mirror, inside the caller's
transaction; the only other writer is `/upload`, which inserts the `file` row
with its first set of values before handing over.

**History only grows.** A restore copies the old object to a new key and appends
that as a further version; nothing rewinds a number and no version row is ever
mutated. Bytes identical to the current version append nothing at all and say so,
which is what stops a re-import of an unchanged deck from writing a version per
card.

Two consequences that are easy to get wrong. The quota sums `file_version`, and
every path that deletes a file, a folder or a project has to collect **every**
version's key — the mirror names one object out of N and the rest would be
orphaned in the bucket with nothing pointing at them. And a row written before
this table existed has bytes and no version: the read paths present the mirror as
version 1, and the first append adopts it before adding anything, or that append
would overwrite the only reference to those bytes. Its bytes count nothing
towards the quota until that append, because the sum has no row to reach — the
one residual a pod on the previous release can still leave after the migration.

The 3D studio deliberately follows the current version. `component_model` is one
row per file, so a card that gains new artwork keeps the dial-in someone already
gave it.

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
- **A download is a `<button>` calling `downloadFile`, never an `<a href>`.** The
  API takes its credential from the `Authorization` header only, and a
  browser-initiated GET sends none, so a plain link 401s silently. An anchor
  without a `download` attribute is also swallowed by the router's `use:link`.
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

# The 3D studio

`/projects/:projectId/files/:fileId/3d` turns one uploaded image into one
component — a card, or a wooden piece cut to the image's own silhouette — and
exports it as a `.glb`.

**All of it runs in the browser.** `apps/api` has no image or geometry
dependency; it recognises two more content types and stores a settings blob.
`apps/web/src/lib/model3d/` is reached only by `await import()`, so `three` —
larger than everything else in the bundle put together — stays in a chunk that
only this screen pays for.

- **Millimetres in the settings, metres in the file.** glTF's unit is the metre
  and every importer assumes it, so `MM` in `apps/web/src/lib/model3d/units.ts`
  is applied when geometry is built and never afterwards by scaling a node.
- **A bevel in `ExtrudeGeometry` grows the piece**: the outline it is handed
  becomes the flat face, and the bevel then pushes out past it in x and y and
  past the depth in z. `geometry/extrude.ts` offsets it inwards by its own size
  and takes it out of the depth, so a 63.5 mm card measures 63.5 mm. It exported
  63.66 mm before.
- **`ExtrudeGeometry` puts both lids in one group**, so a card's two faces cannot
  carry different artwork. `geometry/faceGroups.ts` repartitions the triangles
  into front, back and rim, and rewrites the cap UVs — which are world
  coordinates in metres otherwise, sampling one corner of the texture. Textures
  are exported with `flipY` off, as glTF requires, so the UVs are written to
  match; the two have to agree.
- **A vector source is already an outline.** An SVG's paths are parsed and
  extruded; only a raster is contour-traced. Rasterising an SVG to trace the
  raster back would throw away the exact edge.
- Textures are generated from seeded noise, never `Math.random()`: the same
  settings have to produce the same file twice.

Settings live in `component_model`, one row per source image, and the bounds the
API enforces are named once in `packages/shared/src/models3d.ts` so no input can
offer a value the server will reject.

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

`check:upload` drives the real file picker in a real browser against a real API,
and `check:model3d` drives the studio and reads the `.glb` that comes out —
GLTFExporter needs a real canvas to serialise a texture, so nothing else covers
the step between "the vertices are right" and "a file Blender can open came
out". Both need an API running (`pnpm dev:api`); they skip locally without one
and fail under CI rather than skipping. `check:a11y` reaches its one screen
behind the session the same way, and skips only that screen without an API —
it is in `check:all`, which has to keep passing on a checkout with nothing else
running.

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
