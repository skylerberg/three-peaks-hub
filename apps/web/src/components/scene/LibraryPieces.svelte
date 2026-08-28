<script lang="ts">
  import {
    LIBRARY_PIECES,
    LIBRARY_PIECE_LABELS,
    SCENE_LIMITS,
    type LibraryPiece,
  } from '@three-peaks/shared';
  import Button from '../ui/Button.svelte';

  interface Props {
    rows: readonly {
      key: string;
      piece: LibraryPiece;
      color: string;
      size_mm: number;
      count: number;
    }[];
    onadd: (piece: LibraryPiece) => void;
    onremove: (key: string) => void;
    onchange: (key: string, patch: { color?: string; size_mm?: number; count?: number }) => void;
  }

  let { rows, onadd, onremove, onchange }: Props = $props();

  let adding = $state<LibraryPiece>(LIBRARY_PIECES[0]);

  const uid = $props.id();

  function clamped(value: string, [min, max]: readonly [number, number]): number | null {
    const next = Number(value);
    if (!Number.isFinite(next)) return null;
    return Math.min(max, Math.max(min, next));
  }
</script>

<div class="flex flex-col gap-3">
  <p class="text-sm text-muted">
    Built by the importer from a name and a size, so these cost the bundle no bytes at all.
  </p>

  {#if rows.length > 0}
    <ul class="flex flex-col gap-2">
      {#each rows as row (row.key)}
        {@const name = LIBRARY_PIECE_LABELS[row.piece]}
        <li class="flex flex-wrap items-center gap-3 rounded-md border border-edge p-2">
          <span class="min-w-24 flex-1 text-sm font-medium">{name}</span>

          <input
            type="color"
            class="focus-ring h-11 w-14 rounded-md border border-edge bg-surface p-1"
            aria-label="{name} colour"
            value={row.color}
            oninput={(event) => onchange(row.key, { color: event.currentTarget.value })}
          />

          <label class="flex items-center gap-2 text-sm text-muted">
            Size
            <input
              type="number"
              class="focus-ring min-h-11 w-20 rounded-md border border-edge bg-surface px-2
                     text-sm text-ink"
              aria-label="{name} size in millimetres"
              value={row.size_mm}
              min={SCENE_LIMITS.library_size_mm[0]}
              max={SCENE_LIMITS.library_size_mm[1]}
              step="0.5"
              onchange={(event) => {
                const next = clamped(event.currentTarget.value, SCENE_LIMITS.library_size_mm);
                if (next !== null) onchange(row.key, { size_mm: next });
              }}
            />
            mm
          </label>

          <label class="flex items-center gap-2 text-sm text-muted">
            How many
            <input
              type="number"
              class="focus-ring min-h-11 w-20 rounded-md border border-edge bg-surface px-2
                     text-sm text-ink"
              aria-label="How many {name}"
              value={row.count}
              min="1"
              max={SCENE_LIMITS.instances[1]}
              step="1"
              onchange={(event) => {
                const next = clamped(event.currentTarget.value, [1, SCENE_LIMITS.instances[1]]);
                if (next !== null) onchange(row.key, { count: Math.round(next) });
              }}
            />
          </label>

          <Button variant="ghost" aria-label="Remove {name}" onclick={() => onremove(row.key)}>
            Remove
          </Button>
        </li>
      {/each}
    </ul>
  {/if}

  <div class="flex flex-wrap items-end gap-2">
    <div class="flex flex-col gap-1">
      <label class="text-sm font-medium" for="{uid}-piece">Piece</label>
      <select
        id="{uid}-piece"
        class="focus-ring min-h-11 rounded-md border border-edge bg-surface px-2 text-sm text-ink"
        bind:value={adding}
      >
        {#each LIBRARY_PIECES as piece (piece)}
          <option value={piece}>{LIBRARY_PIECE_LABELS[piece]}</option>
        {/each}
      </select>
    </div>
    <Button variant="secondary" onclick={() => onadd(adding)}>Add piece</Button>
  </div>
</div>
