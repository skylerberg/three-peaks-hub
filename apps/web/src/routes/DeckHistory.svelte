<script lang="ts">
  import Spinner from '../components/ui/Spinner.svelte';
  import { ApiError, api, assertOk } from '../api/client.ts';
  import { deckHistory } from '../lib/deckHistory.svelte.ts';
  import { decks } from '../lib/decks.svelte.ts';
  import { link } from '../lib/router.svelte.ts';
  import { apiMessage } from '../lib/session.svelte.ts';

  interface Props {
    projectId: string;
    deckId: string;
  }
  let { projectId, deckId }: Props = $props();

  let error = $state<string | null>(null);
  let names = $state<Record<string, string>>({});

  const deck = $derived(decks.deck?.id === deckId ? decks.deck : null);
  // Moving between two decks' history screens swaps these props rather than
  // remounting, so nothing is read until the answer for this deck has landed.
  const loaded = $derived(deckHistory.runsDeckId === deckId);
  const runs = $derived(loaded ? deckHistory.runs : []);

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
    const id = deckId;
    void deckHistory.loadRuns(id).catch((caught: unknown) => {
      error = apiMessage(caught);
    });
  });

  $effect(() => {
    const id = projectId;
    api
      .GET('/api/projects/{id}/members', { params: { path: { id } } })
      .then((result) => {
        names = Object.fromEntries(
          assertOk(result).members.map((member) => [member.user_id, member.name])
        );
      })
      .catch(() => {
        // The timeline is the screen. Without the roster it still reads, and
        // the loads above own any message worth showing.
        names = {};
      });
  });

  // The roster is the current members plus the creator, so somebody since
  // removed is genuinely unresolvable and a raw id would say nothing.
  function who(userId: string): string {
    return names[userId] ?? 'Someone no longer on this project';
  }

  function when(timestamp: string): string {
    return new Date(timestamp).toLocaleString();
  }

  // Abandoning undoes nothing: every page that had already landed keeps the
  // version it wrote. Saying otherwise beside the counts that prove it is the
  // one thing this must never do.
  function abandonedNote(pages: number): string {
    if (pages === 0) return 'Abandoned — nothing was changed.';
    return pages === 1
      ? 'Abandoned — 1 page had already landed and was kept.'
      : `Abandoned — ${pages} pages had already landed and were kept.`;
  }
</script>

<div class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8" use:link>
  {#if error}
    <p role="alert" class="rounded-md border border-danger p-4 text-sm text-danger">{error}</p>
    <a class="focus-ring w-fit rounded underline" href="/projects/{projectId}/decks"
      >Back to decks</a
    >
  {:else}
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <div class="min-w-0">
        <h1 class="text-2xl font-semibold">Import history</h1>
        <p class="truncate text-sm text-muted">{deck?.name ?? 'This deck'}</p>
      </div>
      <a
        class="focus-ring rounded px-3 py-2 text-sm underline"
        href="/projects/{projectId}/decks/{deckId}"
      >
        Back to the deck
      </a>
    </div>

    {#if !loaded}
      <Spinner label="Loading import history" />
    {:else if runs.length === 0}
      <p class="rounded-md border border-edge bg-surface p-4 text-sm text-muted">
        This deck has never been imported from Canva.
      </p>
    {:else}
      <ol class="flex flex-col divide-y divide-edge rounded-md border border-edge bg-surface">
        {#each runs as entry (entry.id)}
          <li
            class="flex flex-wrap items-center justify-between gap-3 p-3
                   {entry.status === 'abandoned' ? 'text-muted' : ''}"
          >
            <div class="min-w-0">
              <p class="font-medium">
                <time datetime={entry.started_at}>{when(entry.started_at)}</time>
              </p>
              <p class="text-sm text-muted">
                {who(entry.started_by)} · {entry.source_label ?? 'an export with no name'}
              </p>
              <p class="text-sm">
                <!-- The glyph row reads as noise to a screen reader, so it says
                     the same thing in words alongside. -->
                <span aria-hidden="true">
                  +{entry.counts.added} ~{entry.counts.updated} −{entry.counts.removed}
                </span>
                <span class="sr-only">
                  {entry.counts.added} added, {entry.counts.updated} updated,
                  {entry.counts.removed} removed
                </span>
                {#if entry.status === 'abandoned'}
                  <span class="text-muted">· {abandonedNote(entry.counts.pages)}</span>
                {:else if entry.status === 'open'}
                  <span class="text-muted">· Still running.</span>
                {/if}
              </p>
            </div>
            <div class="flex flex-wrap gap-2 text-sm">
              <a
                class="focus-ring inline-flex min-h-11 items-center rounded px-3 underline"
                href="/projects/{projectId}/decks/{deckId}/runs/{entry.id}"
              >
                What changed
              </a>
              {#if entry.status === 'finished'}
                <a
                  class="focus-ring inline-flex min-h-11 items-center rounded px-3 underline"
                  href="/projects/{projectId}/decks/{deckId}/runs/{entry.id}/deck"
                >
                  The deck as it stood
                </a>
              {/if}
            </div>
          </li>
        {/each}
      </ol>
    {/if}
  {/if}
</div>
