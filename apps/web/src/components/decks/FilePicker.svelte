<script lang="ts">
  import type { components } from '@three-peaks/shared/api';
  import Button from '../ui/Button.svelte';
  import Spinner from '../ui/Spinner.svelte';
  import Thumbnail from '../Thumbnail.svelte';
  import { api, assertOk } from '../../api/client.ts';
  import { apiMessage } from '../../lib/session.svelte.ts';
  import { toasts } from '../../lib/toasts.svelte.ts';

  type File = components['schemas']['File'];
  type Listing = components['schemas']['DirectoryListing'];

  interface Props {
    projectId: string;
    // Ids already spoken for. They stay visible but cannot be picked again --
    // hiding them would make a folder look empty for no stated reason.
    taken?: readonly string[];
    multiple?: boolean;
    onpick: (files: File[]) => void;
    oncancel: () => void;
  }

  let { projectId, taken = [], multiple = false, onpick, oncancel }: Props = $props();

  let listing = $state<Listing | null>(null);
  let folderId = $state<string | null>(null);
  let loading = $state(false);
  let chosen = $state<File[]>([]);

  // Only images: a deck is made of artwork, and offering a .glb to pick as a
  // card front is an error the API would answer for anyway.
  const images = $derived(
    (listing?.files ?? []).filter((file) => file.content_type.startsWith('image/'))
  );
  const takenSet = $derived(new Set(taken));
  const available = $derived(images.filter((file) => !takenSet.has(file.id)));

  $effect(() => {
    const project = projectId;
    const folder = folderId;
    loading = true;

    api
      .GET('/api/files/directory', {
        params: { query: { project_id: project, ...(folder ? { folder_id: folder } : {}) } },
      })
      .then((result) => {
        listing = assertOk(result);
      })
      .catch((error) => toasts.error(apiMessage(error)))
      .finally(() => {
        loading = false;
      });
  });

  function toggle(file: File): void {
    if (!multiple) {
      onpick([file]);
      return;
    }
    chosen = chosen.some((entry) => entry.id === file.id)
      ? chosen.filter((entry) => entry.id !== file.id)
      : [...chosen, file];
  }

  function isChosen(file: File): boolean {
    return chosen.some((entry) => entry.id === file.id);
  }
</script>

<div class="flex flex-col gap-3 rounded-md border border-edge bg-surface p-4">
  <nav class="flex flex-wrap items-center gap-1 text-sm" aria-label="Folders">
    <button
      type="button"
      class="focus-ring rounded px-2 py-1 underline"
      onclick={() => (folderId = null)}
    >
      Files
    </button>
    {#each listing?.breadcrumb ?? [] as crumb (crumb.id)}
      <span aria-hidden="true" class="text-muted">/</span>
      <button
        type="button"
        class="focus-ring rounded px-2 py-1 underline"
        onclick={() => (folderId = crumb.id)}
      >
        {crumb.name}
      </button>
    {/each}
  </nav>

  {#if loading && !listing}
    <Spinner label="Loading files" />
  {:else}
    {#if (listing?.folders ?? []).length > 0}
      <ul class="flex flex-wrap gap-2">
        {#each listing?.folders ?? [] as folder (folder.id)}
          <li>
            <Button variant="secondary" onclick={() => (folderId = folder.id)}>
              {folder.name}
            </Button>
          </li>
        {/each}
      </ul>
    {/if}

    {#if images.length === 0}
      <p class="text-sm text-muted">No images in this folder.</p>
    {:else}
      <ul class="flex max-h-80 flex-col gap-1 overflow-y-auto">
        {#each images as file (file.id)}
          {@const already = takenSet.has(file.id)}
          <li>
            <button
              type="button"
              class="focus-ring flex min-h-11 w-full items-center gap-3 rounded px-2 py-1 text-left
                     text-sm hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50"
              disabled={already}
              aria-pressed={multiple ? isChosen(file) : undefined}
              onclick={() => toggle(file)}
            >
              <Thumbnail fileId={file.id} />
              <span class="min-w-0 flex-1 truncate">{file.filename}</span>
              {#if already}
                <span class="text-xs text-muted">already in the deck</span>
              {:else if multiple && isChosen(file)}
                <span class="text-xs text-accent">selected</span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    <div class="flex flex-wrap gap-2">
      {#if multiple}
        <Button disabled={chosen.length === 0} onclick={() => onpick(chosen)}>
          Add {chosen.length || ''} selected
        </Button>
        <Button
          variant="secondary"
          disabled={available.length === 0}
          onclick={() => onpick(available)}
        >
          Add every image here
        </Button>
      {/if}
      <Button variant="ghost" onclick={oncancel}>Cancel</Button>
    </div>
  {/if}
</div>
