<script lang="ts">
  import { MODEL_LIMITS, type BoxModelSettings } from '@three-peaks/shared';
  import BoxNetGuide from './BoxNetGuide.svelte';
  import NumberField from './NumberField.svelte';

  interface Props {
    settings: BoxModelSettings;
    disabled: boolean;
    onchange: (patch: Partial<BoxModelSettings>) => void;
  }

  let { settings, disabled, onchange }: Props = $props();

  const limits = MODEL_LIMITS.box;
</script>

<div class="flex flex-col gap-4">
  <BoxNetGuide {settings} />

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
    label="Depth"
    suffix=" mm"
    value={settings.depth_mm}
    min={limits.depth_mm[0]}
    max={limits.depth_mm[1]}
    step={1}
    {disabled}
    onchange={(depth_mm) => onchange({ depth_mm })}
  />
  <NumberField
    label="Corner bevel"
    suffix=" mm"
    value={settings.corner_bevel_mm}
    min={limits.corner_bevel_mm[0]}
    max={limits.corner_bevel_mm[1]}
    step={0.1}
    {disabled}
    onchange={(corner_bevel_mm) => onchange({ corner_bevel_mm })}
  />
</div>
