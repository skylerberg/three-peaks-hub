<script lang="ts">
  import {
    CARD_PRESETS,
    MODEL_LIMITS,
    cardPreset,
    matchingCardPreset,
    type CardModelSettings,
  } from '@three-peaks/shared';
  import type { components } from '@three-peaks/shared/api';
  import ColorField from './ColorField.svelte';
  import NumberField from './NumberField.svelte';

  interface Props {
    settings: CardModelSettings;
    backChoices: components['schemas']['File'][];
    disabled: boolean;
    onchange: (patch: Partial<CardModelSettings>) => void;
  }

  let { settings, backChoices, disabled, onchange }: Props = $props();

  const limits = MODEL_LIMITS.card;
  const presetId = $derived(matchingCardPreset(settings)?.id ?? '');
  // One call per component, so the fields take suffixes off it.
  const uid = $props.id();
  const sizeId = `${uid}-size`;
  const backId = `${uid}-back`;

  function applyPreset(id: string) {
    const preset = cardPreset(id);
    if (preset) onchange({ width_mm: preset.width_mm, height_mm: preset.height_mm });
  }
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-col gap-1">
    <label class="text-sm" for={sizeId}>Card size</label>
    <select
      id={sizeId}
      class="focus-ring min-h-11 rounded-md border border-edge bg-surface px-2 text-sm"
      value={presetId}
      {disabled}
      onchange={(event) => applyPreset(event.currentTarget.value)}
    >
      <option value="">Custom</option>
      {#each CARD_PRESETS as preset (preset.id)}
        <option value={preset.id}>{preset.name}</option>
      {/each}
    </select>
  </div>

  <NumberField
    label="Width"
    suffix=" mm"
    value={settings.width_mm}
    min={limits.width_mm[0]}
    max={limits.width_mm[1]}
    step={0.5}
    {disabled}
    onchange={(width_mm) => onchange({ width_mm })}
  />
  <NumberField
    label="Height"
    suffix=" mm"
    value={settings.height_mm}
    min={limits.height_mm[0]}
    max={limits.height_mm[1]}
    step={0.5}
    {disabled}
    onchange={(height_mm) => onchange({ height_mm })}
  />
  <NumberField
    label="Thickness"
    suffix=" mm"
    value={settings.thickness_mm}
    min={limits.thickness_mm[0]}
    max={limits.thickness_mm[1]}
    step={0.01}
    {disabled}
    onchange={(thickness_mm) => onchange({ thickness_mm })}
  />
  <NumberField
    label="Corner radius"
    suffix=" mm"
    value={settings.corner_radius_mm}
    min={limits.corner_radius_mm[0]}
    max={limits.corner_radius_mm[1]}
    step={0.1}
    {disabled}
    onchange={(corner_radius_mm) => onchange({ corner_radius_mm })}
  />
  <NumberField
    label="Edge bevel"
    suffix=" mm"
    value={settings.bevel_mm}
    min={limits.bevel_mm[0]}
    max={limits.bevel_mm[1]}
    step={0.01}
    {disabled}
    onchange={(bevel_mm) => onchange({ bevel_mm })}
  />

  <div class="flex flex-col gap-1">
    <label class="text-sm" for={backId}>Card back</label>
    <select
      id={backId}
      class="focus-ring min-h-11 rounded-md border border-edge bg-surface px-2 text-sm"
      value={settings.back_file_id ?? ''}
      {disabled}
      onchange={(event) => onchange({ back_file_id: event.currentTarget.value || null })}
    >
      <option value="">Plain colour</option>
      {#each backChoices as choice (choice.id)}
        <option value={choice.id}>{choice.filename}</option>
      {/each}
    </select>
    <p class="text-xs text-muted">Images in the same folder as this one.</p>
  </div>

  {#if settings.back_file_id === null}
    <ColorField
      label="Back colour"
      value={settings.back_color}
      {disabled}
      onchange={(back_color) => onchange({ back_color })}
    />
  {/if}
  <ColorField
    label="Stock colour"
    value={settings.stock_color}
    {disabled}
    onchange={(stock_color) => onchange({ stock_color })}
  />
</div>
