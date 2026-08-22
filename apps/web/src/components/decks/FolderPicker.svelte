<script lang="ts">
  import type { components } from '@three-peaks/shared/api';
  import Button from '../ui/Button.svelte';
  import Input from '../ui/Input.svelte';
  import Spinner from '../ui/Spinner.svelte';
  import { files } from '../../lib/files.svelte.ts';
  import { apiMessage } from '../../lib/session.svelte.ts';
  import { toasts } from '../../lib/toasts.svelte.ts';

  type Listing = components['schemas']['DirectoryListing'];

  interface Props {
    projectId: string;
    onpick: (folder: { id: string; name: string }) => void;
    oncancel: () => void;
  }

  let { projectId, onpick, oncancel }: Props = $props();

  let listing = $state<Listing | null>(null);
  let folderId = $state<string | null>(null);
  let loading = $state(false);
  let creating = $state(false);
  let newName = $state('');

  const here = $derived(listing?.folder ?? null);

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

  async function createFolder(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    try {
      const folder = await files.createFolder(projectId, folderId, name);
      newName = '';
      creating = false;
      folderId = folder.id;
    } catch (error) {
      toasts.error(apiMessage(error));
    }
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
    <Spinner label="Loading folders" />
  {:else}
    {#if (listing?.folders ?? []).length === 0}
      <p class="text-sm text-muted">No folders here.</p>
    {:else}
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

    {#if here === null}
      <p class="text-sm text-muted">An import needs a folder of its own. Open one, or make one.</p>
    {/if}

    {#if creating}
      <form class="flex flex-wrap items-end gap-2" onsubmit={createFolder}>
        <div class="min-w-56 flex-1">
          <Input label="New folder name" bind:value={newName} maxlength={120} />
        </div>
        <Button type="submit" disabled={newName.trim().length === 0}>Create</Button>
        <Button variant="ghost" onclick={() => (creating = false)}>Cancel</Button>
      </form>
    {/if}

    <div class="flex flex-wrap gap-2">
      <Button
        disabled={here === null}
        onclick={() => here && onpick({ id: here.id, name: here.name })}
      >
        Use this folder
      </Button>
      {#if !creating}
        <Button variant="secondary" onclick={() => (creating = true)}>New folder</Button>
      {/if}
      <Button variant="ghost" onclick={oncancel}>Cancel</Button>
    </div>
  {/if}
</div>
