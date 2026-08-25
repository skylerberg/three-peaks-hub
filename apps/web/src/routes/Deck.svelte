<script lang="ts">
  import {
    CARD_PRESETS,
    DECK_QUANTITY_LIMITS,
    MODEL_LIMITS,
    PRINT_DPI,
    cardPreset,
    deckCardSize,
    effectiveDpi,
    matchingCardPreset,
  } from '@three-peaks/shared';
  import type { components } from '@three-peaks/shared/api';
  import FilePicker from '../components/decks/FilePicker.svelte';
  import Thumbnail from '../components/Thumbnail.svelte';
  import Button from '../components/ui/Button.svelte';
  import Input from '../components/ui/Input.svelte';
  import Spinner from '../components/ui/Spinner.svelte';
  import { ApiError, api, assertOk } from '../api/client.ts';
  import { deckImports } from '../lib/deckImports.svelte.ts';
  import { type DeckCard, decks } from '../lib/decks.svelte.ts';
  import { realtime } from '../lib/realtime.svelte.ts';
  import { link } from '../lib/router.svelte.ts';
  import { apiMessage } from '../lib/session.svelte.ts';
  import { toasts } from '../lib/toasts.svelte.ts';

  interface Props {
    projectId: string;
    deckId: string;
  }
  let { projectId, deckId }: Props = $props();

  type File = components['schemas']['File'];

  let error = $state<string | null>(null);
  let canEdit = $state(false);
  let picking = $state<'cards' | 'back' | null>(null);
  let name = $state('');
  let backFile = $state<File | null>(null);

  const deck = $derived(decks.deck);
  const cards = $derived(decks.cards);
  const [minQuantity, maxQuantity] = DECK_QUANTITY_LIMITS;
  const limits = MODEL_LIMITS.card;
  const uid = $props.id();

  const presetId = $derived(deck ? (matchingCardPreset(deckCardSize(deck))?.id ?? '') : '');
  const totalCopies = $derived(cards.reduce((sum, card) => sum + card.quantity, 0));
  const importStatus = $derived.by(() => {
    if (deckImports.binding?.open_run_id) return 'An import is open.';
    if (deckImports.folderName) return `Artwork lands in ${deckImports.folderName}.`;
    if (deckImports.binding?.folder_id) return 'The folder this deck imported into is gone.';
    return 'Not set up yet.';
  });

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

  // The name input is a draft the visitor is typing into, so it is seeded from
  // the deck rather than bound to it -- binding would rewrite what they are
  // halfway through whenever a realtime event reloaded the row.
  $effect(() => {
    const loaded = decks.deck;
    if (loaded && loaded.id === deckId) name = loaded.name;
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

  // Value-compared, for the reason Thumbnail.svelte spells out at its own: the
  // save replaces decks.deck, so reading the field straight re-read the same
  // row on every copy count edit.
  const backFileId = $derived(decks.deck?.back_file_id ?? null);

  // The back is named by id only, so its row has to be read to draw it.
  $effect(() => {
    const id = backFileId;
    if (!id) {
      backFile = null;
      return;
    }
    let stale = false;
    api
      .GET('/api/files/{id}', { params: { path: { id } } })
      .then((result) => {
        if (!stale) backFile = assertOk(result);
      })
      .catch(() => {
        if (!stale) backFile = null;
      });
    return () => {
      stale = true;
    };
  });

  $effect(() => {
    const id = projectId;
    realtime.subscribe(id);
    // Nothing here reads anything back: every event carries what it changed.
    // That is also why there is no coalescing left -- an import publishing one
    // event per page costs this screen no requests at all.
    const off = realtime.on((event) => {
      if (event.project_id !== id) return;
      switch (event.type) {
        case 'deck_updated':
          // Another deck in this project moving says nothing about this one.
          if (event.data.deck.id !== deckId) return;
          decks.applyDeckUpdate(event.data.deck, event.data.cards);
          return;
        case 'deck_deleted':
          if (event.data.id !== deckId) return;
          error = 'That deck has been deleted.';
          return;
        // A card embeds its file row, so these reach the cards on screen even
        // though none of them is about the deck.
        case 'file_updated':
        case 'file_deleted':
          decks.applyCardFile(event.data);
          return;
        case 'file_version_created':
          decks.applyCardFile(event.data.file);
          return;
        case 'deck_import_binding_changed':
          if (event.data.deck_id !== deckId) return;
          deckImports.applyBinding(deckId, event.data.binding, event.data.folder_name);
          return;
        case 'deck_import_started':
          if (event.data.deck_id !== deckId) return;
          deckImports.applyOpenRun(deckId, event.data.run.id);
          return;
        case 'deck_import_finished':
          if (event.data.deck_id !== deckId) return;
          deckImports.applyOpenRun(deckId, null);
          return;
        default:
          return;
      }
    });
    return () => {
      off();
      realtime.unsubscribe(id);
    };
  });

  $effect(() => {
    const project = projectId;
    const id = deckId;
    void deckImports.loadBinding(project, id).catch(() => {});
  });

  function asInput(list: readonly DeckCard[]) {
    return list.map((card) => ({ file_id: card.file_id, quantity: card.quantity }));
  }

  async function saveCards(next: readonly DeckCard[]) {
    try {
      await decks.saveCards(deckId, asInput(next));
    } catch (caught) {
      toasts.error(apiMessage(caught));
      // Refetch rather than roll back to a snapshot: the server's answer is the
      // one that is true, and a snapshot can be older than another editor's save.
      await decks.refreshDeck().catch(() => {});
    }
  }

  async function patch(fields: Parameters<typeof decks.update>[1]) {
    try {
      await decks.update(deckId, fields);
    } catch (caught) {
      toasts.error(apiMessage(caught));
      await decks.refreshDeck().catch(() => {});
    }
  }

  function addCards(files: File[]) {
    picking = null;
    const existing = new Set(cards.map((card) => card.file_id));
    const additions = files
      .filter((file) => !existing.has(file.id))
      .map((file) => ({ file_id: file.id, quantity: 1 }) as DeckCard);
    if (additions.length === 0) return;
    void saveCards([...cards, ...additions]);
  }

  function chooseBack(files: File[]) {
    picking = null;
    const [file] = files;
    if (file) void patch({ back_file_id: file.id });
  }

  function setQuantity(fileId: string, quantity: number) {
    const clamped = Math.max(minQuantity, Math.min(maxQuantity, Math.round(quantity)));
    void saveCards(
      cards.map((card) => (card.file_id === fileId ? { ...card, quantity: clamped } : card))
    );
  }

  function move(index: number, by: number) {
    const next = [...cards];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    void saveCards(next);
  }

  function applyPreset(id: string) {
    const preset = cardPreset(id);
    if (preset) void patch({ card_width_mm: preset.width_mm, card_height_mm: preset.height_mm });
  }

  // The file rows already carry their pixel dimensions, so this costs nothing to
  // say and is the difference between a proof that looks right on screen and one
  // that prints soft.
  function resolution(card: DeckCard): number | null {
    if (!deck || card.file.image_width === null || card.file.image_height === null) return null;
    return Math.min(
      effectiveDpi(card.file.image_width, deck.card_width_mm),
      effectiveDpi(card.file.image_height, deck.card_height_mm)
    );
  }
</script>

<div class="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8" use:link>
  {#if error}
    <p role="alert" class="rounded-md border border-danger p-4 text-sm text-danger">{error}</p>
    <a class="focus-ring rounded underline" href="/projects/{projectId}/decks">Back to decks</a>
  {:else if !deck}
    <Spinner label="Loading deck" />
  {:else}
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="min-w-0">
        <a class="focus-ring rounded text-sm underline" href="/projects/{projectId}/decks">Decks</a>
        <h1 class="truncate text-2xl font-semibold">{deck.name}</h1>
        <p class="text-sm text-muted">
          {cards.length}
          {cards.length === 1 ? 'card' : 'cards'} · {totalCopies} to print
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <a
          class="focus-ring rounded px-3 py-2 text-sm underline"
          href="/projects/{projectId}/decks/{deck.id}/history"
        >
          Import history
        </a>
        <a
          class="focus-ring rounded px-3 py-2 text-sm underline"
          href="/projects/{projectId}/print?deck={deck.id}"
        >
          Print this deck
        </a>
      </div>
    </div>

    <section class="flex flex-col gap-4 rounded-md border border-edge bg-surface p-4">
      <h2 class="text-lg font-semibold">Settings</h2>

      <div class="flex flex-wrap items-end gap-4">
        <div class="min-w-56 flex-1">
          <Input
            label="Name"
            bind:value={name}
            maxlength={120}
            disabled={!canEdit}
            onblur={() => {
              if (name.trim() && name.trim() !== deck.name) void patch({ name: name.trim() });
            }}
          />
        </div>

        <div class="flex min-w-56 flex-1 flex-col gap-1">
          <label class="text-sm font-medium text-ink" for="{uid}-size">Card size</label>
          <select
            id="{uid}-size"
            class="focus-ring min-h-11 rounded-md border border-edge bg-surface px-2 text-sm"
            value={presetId}
            disabled={!canEdit}
            onchange={(event) => applyPreset(event.currentTarget.value)}
          >
            <option value="">Custom</option>
            {#each CARD_PRESETS as preset (preset.id)}
              <option value={preset.id}>{preset.name}</option>
            {/each}
          </select>
        </div>
      </div>

      <div class="flex flex-wrap gap-4">
        <div class="w-32">
          <Input
            label="Width"
            type="number"
            value={String(deck.card_width_mm)}
            min={limits.width_mm[0]}
            max={limits.width_mm[1]}
            step={0.5}
            disabled={!canEdit}
            onchange={(event) => {
              const value = Number(event.currentTarget.value);
              if (Number.isFinite(value)) void patch({ card_width_mm: value });
            }}
          />
        </div>
        <div class="w-32">
          <Input
            label="Height"
            type="number"
            value={String(deck.card_height_mm)}
            min={limits.height_mm[0]}
            max={limits.height_mm[1]}
            step={0.5}
            disabled={!canEdit}
            onchange={(event) => {
              const value = Number(event.currentTarget.value);
              if (Number.isFinite(value)) void patch({ card_height_mm: value });
            }}
          />
        </div>
      </div>

      <div class="flex flex-col gap-2">
        <h3 class="text-sm font-medium">Card back</h3>
        {#if backFile}
          <div class="flex items-center gap-3">
            <Thumbnail fileId={backFile.id} alt="" />
            <span class="min-w-0 flex-1 truncate text-sm">{backFile.filename}</span>
            {#if canEdit}
              <Button variant="secondary" onclick={() => (picking = 'back')}>Change</Button>
              <Button variant="ghost" onclick={() => patch({ back_file_id: null })}>Remove</Button>
            {/if}
          </div>
        {:else}
          <p class="text-sm text-muted">
            No back chosen. Sheets for this deck will print fronts only.
          </p>
          {#if canEdit}
            <div>
              <Button variant="secondary" onclick={() => (picking = 'back')}>Choose a back</Button>
            </div>
          {/if}
        {/if}
      </div>

      {#if picking === 'back'}
        <FilePicker {projectId} onpick={chooseBack} oncancel={() => (picking = null)} />
      {/if}
    </section>

    {#if canEdit}
      <section class="flex flex-col gap-3 rounded-md border border-edge bg-surface p-4">
        <h2 class="text-lg font-semibold">Import from Canva</h2>
        <p class="text-sm text-muted">{importStatus}</p>
        <div>
          <a
            class="focus-ring inline-flex min-h-11 items-center rounded-md border border-edge px-4
                   text-sm font-medium hover:bg-accent-soft"
            href="/projects/{projectId}/decks/{deckId}/import"
          >
            Import from Canva
          </a>
        </div>
      </section>
    {/if}

    <section class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-lg font-semibold">Cards</h2>
        {#if canEdit}
          <Button onclick={() => (picking = picking === 'cards' ? null : 'cards')}>Add cards</Button
          >
        {/if}
      </div>

      {#if picking === 'cards'}
        <FilePicker
          {projectId}
          multiple
          taken={cards.map((card) => card.file_id)}
          onpick={addCards}
          oncancel={() => (picking = null)}
        />
      {/if}

      {#if decks.loadingDeck && cards.length === 0}
        <Spinner label="Loading cards" />
      {:else if cards.length === 0}
        <p class="text-sm text-muted">
          No cards yet. {canEdit
            ? 'Add images and set how many copies of each the deck holds.'
            : ''}
        </p>
      {:else}
        <ul class="flex flex-col gap-2">
          {#each cards as card, index (card.file_id)}
            {@const dpi = resolution(card)}
            <li
              class="flex flex-wrap items-center gap-3 rounded-md border border-edge bg-surface p-2"
            >
              <Thumbnail fileId={card.file_id} alt="" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm {card.file.deleted_at ? 'line-through text-muted' : ''}">
                  {card.file.filename}
                </p>
                {#if card.file.deleted_at}
                  <p class="text-xs text-danger">Deleted. Restore it to print this card.</p>
                {:else if dpi !== null && dpi < PRINT_DPI}
                  <p class="text-xs text-warning">
                    {Math.round(dpi)} DPI at this size — under the {PRINT_DPI} DPI a printer wants.
                  </p>
                {/if}
              </div>

              <label class="flex items-center gap-2 text-sm">
                <span class="text-muted">Copies</span>
                <input
                  type="number"
                  class="focus-ring min-h-11 w-20 rounded-md border border-edge bg-surface px-2 text-sm"
                  value={card.quantity}
                  min={minQuantity}
                  max={maxQuantity}
                  step="1"
                  disabled={!canEdit}
                  onchange={(event) => setQuantity(card.file_id, Number(event.currentTarget.value))}
                />
              </label>

              {#if canEdit}
                <div class="flex gap-1">
                  <Button
                    variant="ghost"
                    aria-label="Move {card.file.filename} earlier"
                    disabled={index === 0}
                    onclick={() => move(index, -1)}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label="Move {card.file.filename} later"
                    disabled={index === cards.length - 1}
                    onclick={() => move(index, 1)}
                  >
                    ↓
                  </Button>
                  <Button
                    variant="ghost"
                    onclick={() =>
                      saveCards(cards.filter((entry) => entry.file_id !== card.file_id))}
                  >
                    Remove
                  </Button>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</div>
