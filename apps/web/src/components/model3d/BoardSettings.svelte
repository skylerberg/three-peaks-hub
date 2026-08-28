<script lang="ts">
  import {
    BOARD_FOLDS,
    MODEL_LIMITS,
    type BoardFold,
    type BoardModelSettings,
  } from '@three-peaks/shared';
  import ColorField from './ColorField.svelte';
  import NumberField from './NumberField.svelte';

  interface Props {
    settings: BoardModelSettings;
    disabled: boolean;
    onchange: (patch: Partial<BoardModelSettings>) => void;
  }

  let { settings, disabled, onchange }: Props = $props();

  const FOLD_LABELS: Record<BoardFold, string> = {
    none: 'One piece',
    bifold: 'Bifold, two panels',
    quadfold: 'Quadfold, four panels',
  };

  const limits = MODEL_LIMITS.board;
  const foldId = $props.id();
</script>

<div class="flex flex-col gap-4">
  <NumberField
    label="Width"
    suffix=" mm"
    value={settings.width_mm}
    min={limits.width_mm[0]}
    max={limits.width_mm[1]}
    step={1}
    {disabled}
    onchange={(width_mm) => onchange({ width_mm })}
  />
  <NumberField
    label="Height"
    suffix=" mm"
    value={settings.height_mm}
    min={limits.height_mm[0]}
    max={limits.height_mm[1]}
    step={1}
    {disabled}
    onchange={(height_mm) => onchange({ height_mm })}
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

  <div class="flex flex-col gap-1">
    <label class="text-sm" for={foldId}>Fold</label>
    <select
      id={foldId}
      class="focus-ring min-h-11 rounded-md border border-edge bg-surface px-2 text-sm"
      value={settings.fold}
      {disabled}
      onchange={(event) => onchange({ fold: event.currentTarget.value as BoardFold })}
    >
      {#each BOARD_FOLDS as fold (fold)}
        <option value={fold}>{FOLD_LABELS[fold]}</option>
      {/each}
    </select>
    <p class="text-xs text-muted">
      The artwork is one image across the whole board; a fold splits it into panels with a hinge.
    </p>
  </div>

  {#if settings.fold !== 'none'}
    <NumberField
      label="Fold gap"
      suffix=" mm"
      value={settings.fold_gap_mm}
      min={limits.fold_gap_mm[0]}
      max={limits.fold_gap_mm[1]}
      step={0.5}
      {disabled}
      onchange={(fold_gap_mm) => onchange({ fold_gap_mm })}
    />
  {/if}

  <ColorField
    label="Edge colour"
    value={settings.edge_color}
    {disabled}
    onchange={(edge_color) => onchange({ edge_color })}
  />
</div>
