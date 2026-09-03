<script lang="ts">
  import {
    DEFAULT_PAGE_SIZE_ID,
    DEFAULT_PRINTER_MARGIN_MM,
    PAGE_SIZES,
    PRINTER_MARGIN_LIMITS,
    type FlipEdge,
    deckCardSize,
    matchingCardPreset,
    pageSize,
    planGrid,
    planRuns,
    summarizeRuns,
  } from '@three-peaks/shared';
  import Button from '../components/ui/Button.svelte';
  import Spinner from '../components/ui/Spinner.svelte';
  import { ApiError } from '../api/client.ts';
  import { type Deck, type DeckCard, decks } from '../lib/decks.svelte.ts';
  import { saveBlob } from '../lib/download.ts';
  import { link } from '../lib/router.svelte.ts';
  import { apiMessage } from '../lib/session.svelte.ts';
  import { toasts } from '../lib/toasts.svelte.ts';

  interface Props {
    projectId: string;
    deckId: string | null;
  }
  let { projectId, deckId }: Props = $props();

  interface LoadedDeck {
    deck: Deck;
    cards: DeckCard[];
  }

  let error = $state<string | null>(null);
  let loading = $state(true);
  let loaded = $state<LoadedDeck[]>([]);
  let selected = $state<Record<string, boolean>>({});
  let expanded = $state<Record<string, boolean>>({});
  // A card left out of this run without changing what the deck holds. The deck's
  // own counts are the persistent truth; this is one print job's opinion.
  let excluded = $state<Record<string, boolean>>({});

  let pageId = $state(DEFAULT_PAGE_SIZE_ID);
  let printerMargin = $state(DEFAULT_PRINTER_MARGIN_MM);
  let includeBacks = $state(true);
  let flip = $state<FlipEdge>('long');
  let cutMarks = $state(true);
  let fit = $state<'fill' | 'fit'>('fill');
  let oneOfEach = $state(false);
  let generating = $state(false);
  let progress = $state<{ drawn: number; total: number } | null>(null);

  const uid = $props.id();
  const page = $derived(pageSize(pageId) ?? PAGE_SIZES[0]);

  const key = (deck: string, file: string) => `${deck}:${file}`;

  // What one card puts on paper, read by the plan and by the count beside its
  // name so the two cannot disagree. One of each collapses the counts to a
  // single proof copy of every card in the run -- and a card the deck holds
  // none of is not in the run, whichever way it is printed.
  function printedCopies(card: DeckCard): number {
    if (card.quantity === 0) return 0;
    return oneOfEach ? 1 : card.quantity;
  }

  // Only what is both selected and printable. A card whose image is in the bin
  // has no bytes to place, so it is dropped here rather than failing mid-render.
  const runDecks = $derived(
    loaded
      .filter((entry) => selected[entry.deck.id])
      .map((entry) => ({
        name: entry.deck.name,
        card: deckCardSize(entry.deck),
        back_file_id: entry.deck.back_file_id,
        cards: entry.cards
          .filter((card) => !card.file.deleted_at && !excluded[key(entry.deck.id, card.file_id)])
          .map((card) => ({
            file_id: card.file_id,
            copies: printedCopies(card),
          })),
      }))
      .filter((entry) => entry.cards.length > 0)
  );

  const options = $derived({
    page,
    printer_margin_mm: printerMargin,
    include_backs: includeBacks,
    flip,
    cut_marks: cutMarks,
    fit,
  });

  // Recomputed from the same planner the renderer walks, so the sheet count on
  // screen is the page count of the file the button produces.
  const summary = $derived(summarizeRuns(planRuns(runDecks), page, printerMargin, includeBacks));

  const anyBacks = $derived(runDecks.some((entry) => entry.back_file_id !== null));

  $effect(() => {
    const project = projectId;
    const preselect = deckId;
    loading = true;
    error = null;

    void (async () => {
      try {
        await decks.loadList(project);
        const list = decks.decks;
        const full = await Promise.all(list.map((deck) => decks.readDeck(deck.id)));
        loaded = full;
        selected = Object.fromEntries(
          full.map((entry) => [entry.deck.id, preselect === null || preselect === entry.deck.id])
        );
      } catch (caught) {
        error =
          caught instanceof ApiError && caught.status === 404
            ? 'That project does not exist, or you do not have access to it.'
            : apiMessage(caught);
      } finally {
        loading = false;
      }
    })();
  });

  function cardsPerSheet(deck: Deck): number {
    return planGrid(page, deckCardSize(deck), printerMargin).per_sheet;
  }

  function sizeLabel(deck: Deck): string {
    const preset = matchingCardPreset(deckCardSize(deck));
    return preset ? preset.name : `${deck.card_width_mm} × ${deck.card_height_mm} mm`;
  }

  async function generate() {
    generating = true;
    progress = null;
    try {
      // Imported here and nowhere else, so jsPDF and the layout code sit in a
      // chunk only this screen pays for.
      const { generatePrintPdf } = await import('../lib/print/index.ts');
      const blob = await generatePrintPdf({ decks: runDecks, options }, (update) => {
        progress = update;
      });

      saveBlob(blob, 'print-sheets.pdf');
    } catch (caught) {
      toasts.error(caught instanceof Error ? caught.message : 'The sheets could not be built.');
    } finally {
      generating = false;
      progress = null;
    }
  }
