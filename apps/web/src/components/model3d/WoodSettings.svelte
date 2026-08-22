<script lang="ts">
  import {
    MODEL_LIMITS,
    WOOD_PRESETS,
    matchingWoodPreset,
    woodPreset,
    type WoodModelSettings,
  } from '@three-peaks/shared';
  import ColorField from './ColorField.svelte';
  import NumberField from './NumberField.svelte';

  interface Props {
    settings: WoodModelSettings;
    // A vector source is already an outline, so the tracing controls below have
    // nothing to act on and saying so beats leaving them inert.
    vector: boolean;
    disabled: boolean;
    onchange: (patch: Partial<WoodModelSettings>) => void;
  }

  let { settings, vector, disabled, onchange }: Props = $props();

  const limits = MODEL_LIMITS.wood;
  const presetId = $derived(matchingWoodPreset(settings)?.id ?? '');
  // One call per component, so the fields take suffixes off it.
  const uid = $props.id();
  const stockId = `${uid}-stock`;
  const sourceId = `${uid}-source`;
  const printedId = `${uid}-printed`;
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-col gap-1">
    <label class="text-sm" for={stockId}>Stock</label>
    <select
      id={stockId}
      class="focus-ring min-h-11 rounded-md border border-edge bg-surface px-2 text-sm"
      value={presetId}
      {disabled}
      onchange={(event) => {
        const preset = woodPreset(event.currentTarget.value);
        if (preset) onchange({ thickness_mm: preset.thickness_mm });
      }}
    >
      <option value="">Custom</option>
      {#each WOOD_PRESETS as preset (preset.id)}
        <option value={preset.id}>{preset.name}</option>
      {/each}
    </select>
  </div>

  <NumberField
    label="Longest side"
    suffix=" mm"
    value={settings.longest_side_mm}
    min={limits.longest_side_mm[0]}
    max={limits.longest_side_mm[1]}
    step={0.5}
    {disabled}
    onchange={(longest_side_mm) => onchange({ longest_side_mm })}
  />
  <NumberField
    label="Thickness"
    suffix=" mm"
    value={settings.thickness_mm}
    min={limits.thickness_mm[0]}
    max={limits.thickness_mm[1]}
    step={0.1}
    {disabled}
    onchange={(thickness_mm) => onchange({ thickness_mm })}
  />
  <NumberField
    label="Edge bevel"
    suffix=" mm"
    value={settings.bevel_mm}
    min={limits.bevel_mm[0]}
    max={limits.bevel_mm[1]}
    step={0.05}
    {disabled}
    onchange={(bevel_mm) => onchange({ bevel_mm })}
  />

  {#if vector}
    <p class="rounded-md border border-edge bg-canvas p-2 text-xs text-muted">
      The outline comes straight from the SVG paths, so there is nothing to trace.
    </p>
  {:else}
    <div class="flex flex-col gap-1">
      <label class="text-sm" for={sourceId}>Cut the outline from</label>
      <select
        id={sourceId}
        class="focus-ring min-h-11 rounded-md border border-edge bg-surface px-2 text-sm"
        value={settings.trace_source}
        {disabled}
        onchange={(event) =>
          onchange({
            trace_source: event.currentTarget.value as WoodModelSettings['trace_source'],
          })}
      >
        <option value="alpha">Transparency</option>
        <option value="luminance">Light and dark</option>
      </select>
    </div>

    <NumberField
      label="Threshold"
      value={settings.trace_threshold}
      min={limits.trace_threshold[0]}
      max={limits.trace_threshold[1]}
      step={0.01}
      {disabled}
      onchange={(trace_threshold) => onchange({ trace_threshold })}
    />
    <NumberField
      label="Smoothing"
      value={settings.simplify_tolerance}
      min={limits.simplify_tolerance[0]}
      max={limits.simplify_tolerance[1]}
      step={0.1}
      {disabled}
      onchange={(simplify_tolerance) => onchange({ simplify_tolerance })}
    />
  {/if}

  <div class="flex min-h-11 items-center justify-between gap-2">
    <label class="text-sm" for={printedId}>Print the artwork on it</label>
    <input
      id={printedId}
      class="focus-ring size-5 accent-accent"
      type="checkbox"
      checked={settings.printed}
      {disabled}
      onchange={(event) => onchange({ printed: event.currentTarget.checked })}
    />
  </div>

  <ColorField
    label="Wood colour"
    value={settings.wood_color}
    {disabled}
    onchange={(wood_color) => onchange({ wood_color })}
  />
  <ColorField
    label="Grain colour"
    value={settings.grain_color}
    {disabled}
    onchange={(grain_color) => onchange({ grain_color })}
  />
  <NumberField
    label="Grain scale"
    value={settings.grain_scale}
    min={limits.grain_scale[0]}
    max={limits.grain_scale[1]}
    step={0.1}
    {disabled}
    onchange={(grain_scale) => onchange({ grain_scale })}
  />
</div>
