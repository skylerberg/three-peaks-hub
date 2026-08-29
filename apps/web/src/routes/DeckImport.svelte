<script lang="ts">
  import Button from '../components/ui/Button.svelte';
  import Spinner from '../components/ui/Spinner.svelte';
  import { ApiError, api, assertOk } from '../api/client.ts';
  import { deckImports } from '../lib/deckImports.svelte.ts';
  import { decks } from '../lib/decks.svelte.ts';
  import { link } from '../lib/router.svelte.ts';
  import { apiMessage } from '../lib/session.svelte.ts';

  interface Props {
    projectId: string;
    deckId: string;
  }
  let { projectId, deckId }: Props = $props();

  let error = $state<string | null>(null);
  let canEdit = $state(false);
  let resuming = $state(false);
  let dropActive = $state(false);
  let openRunProgress = $state<{
    started_at: string;
    pages: number;
    page_count: number;
  } | null>(null);

  const uid = $props.id();

  const deck = $derived(decks.deck);
  // Moving between two decks' import screens changes these props rather than
  // remounting, so this renders once before the effect below has asked for the
  // new deck's binding.
  const binding = $derived(deckImports.bindingDeckId === deckId ? deckImports.binding : null);
  const status = $derived(deckImports.status);
  const busy = $derived(status === 'importing' || status === 'finishing');
  // The store is one instance, and a plan waiting to be confirmed survives this
  // screen being left. Everything about a run is read only while it is ours.
  const ours = $derived(deckImports.runDeckId === deckId);
  const plan = $derived(ours ? deckImports.plan : null);
  const summary = $derived(ours ? deckImports.summary : null);
  // The binding was read before this session's run existed, so it names an
  // older one or nothing at all -- which is what left Discard with no target.
  const startedRunId = $derived(ours && !summary ? (deckImports.run?.id ?? null) : null);
  const openRun = $derived(ours ? deckImports.openRun : null);
  const knownRunId = $derived(binding?.open_run_id ?? openRun?.run_id ?? null);
  const openRunId = $derived(startedRunId ?? knownRunId);
  const total = $derived(deckImports.pageList.length);

  $effect(() => {
    const id = deckId;
    error = null;
    void decks.loadDeck(id).catch((caught: unknown) => {
      error =
        caught instanceof ApiError && caught.status === 404
          ? 'That deck does not exist, or you do not have access to it.'
          : apiMessage(caught);
    });
  });

  $effect(() => {
    const id = projectId;
    api
      .GET('/api/projects/{id}', { params: { path: { id } } })
      .then((result) => {
        canEdit = assertOk(result).role === 'editor';
      })
      .catch(() => {
        canEdit = false;
      });
  });

  $effect(() => {
    const project = projectId;
    const id = deckId;
    void deckImports.loadBinding(project, id).catch((caught: unknown) => {
      error = apiMessage(caught);
    });
  });

  // How far the open run got, for a banner shown to whoever did not start it --
  // the counts on a run are re-derived from its own rows on every read.
  $effect(() => {
    const id = deckId;
    const runId = binding?.open_run_id ?? null;
    if (!runId) {
      openRunProgress = null;
      return;
    }
    let stale = false;
    void deckImports
      .listRuns(id)
      .then((runs) => {
        const open = runs.find((entry) => entry.id === runId);
        if (!stale) {
          openRunProgress = open
            ? {
                started_at: open.started_at,
                pages: open.counts.pages,
                page_count: open.page_count,
              }
            : null;
        }
      })
      .catch(() => {
        if (!stale) openRunProgress = null;
      });
    return () => {
      stale = true;
    };
  });

  // A run in flight has to survive this screen being left, so only a settled
  // store is cleared. Writing a rune during teardown would not stick anyway.
  $effect(() => {
    return () => {
      if (deckImports.status === 'idle' || deckImports.status === 'done') deckImports.reset();
    };
  });

  function startedAt(value: string | undefined): string {
    if (!value) return 'earlier';
    const when = new Date(value);
    return Number.isNaN(when.getTime()) ? 'earlier' : when.toLocaleString();
  }

  async function readAndPlan(file: File | null | undefined): Promise<void> {
    // Guarded as well as hidden: a drop landing in the same tick as the render
    // that took the zone away would otherwise abandon the run in progress.
    if (!file || busy || openRunId) return;
    await deckImports.readExport(file);
    if (deckImports.error) return;
    await deckImports.startRun(deckId);
  }

  async function resume(file: File | null | undefined): Promise<void> {
    if (!file || !knownRunId || busy) return;
    resuming = false;
    await deckImports.resume(deckId, knownRunId, file);
  }

  async function discard(): Promise<void> {
    if (!openRunId) return;
    await deckImports.abandon(openRunId);
  }

  function pageLabel(page: { page_number: number; title: string | null }): string {
    return page.title ?? `Untitled page ${page.page_number}`;
  }
