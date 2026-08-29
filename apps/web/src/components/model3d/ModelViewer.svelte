<script lang="ts">
  import type { ModelSettings } from '@three-peaks/shared';
  import type { BuiltModel, ModelSources, ModelViewer as Viewer } from '../../lib/model3d/index.ts';
  import Spinner from '../ui/Spinner.svelte';

  interface Props {
    settings: ModelSettings;
    // Null until the artwork has been read. The second image, where a kind
    // takes one, rides along in here rather than as a prop of its own -- what
    // it is depends on the kind, and the builder is where that is decided.
    sources: ModelSources | null;
    // Handed up so the screen can export exactly what is on screen rather than
    // rebuilding a second model that might differ.
    onbuild: (model: BuiltModel | null) => void;
  }

  let { settings, sources, onbuild }: Props = $props();

  let canvas = $state<HTMLCanvasElement | null>(null);
  let error = $state<string | null>(null);
  let building = $state(false);

  // Plain bindings, not $state: these outlive the render they were created in
  // and are written during teardown, where a $state write does not survive.
  let viewer: Viewer | null = null;
  let current: BuiltModel | null = null;
  let library: typeof import('../../lib/model3d/index.ts') | null = null;

  $effect(() => {
    const element = canvas;
    if (!element) return;

    let disposed = false;
    void (async () => {
      const module = await import('../../lib/model3d/index.ts');
      if (disposed) return;
      library = module;
      try {
        viewer = new module.ModelViewer(element, readCanvasColour(element));
      } catch {
        error = 'This browser could not open a 3D view. WebGL may be turned off.';
      }
    })();

    return () => {
      disposed = true;
      viewer?.dispose();
      viewer = null;
      if (current && library) library.disposeModel(current);
      current = null;
      onbuild(null);
    };
  });

  // Rebuilds whenever any settings field or either image changes. The old model
  // is disposed first: geometry and textures hold GPU memory that dropping the
  // reference does not release.
  $effect(() => {
    const snapshot = $state.snapshot(settings) as ModelSettings;
    const images = sources;
    if (!viewer || !library || !images) return;

    building = true;
    error = null;
    try {
      const built = library.buildModel(snapshot, images);
      viewer.setContent(built.group);
      if (current) library.disposeModel(current);
      current = built;
      onbuild(built);
    } catch (caught) {
      error =
        caught instanceof Error ? caught.message : 'That image could not be turned into a shape.';
      viewer.setContent(null);
      onbuild(null);
    } finally {
      building = false;
    }
  });

  function readCanvasColour(element: HTMLCanvasElement): string {
    return getComputedStyle(element).backgroundColor || '#000000';
  }
</script>

<div class="relative aspect-square w-full overflow-hidden rounded-lg border border-edge bg-canvas">
  <canvas
    bind:this={canvas}
    class="size-full bg-canvas"
    aria-label="Three-dimensional preview. Drag to turn the model, scroll to zoom."
  ></canvas>

  {#if building || !sources}
    <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
      <Spinner label="Building the model" />
    </div>
  {/if}

  {#if error}
    <p class="absolute inset-x-0 bottom-0 bg-surface p-3 text-sm text-danger" role="status">
      {error}
    </p>
  {/if}
</div>
