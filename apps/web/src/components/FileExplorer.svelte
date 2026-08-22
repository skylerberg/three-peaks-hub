<script lang="ts">
  import { formatBytes, isModelSource } from '@three-peaks/shared';
  import Thumbnail from './Thumbnail.svelte';
  import Button from './ui/Button.svelte';
  import Spinner from './ui/Spinner.svelte';
  import { downloadFile } from '../lib/download.ts';
  import { files } from '../lib/files.svelte.ts';
  import { realtime } from '../lib/realtime.svelte.ts';
  import { apiMessage } from '../lib/session.svelte.ts';
  import { link, router } from '../lib/router.svelte.ts';
  import { toasts } from '../lib/toasts.svelte.ts';

  interface Props {
    projectId: string;
    folderId: string | null;
    canEdit: boolean;
  }
  let { projectId, folderId, canEdit }: Props = $props();

  let fileInput = $state<HTMLInputElement | null>(null);
  let dropActive = $state(false);
  let creatingFolder = $state(false);
  let newFolderName = $state('');

  const listing = $derived(files.listing);
  const quotaUsed = $derived(
    listing ? Math.min(100, (listing.storage_used_bytes / listing.storage_quota_bytes) * 100) : 0
  );

  $effect(() => {
    files.load(projectId, folderId).catch((error) => toasts.error(apiMessage(error)));
  });

  // Subscribed only while this project is on screen. Any event for it reloads
  // the directory rather than patching it: the listing is one query and a
  // reload is simpler than nine per-event mutations that can each drift.
  $effect(() => {
    const id = projectId;
    realtime.subscribe(id);
    const off = realtime.on((event) => {
      if (event.project_id !== id) return;
      void files.refresh().catch(() => {});
    });
    return () => {
      off();
      realtime.unsubscribe(id);
    };
  });

  function open(id: string | null) {
    router.navigate(id ? `/projects/${projectId}?folder=${id}` : `/projects/${projectId}`);
  }

  async function uploadAll(list: FileList | null) {
    if (!list || list.length === 0) return;
    // Sequential rather than parallel: the quota is checked per request, and a
    // burst of concurrent uploads can each pass a check the set of them fails.
    for (const file of Array.from(list)) {
      try {
        await files.upload(projectId, folderId, file);
      } catch (error) {
        toasts.error(`${file.name}: ${apiMessage(error)}`);
      }
    }
    await files.refresh();
  }

  async function createFolder(event: SubmitEvent) {
    event.preventDefault();
    if (!newFolderName.trim()) return;
    try {
      await files.createFolder(projectId, folderId, newFolderName.trim());
      newFolderName = '';
      creatingFolder = false;
      await files.refresh();
    } catch (error) {
      toasts.error(apiMessage(error));
    }
  }

  async function renameFile(id: string, current: string) {
    const next = prompt('New name', current);
    if (!next || next === current) return;
    try {
      await files.renameFile(id, next);
      await files.refresh();
    } catch (error) {
      toasts.error(apiMessage(error));
    }
  }

  async function removeFile(id: string, name: string) {
    if (!confirm(`Delete ${name}? This cannot be undone.`)) return;
    try {
      await files.deleteFile(id);
      await files.refresh();
    } catch (error) {
      toasts.error(apiMessage(error));
    }
  }

  async function removeFolder(id: string, name: string) {
    if (!confirm(`Delete the folder ${name} and everything inside it?`)) return;
    try {
      await files.deleteFolder(id);
      await files.refresh();
    } catch (error) {
      toasts.error(apiMessage(error));
    }
  }

  async function download(id: string, filename: string) {
    try {
      await downloadFile(id, filename);
    } catch (error) {
      toasts.error(apiMessage(error, 'Those bytes could not be downloaded.'));
    }
  }

  function isImage(contentType: string) {
    return contentType.startsWith('image/');
  }
</script>