</script>

<div class="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8" use:link>
  {#if error}
    <p role="alert" class="rounded-md border border-danger p-4 text-sm text-danger">{error}</p>
    <a class="focus-ring rounded underline" href="/projects/{projectId}/decks">Back to decks</a>
  {:else}
    <div>
      <a class="focus-ring rounded text-sm underline" href="/projects/{projectId}/decks">Decks</a>
      <h1 class="text-2xl font-semibold">Print sheets</h1>
      <p class="text-sm text-muted">
        Cards packed onto {page.name} at their real size, with a mirrored backing page behind every sheet.
        Print double-sided at 100% scale — never “fit to page”.
      </p>
    </div>

    {#if loading}
      <Spinner label="Loading decks" />
    {:else if loaded.length === 0}
      <p class="text-sm text-muted">
        This project has no decks yet.
        <a class="focus-ring rounded underline" href="/projects/{projectId}/decks">Make one</a>.
      </p>
    {:else}
      <section class="flex flex-col gap-2">
        <h2 class="text-lg font-semibold">What to print</h2>
        <ul class="flex flex-col gap-2">
          {#each loaded as entry (entry.deck.id)}
            {@const perSheet = cardsPerSheet(entry.deck)}
            <li class="rounded-md border border-edge bg-surface p-3">
              <div class="flex flex-wrap items-center gap-3">
                <label class="flex min-h-11 min-w-0 flex-1 items-center gap-3">
                  <input
                    type="checkbox"
                    class="focus-ring size-4"
                    bind:checked={selected[entry.deck.id]}
                  />
                  <span class="min-w-0 flex-1 truncate font-medium">{entry.deck.name}</span>
                </label>
                <span class="text-sm text-muted">{sizeLabel(entry.deck)}</span>
                <span class="text-sm text-muted">
                  {perSheet > 0 ? `${perSheet} per sheet` : 'too large for this paper'}
                </span>
                {#if entry.deck.back_file_id === null}
                  <span class="text-sm text-warning">no back</span>
                {/if}
                <Button
                  variant="ghost"
                  aria-expanded={expanded[entry.deck.id] === true}
                  onclick={() => (expanded[entry.deck.id] = !expanded[entry.deck.id])}
                >
                  {expanded[entry.deck.id] ? 'Hide cards' : 'Choose cards'}
                </Button>
              </div>

              {#if expanded[entry.deck.id]}
                <ul
                  class="mt-2 flex max-h-72 flex-col gap-1 overflow-y-auto border-t border-edge pt-2"
                >
                  {#each entry.cards as card (card.file_id)}
                    <li>
                      <label
                        class="flex min-h-11 items-center gap-3 rounded px-2 text-sm hover:bg-accent-soft"
                      >
                        <input
                          type="checkbox"
                          class="focus-ring size-4"
                          disabled={card.file.deleted_at !== null}
                          checked={!excluded[key(entry.deck.id, card.file_id)] &&
                            card.file.deleted_at === null}
                          onchange={(event) => {
                            excluded[key(entry.deck.id, card.file_id)] =
                              !event.currentTarget.checked;
                          }}
                        />
                        <span
                          class="min-w-0 flex-1 truncate {card.file.deleted_at
                            ? 'text-muted line-through'
                            : ''}"
                        >
                          {card.file.filename}
                        </span>
                        <span class="text-muted">
                          {card.file.deleted_at ? 'deleted' : `×${printedCopies(card)}`}
                        </span>
                      </label>
                    </li>
                  {:else}
                    <li class="px-2 text-sm text-muted">This deck has no cards.</li>
                  {/each}
                </ul>
              {/if}
            </li>
          {/each}
        </ul>
      </section>

      <section class="flex flex-col gap-4 rounded-md border border-edge bg-surface p-4">
        <h2 class="text-lg font-semibold">Options</h2>

        <div class="flex flex-wrap gap-6">
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" class="focus-ring size-4" bind:checked={includeBacks} />
            Include backing pages
          </label>
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" class="focus-ring size-4" bind:checked={cutMarks} />
            Cut marks
          </label>
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" class="focus-ring size-4" bind:checked={oneOfEach} />
            One of each, ignoring copy counts
          </label>
        </div>

        <div class="flex flex-wrap gap-6">
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium" for="{uid}-flip">Duplex flip</label>
            <select
              id="{uid}-flip"
              class="focus-ring min-h-11 rounded-md border border-edge bg-surface px-2 text-sm"
              bind:value={flip}
              disabled={!includeBacks}
            >
              <option value="long">Long edge (the usual default)</option>
              <option value="short">Short edge</option>
            </select>
            <p class="max-w-80 text-xs text-muted">
              Match your printer’s two-sided setting. Getting this wrong puts every back on the
              wrong card.
            </p>
          </div>

          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium" for="{uid}-fit">Artwork</label>
            <select
              id="{uid}-fit"
              class="focus-ring min-h-11 rounded-md border border-edge bg-surface px-2 text-sm"
              bind:value={fit}
            >
              <option value="fill">Fill the card, cropping the overflow</option>
              <option value="fit">Fit inside the card, whole</option>
            </select>
          </div>

          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium" for="{uid}-margin">Printer margin</label>
            <input
              id="{uid}-margin"
              type="number"
              class="focus-ring min-h-11 w-28 rounded-md border border-edge bg-surface px-2 text-sm"
              bind:value={printerMargin}
              min={PRINTER_MARGIN_LIMITS[0]}
              max={PRINTER_MARGIN_LIMITS[1]}
              step="0.05"
            />
            <p class="max-w-80 text-xs text-muted">
              Millimetres your printer will not print inside. Lower it for more cards a sheet, at
              the risk of clipping the outer row.
            </p>
          </div>
        </div>
      </section>

      <section class="flex flex-col gap-3 rounded-md border border-edge bg-surface p-4">
        <p class="text-sm" role="status">
          {summary.cards}
          {summary.cards === 1 ? 'card' : 'cards'} on {summary.sheets}
          {summary.sheets === 1 ? 'sheet' : 'sheets'} of {page.name}{summary.sizes > 1
            ? `, across ${summary.sizes} card sizes`
            : ''}.
        </p>

        {#if summary.oversized}
          <p class="text-sm text-danger" role="alert">
            One of the selected decks has a card larger than the printable area. Lower the printer
            margin or choose a smaller size.
          </p>
        {/if}
        {#if includeBacks && !anyBacks && summary.cards > 0}
          <p class="text-sm text-warning">
            None of the selected decks has a card back, so the backing pages would be blank.
          </p>
        {/if}

        {#if generating}
          <p class="text-sm text-muted" role="status">
            Building the sheets{progress ? ` — ${progress.drawn} of ${progress.total} cards` : ''}…
          </p>
        {/if}

        <div>
          <Button disabled={generating || summary.cards === 0} onclick={generate}>
            {generating ? 'Building…' : 'Generate PDF'}
          </Button>
        </div>
      </section>
    {/if}
  {/if}
</div>
