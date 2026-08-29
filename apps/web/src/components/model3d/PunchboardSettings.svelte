<script lang="ts">
  import {
    MODEL_LIMITS,
    PUNCHBOARD_SHEET_STATES,
    type PunchboardModelSettings,
    type PunchboardSheetState,
  } from '@three-peaks/shared';
  import ColorField from './ColorField.svelte';
  import NumberField from './NumberField.svelte';

  interface Props {
    settings: PunchboardModelSettings;
    // How many tokens the die line cut out, or null while it is being read.
    // Drawn here because it is the one number that says whether the cut sheet
    // was understood at all.
    tokens: number | null;
    disabled: boolean;
    onchange: (patch: Partial<PunchboardModelSettings>) => void;
  }

  let { settings, tokens, disabled, onchange }: Props = $props();

  const STATE_LABELS: Record<PunchboardSheetState, string> = {
    intact: 'Whole, before anything is punched out',
    punched: 'The frame left after punching',
  };

  const limits = MODEL_LIMITS.punchboard;
  const stateId = $props.id();
</script>

<div class="flex flex-col gap-4">
  <NumberField
    label="Sheet width"
    suffix=" mm"
    value={settings.width_mm}
    min={limits.width_mm[0]}
    max={limits.width_mm[1]}
    step={1}
    {disabled}
    onchange={(width_mm) => onchange({ width_mm })}
  />
  <NumberField
    label="Sheet height"
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
    <label class="text-sm" for={stateId}>Sheet</label>
    <select
      id={stateId}
      class="focus-ring min-h-11 rounded-md border border-edge bg-surface px-2 text-sm"
      value={settings.sheet_state}
      {disabled}
      onchange={(event) =>
        onchange({ sheet_state: event.currentTarget.value as PunchboardSheetState })}
    >
      {#each PUNCHBOARD_SHEET_STATES as state (state)}
        <option value={state}>{STATE_LABELS[state]}</option>
      {/each}
    </select>
    <p class="text-xs text-muted">
      The tokens are exported either way. This only decides whether the sheet beside them still
      holds them.
    </p>
  </div>

  <p class="text-xs text-muted">
    {#if tokens === null}
      The cut sheet decides where the tokens are. Its viewBox is stretched over the sheet size
      above, so both are measured the same way.
    {:else}
      The cut sheet cuts {tokens}
      {tokens === 1 ? 'token' : 'tokens'} out of this sheet.
    {/if}
  </p>

  <ColorField
    label="Reverse colour"
    value={settings.back_color}
    {disabled}
    onchange={(back_color) => onchange({ back_color })}
  />
  <ColorField
    label="Cut edge colour"
    value={settings.edge_color}
    {disabled}
    onchange={(edge_color) => onchange({ edge_color })}
  />
</div>
