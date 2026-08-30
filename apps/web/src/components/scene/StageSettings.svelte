<script lang="ts">
  import {
    DEFAULT_SURFACE_COLORS,
    SCENE_BACKGROUNDS,
    SURFACE_FINISHES,
    SURFACE_FINISH_LABELS,
    SURFACE_LIMITS,
    type SceneBackground,
    type SurfaceChoice,
    type SurfaceFinish,
  } from '@three-peaks/shared';

  interface Props {
    // Null is a scene standing on nothing.
    surface: SurfaceChoice | null;
    background: SceneBackground;
    backgroundColor: string;
    onsurface: (surface: SurfaceChoice | null) => void;
    onbackdrop: (patch: { background?: SceneBackground; backgroundColor?: string }) => void;
  }

  let { surface, background, backgroundColor, onsurface, onbackdrop }: Props = $props();

  const uid = $props.id();

  const NO_TABLE = 'none';

  const BACKGROUND_LABELS: Record<SceneBackground, string> = {
    transparent: 'Transparent — for compositing over footage',
    solid: 'Solid colour',
    gradient: 'Gradient',
  };

  // Changing the finish brings its own colour with it, unless the person has
  // already moved off the one the last finish came with: a felt table someone
  // dyed burgundy stays burgundy when they try it in slate.
  function pickFinish(value: string): void {
    if (value === NO_TABLE) {
      onsurface(null);
      return;
    }
    const finish = value as SurfaceFinish;
    const kept = surface && surface.color !== DEFAULT_SURFACE_COLORS[surface.finish];
    onsurface({
      finish,
      color: kept && surface ? surface.color : DEFAULT_SURFACE_COLORS[finish],
      sweep: surface?.sweep ?? true,
      width_mm: surface?.width_mm ?? null,
      depth_mm: surface?.depth_mm ?? null,
    });
  }

  // Empty is what the field means by "size it from the selection", and so is
  // anything outside what the document allows.
  function typedSize(value: string, limits: readonly [number, number]): number | null {
    const next = Number(value);
    if (value.trim() === '' || !Number.isFinite(next)) return null;
    return Math.min(limits[1], Math.max(limits[0], next));
  }
</script>

<div class="flex flex-col gap-4">
  <div class="grid gap-3 sm:grid-cols-2">
    <div class="flex flex-col gap-1">
      <label class="text-sm font-medium" for="{uid}-finish">Table</label>
      <select
        id="{uid}-finish"
        class="focus-ring min-h-11 rounded-md border border-edge bg-surface px-2 text-sm text-ink"
        value={surface?.finish ?? NO_TABLE}
        onchange={(event) => pickFinish(event.currentTarget.value)}
      >
        <option value={NO_TABLE}>No table</option>
        {#each SURFACE_FINISHES as finish (finish)}
          <option value={finish}>{SURFACE_FINISH_LABELS[finish]}</option>
        {/each}
      </select>
    </div>

    {#if surface}
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium" for="{uid}-table-color">Table colour</label>
        <input
          id="{uid}-table-color"
          type="color"
          class="focus-ring h-11 w-20 rounded-md border border-edge bg-surface p-1"
          value={surface.color}
          oninput={(event) => onsurface({ ...surface, color: event.currentTarget.value })}
        />
      </div>
    {/if}
  </div>

  {#if surface}
    <label class="flex min-h-11 items-center gap-3 text-sm">
      <input
        type="checkbox"
        class="focus-ring size-4"
        checked={surface.sweep}
        onchange={(event) => onsurface({ ...surface, sweep: event.currentTarget.checked })}
      />
      <span>Curve the table up into a backdrop behind the scene</span>
    </label>

    <div class="grid gap-3 sm:grid-cols-2">
      <label class="flex flex-col gap-1 text-sm font-medium">
        Table width
        <input
          type="number"
          class="focus-ring min-h-11 rounded-md border border-edge bg-surface px-2 text-sm text-ink"
          placeholder="Auto"
          value={surface.width_mm ?? ''}
          min={SURFACE_LIMITS.width_mm[0]}
          max={SURFACE_LIMITS.width_mm[1]}
          step="10"
          onchange={(event) =>
            onsurface({
              ...surface,
              width_mm: typedSize(event.currentTarget.value, SURFACE_LIMITS.width_mm),
            })}
        />
      </label>
      <label class="flex flex-col gap-1 text-sm font-medium">
        Table depth
        <input
          type="number"
          class="focus-ring min-h-11 rounded-md border border-edge bg-surface px-2 text-sm text-ink"
          placeholder="Auto"
          value={surface.depth_mm ?? ''}
          min={SURFACE_LIMITS.depth_mm[0]}
          max={SURFACE_LIMITS.depth_mm[1]}
          step="10"
          onchange={(event) =>
            onsurface({
              ...surface,
              depth_mm: typedSize(event.currentTarget.value, SURFACE_LIMITS.depth_mm),
            })}
        />
      </label>
    </div>
  {/if}

  <div class="grid gap-3 sm:grid-cols-2">
    <div class="flex flex-col gap-1">
      <label class="text-sm font-medium" for="{uid}-background">Behind it</label>
      <select
        id="{uid}-background"
        class="focus-ring min-h-11 rounded-md border border-edge bg-surface px-2 text-sm text-ink"
        value={background}
        onchange={(event) =>
          onbackdrop({ background: event.currentTarget.value as SceneBackground })}
      >
        {#each SCENE_BACKGROUNDS as choice (choice)}
          <option value={choice}>{BACKGROUND_LABELS[choice]}</option>
        {/each}
      </select>
    </div>

    {#if background !== 'transparent'}
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium" for="{uid}-background-color">Backdrop colour</label>
        <input
          id="{uid}-background-color"
          type="color"
          class="focus-ring h-11 w-20 rounded-md border border-edge bg-surface p-1"
          value={backgroundColor}
          oninput={(event) => onbackdrop({ backgroundColor: event.currentTarget.value })}
        />
      </div>
    {/if}
  </div>

  <p class="max-w-2xl text-xs text-muted">
    The table is sized from what you picked and from where the shot puts the camera, in millimetres
    you can read and change in <code>scene.json</code>. A shot that circles the table is given a
    flat one, because the camera would otherwise pass behind the backdrop.
  </p>
</div>