<div class="flex flex-col gap-4" use:link>
  <!-- Breadcrumb -->
  <nav aria-label="Folder path" class="flex flex-wrap items-center gap-1 text-sm">
    <button
      type="button"
      class="focus-ring rounded px-2 py-1 hover:bg-accent-soft"
      onclick={() => open(null)}
    >
      Files
    </button>
    {#each listing?.breadcrumb ?? [] as crumb (crumb.id)}
      <span aria-hidden="true" class="text-muted">/</span>
      <button
        type="button"
        class="focus-ring rounded px-2 py-1 hover:bg-accent-soft"
        aria-current={crumb.id === listing?.folder?.id ? 'page' : undefined}
        onclick={() => open(crumb.id)}
      >
        {crumb.name}
      </button>
    {/each}
  </nav>

  {#if canEdit}
    <div class="flex flex-wrap items-center gap-2">
      <Button onclick={() => fileInput?.click()}>Upload files</Button>
      <Button variant="secondary" onclick={() => (creatingFolder = !creatingFolder)}>
        {creatingFolder ? 'Cancel' : 'New folder'}
      </Button>
      <input
        bind:this={fileInput}
        type="file"
        multiple
        class="sr-only"
        aria-label="Files to upload"
        onchange={(event) => {
          const input = event.currentTarget;
          void uploadAll(input.files).then(() => {
            // Cleared so re-picking the same file fires change again.
            input.value = '';
          });
        }}
      />
    </div>

    {#if creatingFolder}
      <form class="flex items-end gap-2" onsubmit={createFolder}>
        <label class="flex flex-1 flex-col gap-1 text-sm">
          <span class="font-medium">Folder name</span>
          <input
            bind:value={newFolderName}
            class="focus-ring min-h-11 rounded-md border border-edge bg-surface px-3 text-sm"
          />
        </label>
        <Button type="submit" disabled={!newFolderName.trim()}>Create</Button>
      </form>
    {/if}
  {/if}

  <!-- Drop zone -->
  <div
    role="region"
    aria-label="File list"
    class="rounded-md border-2 border-dashed p-4 transition-colors
           {dropActive ? 'border-accent bg-accent-soft' : 'border-transparent'}"
    ondragover={(event) => {
      if (!canEdit) return;
      event.preventDefault();
      dropActive = true;
    }}
    ondragleave={() => (dropActive = false)}
    ondrop={(event) => {
      if (!canEdit) return;
      event.preventDefault();
      dropActive = false;
      void uploadAll(event.dataTransfer?.files ?? null);
    }}
  >
    {#if files.loading && !listing}
      <Spinner label="Loading files" />
    {:else}
      <ul class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {#each listing?.folders ?? [] as folder (folder.id)}
          <li class="flex items-center gap-3 rounded-md border border-edge bg-surface p-3">
            <button
              type="button"
              class="focus-ring flex min-h-11 flex-1 items-center gap-2 rounded text-left"
              onclick={() => open(folder.id)}
            >
              <span aria-hidden="true">📁</span>
              <span class="truncate font-medium">{folder.name}</span>
            </button>
            {#if canEdit}
              <button
                type="button"
                class="focus-ring rounded px-2 py-1 text-sm text-muted hover:text-danger"
                onclick={() => removeFolder(folder.id, folder.name)}
                aria-label="Delete folder {folder.name}"
              >
                Delete
              </button>
            {/if}
          </li>
        {/each}

        {#each listing?.files ?? [] as file (file.id)}
          <li class="flex flex-col gap-2 rounded-md border border-edge bg-surface p-3">
            <div class="flex items-start gap-3">
              {#if isImage(file.content_type)}
                <Thumbnail fileId={file.id} />
              {:else}
                <span aria-hidden="true" class="text-2xl">📄</span>
              {/if}
              <div class="min-w-0 flex-1">
                <p class="truncate font-medium" title={file.filename}>{file.filename}</p>
                <p class="text-xs text-muted">{formatBytes(file.byte_size)}</p>
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-sm">
              <button
                type="button"
                class="focus-ring inline-flex min-h-11 items-center rounded px-2 underline"
                aria-label="Download {file.filename}"
                onclick={() => download(file.id, file.filename)}
              >
                Download
              </button>
              <a
                class="focus-ring inline-flex min-h-11 items-center rounded px-2 underline"
                href="/projects/{projectId}/files/{file.id}/versions"
              >
                Versions
              </a>
              {#if isModelSource(file.content_type)}
                <a
                  class="focus-ring inline-flex min-h-11 items-center rounded px-2 underline"
                  href="/projects/{projectId}/files/{file.id}/3d"
                >
                  Make 3D
                </a>
              {/if}
              {#if canEdit}
                <button
                  type="button"
                  class="focus-ring inline-flex min-h-11 items-center rounded px-2 text-muted hover:text-ink"
                  aria-label="Rename {file.filename}"
                  onclick={() => renameFile(file.id, file.filename)}
                >
                  Rename
                </button>
                <button
                  type="button"
                  class="focus-ring inline-flex min-h-11 items-center rounded px-2 text-muted hover:text-danger"
                  aria-label="Delete {file.filename}"
                  onclick={() => removeFile(file.id, file.filename)}
                >
                  Delete
                </button>
              {/if}
            </div>
          </li>
        {/each}

        {#each files.pending as upload (upload.key)}
          <li
            class="flex items-center gap-3 rounded-md border border-dashed border-edge p-3 opacity-70"
          >
            <Spinner label="" />
            <span class="truncate text-sm">{upload.filename}</span>
          </li>
        {/each}
      </ul>

      {#if (listing?.folders.length ?? 0) === 0 && (listing?.files.length ?? 0) === 0 && files.pending.length === 0}
        <p class="p-8 text-center text-muted">
          {canEdit ? 'Drop files here, or use the buttons above.' : 'This folder is empty.'}
        </p>
      {/if}
    {/if}
  </div>

  {#if listing}
    <div class="flex flex-col gap-1 text-xs text-muted">
      <div class="h-1.5 w-full overflow-hidden rounded-full bg-edge">
        <div class="h-full bg-accent" style="width: {quotaUsed}%"></div>
      </div>
      <span>
        {formatBytes(listing.storage_used_bytes)} of {formatBytes(listing.storage_quota_bytes)} used
      </span>
    </div>
  {/if}
</div>
