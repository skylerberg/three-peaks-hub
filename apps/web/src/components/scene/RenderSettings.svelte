<script lang="ts">
  import { RENDER_ENGINES, RENDER_LIMITS, type RenderEngine } from '@three-peaks/shared';
  import NumberField from '../model3d/NumberField.svelte';

  interface Props {
    engine: RenderEngine;
    fps: number;
    samples: number;
    onchange: (patch: { engine?: RenderEngine; fps?: number; samples?: number }) => void;
  }

  let { engine, fps, samples, onchange }: Props = $props();

  const uid = $props.id();

  const ENGINE_LABELS: Record<RenderEngine, string> = {
    CYCLES: 'Cycles — slower, and what a trailer frame wants',
    EEVEE: 'EEVEE — fast enough to scrub',
  };
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-col gap-1">
    <label class="text-sm font-medium" for="{uid}-engine">Renderer</label>
    <select
      id="{uid}-engine"
      class="focus-ring min-h-11 rounded-md border border-edge bg-surface px-2 text-sm text-ink"
      value={engine}
      onchange={(event) => onchange({ engine: event.currentTarget.value as RenderEngine })}
    >
      {#each RENDER_ENGINES as choice (choice)}
        <option value={choice}>{ENGINE_LABELS[choice]}</option>
      {/each}
    </select>
  </div>

  <div class="grid gap-3 sm:grid-cols-2">
    <NumberField
      label="Frame rate"
      value={fps}
      min={RENDER_LIMITS.fps[0]}
      max={RENDER_LIMITS.fps[1]}
      step={1}
      suffix=" fps"
      onchange={(value) => onchange({ fps: Math.round(value) })}
    />
    <NumberField
      label="Samples"
      value={samples}
      min={RENDER_LIMITS.samples[0]}
      max={RENDER_LIMITS.samples[1]}
      step={1}
      onchange={(value) => onchange({ samples: Math.round(value) })}
    />
  </div>

  <p class="max-w-2xl text-xs text-muted">
    The frame rate is the one of these that has to be right now: every keyframe is written at a
    frame, so changing it afterwards moves the whole timing.
  </p>
</div>
