<script lang="ts">
  import { authHeader } from '../api/client.ts';

  // The bytes are behind the same bearer credential as every other API call, so
  // the browser cannot be handed the URL and left to fetch it -- see the note in
  // `lib/download.ts`, which reads them the same way for the same reason. This
  // was an `<img src="/api/files/{id}/download">` for a while, which answered
  // 401 for every image in the explorer.
  interface Props {
    fileId: string;
    alt?: string;
    // A history screen has to draw the artwork a run left, not the artwork the
    // file carries now.
    version?: number;
    class?: string;
    fit?: 'cover' | 'contain';
  }
  let { fileId, alt = '', version, class: className = 'size-12', fit = 'cover' }: Props = $props();

  let frame = $state<HTMLElement | null>(null);
  let url = $state<string | null>(null);
  // A plain binding, not $state: it is written in teardown, where a $state write
  // silently does not survive, and nothing renders from it.
  let objectUrl: string | null = null;

  function release(): void {
    if (objectUrl === null) return;
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }

  $effect(() => {
    const id = fileId;
    // Read out here rather than inside read(): a prop touched only from the
    // async closure is not a dependency of this effect, so moving between two
    // versions would leave the first image on screen.
    const wanted = version;
    const node = frame;
    url = null;
    if (!node) return;

    let stale = false;

    async function read(): Promise<void> {
      try {
        const query = wanted === undefined ? '' : `?version=${wanted}`;
        const response = await fetch(`/api/files/${id}/download${query}`, {
          headers: authHeader(),
        });
        if (!response.ok || stale) return;
        const blob = await response.blob();
        if (stale) return;
        objectUrl = URL.createObjectURL(blob);
        url = objectUrl;
      } catch {
        // A thumbnail is decoration. The row it sits in still names the file and
        // still downloads it, and a listing that genuinely failed is reported by
        // the screen rather than by fifty broken squares.
      }
    }

    // Only what has been scrolled to: a folder of a hundred images would
    // otherwise read every one of them in full to draw a 48px square. Where
    // there is no observer -- jsdom, and anything older -- read them straight
    // away rather than never.
    if (typeof IntersectionObserver === 'undefined') {
      void read();
      return () => {
        stale = true;
        release();
      };
    }

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void read();
    });
    observer.observe(node);

    return () => {
      stale = true;
      observer.disconnect();
      release();
    };
  });
</script>

<span bind:this={frame} class="block shrink-0 overflow-hidden rounded bg-canvas {className}">
  {#if url}
    <!-- Both literals spelled out: Tailwind scans source text, and a class name
         built by interpolation is never generated. -->
    <img
      src={url}
      {alt}
      class={fit === 'contain' ? 'size-full object-contain' : 'size-full object-cover'}
    />
  {/if}
</span>
