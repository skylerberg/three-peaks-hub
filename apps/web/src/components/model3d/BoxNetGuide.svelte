<script lang="ts">
  import {
    BOX_FACES,
    boxNetRegions,
    type BoxFace,
    type BoxModelSettings,
  } from '@three-peaks/shared';

  interface Props {
    settings: BoxModelSettings;
  }

  let { settings }: Props = $props();

  const FACE_LABELS: Record<BoxFace, string> = {
    front: 'Front',
    back: 'Back',
    left: 'Left',
    right: 'Right',
    top: 'Top',
    bottom: 'Bottom',
  };

  // Nothing here measures the font, so a label is fitted by an assumed glyph
  // width, with room to spare, and at the length of the longest of them: front
  // and back are the same panel on a cube and would otherwise read at two sizes.
  const GLYPH_WIDTH = 0.6;
  const LABEL_FILL = 0.8;
  const LABEL_CHARS = Math.max(...Object.values(FACE_LABELS).map((label) => label.length));

  // A label stands upright only in a clearly portrait panel. Front and back are
  // the same square on a cube and land a float's width apart, so turning on any
  // excess at all would stand one of the two on its side and not the other.
  const TURN_RATIO = 1.05;

  const NET_DESCRIPTION =
    'The wrap unfolded: top above the front panel, then left, front, right and back across the ' +
    'middle, and bottom below the front.';

  const netWidth = $derived(2 * settings.depth_mm + 2 * settings.width_mm);
  const netHeight = $derived(2 * settings.depth_mm + settings.height_mm);

  // Read off boxNetRegions rather than laid out again here, so the diagram and
  // the UVs the geometry is built with cannot disagree.
  const panels = $derived.by(() => {
    const regions = boxNetRegions(settings);
    return BOX_FACES.map((face) => {
      const region = regions[face];
      const x = region.u0 * netWidth;
      const y = region.v0 * netHeight;
      const width = (region.u1 - region.u0) * netWidth;
      const height = (region.v1 - region.v0) * netHeight;
      const label = FACE_LABELS[face];
      const turned = height > width * TURN_RATIO;
      const along = turned ? height : width;
      const across = turned ? width : height;
      return {
        face,
        label,
        x,
        y,
        width,
        height,
        cx: x + width / 2,
        cy: y + height / 2,
        turned,
        size: Math.min((along * LABEL_FILL) / (GLYPH_WIDTH * LABEL_CHARS), across / 2),
      };
    });
  });

  const front = $derived(panels.find((panel) => panel.face === 'front'));
  const aspect = $derived((netWidth / netHeight).toFixed(2));

  function round(value: number): number {
    return Math.round(value * 10) / 10;
  }
</script>

<figure class="flex flex-col gap-1">
  <svg
    class="w-full rounded-md border border-edge bg-canvas"
    viewBox="0 0 {netWidth} {netHeight}"
    role="img"
    aria-label={NET_DESCRIPTION}
  >
    {#if front}
      <rect
        class="text-accent-soft"
        x={front.x}
        y={front.y}
        width={front.width}
        height={front.height}
        fill="currentColor"
      />
    {/if}

    <g
      class="text-edge"
      fill="none"
      stroke="currentColor"
      stroke-width="1"
      vector-effect="non-scaling-stroke"
    >
      {#each panels as panel (panel.face)}
        <rect x={panel.x} y={panel.y} width={panel.width} height={panel.height} />
      {/each}
    </g>

    <g class="text-muted" fill="currentColor" text-anchor="middle" dominant-baseline="central">
      {#each panels as panel (panel.face)}
        <text
          x={panel.cx}
          y={panel.cy}
          font-size={panel.size}
          transform={panel.turned ? `rotate(-90 ${panel.cx} ${panel.cy})` : undefined}
        >
          {panel.label}
        </text>
      {/each}
    </g>
  </svg>

  <figcaption class="text-xs text-muted">
    One flat image, {round(netWidth)} × {round(netHeight)} mm ({aspect}:1). The panels are read as
    proportions of whatever you upload, so artwork drawn to another shape lands over the folds.
  </figcaption>
</figure>
