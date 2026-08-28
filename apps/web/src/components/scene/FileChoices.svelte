<script lang="ts">
  import { isModelSource } from '@three-peaks/shared';
  import type { components } from '@three-peaks/shared/api';
  import Spinner from '../ui/Spinner.svelte';
  import { files } from '../../lib/files.svelte.ts';
  import { apiMessage } from '../../lib/session.svelte.ts';
  import { toasts } from '../../lib/toasts.svelte.ts';

  type Listing = components['schemas']['DirectoryListing'];
  type FileRow = components['schemas']['File'];

  interface Props {
    projectId: string;
    // Held by the screen, keyed by file id, so a tick survives walking into
    // another folder and back out of it.
    selected: Record<string, FileRow | undefined>;
    ontoggle: (file: FileRow, on: boolean) => void;
  }

  let { projectId, selected, ontoggle }: Props = $props();

  let listing = $state<Listing | null>(null);
  let folderId = $state<string | null>(null);
  let loading = $state(false);

  const choices = $derived((listing?.files ?? []).filter((row) => isModelSource(row.content_type)));

  $effect(() => {
    const project = projectId;
    const folder = folderId;
    let stale = false;
    loading = true;

    files
      .readDirectory(project, folder)
      .then((result) => {
        if (!stale) listing = result;
      })
      .catch((error: unknown) => {
        if (!stale) toasts.error(apiMessage(error));
      })
      .finally(() => {
        if (!stale) loading = false;
      });

    return () => {
      stale = true;
    };
  });
</script>

<div class="flex flex-col gap-3">
  <nav class="flex flex-wrap items-center gap-1 text-sm" aria-label="Folders">
    <button
      type="button"
      class="focus-ring inline-flex min-h-11 items-center rounded px-2 underline"
      onclick={() => (folderId = null)}
    >
      Files
    </button>
    {#each listing?.breadcrumb ?? [] as crumb (crumb.id)}
      <span aria-hidden="true" class="text-muted">/</span>
      <button
        type="button"
        class="focus-ring inline-flex min-h-11 items-center rounded px-2 underline"
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
            <button
              type="button"
              class="focus-ring inline-flex min-h-11 items-center rounded-md border border-edge
                     bg-surface px-3 text-sm hover:bg-accent-soft"
              onclick={() => (folderId = folder.id)}
            >
              {folder.name}
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    <ul class="flex max-h-72 flex-col gap-1 overflow-y-auto">
      {#each choices as row (row.id)}
        <li>
          <label class="flex min-h-11 items-center gap-3 rounded px-2 text-sm hover:bg-accent-soft">
            <input
              type="checkbox"
              class="focus-ring size-4"
              checked={selected[row.id] !== undefined}
              onchange={(event) => ontoggle(row, event.currentTarget.checked)}
            />
            <span class="min-w-0 flex-1 truncate">{row.filename}</span>
          </label>
        </li>
      {:else}
        <li class="px-2 text-sm text-muted">No images here that a component can be made from.</li>
      {/each}
    </ul>
  {/if}
</div>