</script>

<div class="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8" use:link>
  {#if error}
    <p role="alert" class="rounded-md border border-danger p-4 text-sm text-danger">{error}</p>
    <a class="focus-ring rounded underline" href="/projects/{projectId}/decks">Back to decks</a>
  {:else if !deck}
    <Spinner label="Loading deck" />
  {:else}
    <div class="min-w-0">
      <a class="focus-ring rounded text-sm underline" href="/projects/{projectId}/decks/{deckId}">
        {deck.name}
      </a>
      <h1 class="text-2xl font-semibold">Import from Canva</h1>
      <p class="text-sm text-muted">
        Export the design from Canva as a ZIP. Each page becomes a card, matched to the card it made
        last time by its title.
      </p>
    </div>

    {#if !canEdit}
      <p class="text-sm text-muted">You need edit access to import into this deck.</p>
    {:else}
      {#if deckImports.error}
        <p role="alert" class="rounded-md border border-danger p-4 text-sm text-danger">
          {deckImports.error}
        </p>
      {/if}

      {#if knownRunId && !plan && !busy && !summary}
        <section
          role="status"
          class="flex flex-col gap-3 rounded-md border border-warning bg-surface p-4"
        >
          <p class="text-sm">
            An import started {startedAt(openRunProgress?.started_at ?? openRun?.started_at)} is still
            open.
            {#if openRunProgress}
              {openRunProgress.pages} of {openRunProgress.page_count} pages have landed.
            {/if}
          </p>
          <p class="text-sm text-muted">
            Resuming takes the same export again and posts what has not landed yet. Discarding
            leaves everything already imported where it is; nothing is removed from the deck.
          </p>
          <div class="flex flex-wrap gap-2">
            <Button onclick={() => (resuming = !resuming)}>
              {resuming ? 'Not now' : 'Resume this import'}
            </Button>
            <Button variant="danger" onclick={discard}>Discard this import</Button>
          </div>
          {#if resuming}
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-ink" for="{uid}-resume">
                Choose the same export again
              </label>
              <input
                id="{uid}-resume"
                type="file"
                accept=".zip,application/zip"
                class="focus-ring min-h-11 rounded-md border border-edge bg-surface px-3 py-2
                       text-sm"
                onchange={(event) => {
                  const input = event.currentTarget;
                  void resume(input.files?.[0]).then(() => {
                    input.value = '';
                  });
                }}
              />
            </div>
          {/if}
        </section>
      {/if}

      {#if !openRunId && !busy}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <section
          class="flex flex-col gap-3 rounded-md border-2 border-dashed p-4 transition-colors
                 {dropActive ? 'border-accent bg-accent-soft' : 'border-edge bg-surface'}"
          ondragover={(event) => {
            event.preventDefault();
            dropActive = true;
          }}
          ondragleave={() => (dropActive = false)}
          ondrop={(event) => {
            event.preventDefault();
            dropActive = false;
            void readAndPlan(event.dataTransfer?.files?.[0]);
          }}
        >
          <h2 class="text-lg font-semibold">2. The export</h2>
          <p class="text-sm text-muted">
            Drop the ZIP here, or choose it. Nothing is imported until you have read the plan and
            pressed Import.
          </p>
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium text-ink" for="{uid}-export">
              Canva export (.zip)
            </label>
            <input
              id="{uid}-export"
              type="file"
              accept=".zip,application/zip"
              class="focus-ring min-h-11 rounded-md border border-edge bg-surface px-3 py-2 text-sm"
              onchange={(event) => {
                const input = event.currentTarget;
                void readAndPlan(input.files?.[0]).then(() => {
                  input.value = '';
                });
              }}
            />
          </div>

          {#if status === 'reading'}
            <Spinner label="Reading the export" />
          {:else if status === 'planning'}
            <Spinner label="Working out what this import will do" />
          {/if}
        </section>
      {/if}

      {#if plan && !summary}
        <section class="flex flex-col gap-3 rounded-md border border-edge bg-surface p-4">
          <h2 class="text-lg font-semibold">3. What this import will do</h2>
          <p class="text-sm">
            {plan.added} new · {plan.updated} updated · {plan.removed.length} removed
          </p>

          {#if plan.removed.length > 0}
            <div class="flex flex-col gap-1 text-sm text-danger">
              <p>
                {plan.removed.length}
                {plan.removed.length === 1 ? 'card' : 'cards'} in this deck are not in this export and
                will be moved to Deleted. You can restore any of them from the Deleted screen.
              </p>
              <ul class="list-disc pl-5">
                {#each plan.removed as card (card.file_id)}
                  <li class="truncate">{card.name}</li>
                {/each}
              </ul>
            </div>
          {/if}

          <ul class="flex max-h-96 flex-col gap-1 overflow-y-auto">
            {#each plan.pages as page (page.page_number)}
              <li class="flex flex-wrap items-center gap-2 rounded px-2 py-1 text-sm">
                <span class="w-8 text-muted">{page.page_number}</span>
                <span class="min-w-0 flex-1 truncate">{pageLabel(page)}</span>
                {#if page.action === 'add'}
                  <span class="text-xs text-success">New</span>
                {:else if page.name}
                  <span class="min-w-0 truncate text-xs text-muted">Updates {page.name}</span>
                {:else}
                  <span class="text-xs text-muted">Updated</span>
                {/if}
                {#if page.matched_by === 'identity'}
                  <span class="text-xs text-muted">matched by title</span>
                {:else if page.matched_by === 'page_number'}
                  <span class="text-xs text-muted">matched by page number</span>
                {/if}
              </li>
            {/each}
          </ul>

          {#if !busy}
            <div class="flex flex-wrap gap-2">
              <Button onclick={() => deckImports.confirm(deckId)}>
                Import {plan.pages.length}
                {plan.pages.length === 1 ? 'page' : 'pages'}
              </Button>
              <Button variant="ghost" onclick={discard}>Cancel and discard this run</Button>
            </div>
          {/if}
        </section>
      {/if}

      {#if busy && !ours}
        <p role="status" class="text-sm text-muted">
          An import is running on another deck. It finishes on its own.
        </p>
      {:else if busy}
        <section class="flex flex-col gap-3 rounded-md border border-edge bg-surface p-4">
          <p role="status" aria-live="polite" class="text-sm">
            {status === 'finishing'
              ? 'Finishing the import'
              : `Uploading page ${Math.min(deckImports.posted + 1, total)} of ${total}`}
          </p>
          <div class="h-2 w-full rounded-full bg-accent-soft">
            <div
              class="h-2 rounded-full bg-accent"
              style="width: {total === 0 ? 0 : Math.round((deckImports.posted / total) * 100)}%"
            ></div>
          </div>
          {#if status === 'importing'}
            <div>
              <Button variant="danger" onclick={() => deckImports.cancel()}>
                Stop and discard this run
              </Button>
            </div>
          {/if}
        </section>
      {/if}

      {#if summary}
        <section class="flex flex-col gap-3 rounded-md border border-edge bg-surface p-4">
          <h2 class="text-lg font-semibold">Imported</h2>
          <p class="text-sm">
            {summary.run.counts.pages} pages · {summary.run.counts.added} added ·
            {summary.run.counts.updated} updated · {summary.run.counts.unchanged} unchanged ·
            {summary.run.counts.removed} removed · {summary.run.counts.restored} restored
          </p>
          <ul class="flex max-h-96 flex-col gap-1 overflow-y-auto">
            {#each summary.cards as card (card.name)}
              <li class="flex flex-wrap items-center gap-2 rounded px-2 py-1 text-sm">
                <span class="w-8 text-muted">{card.page_number ?? ''}</span>
                <span class="min-w-0 flex-1 truncate">{card.name}</span>
                <span class="text-xs {card.page_number === null ? 'text-danger' : 'text-muted'}">
                  {card.outcome}
                </span>
              </li>
            {/each}
          </ul>
          <div>
            <a
              class="focus-ring inline-flex min-h-11 items-center rounded-md px-4 text-sm underline"
              href="/projects/{projectId}/decks/{deckId}"
            >
              Back to the deck
            </a>
          </div>
        </section>
      {/if}
    {/if}
  {/if}
</div>
