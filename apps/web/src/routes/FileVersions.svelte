<script lang="ts">
  import { formatBytes } from '@three-peaks/shared';
  import Thumbnail from '../components/Thumbnail.svelte';
  import Button from '../components/ui/Button.svelte';
  import Spinner from '../components/ui/Spinner.svelte';
  import { ApiError, api, assertOk } from '../api/client.ts';
  import { downloadFile } from '../lib/download.ts';
  import { realtime } from '../lib/realtime.svelte.ts';
  import { link } from '../lib/router.svelte.ts';
  import { apiMessage, session } from '../lib/session.svelte.ts';
  import { toasts } from '../lib/toasts.svelte.ts';
  import { versions } from '../lib/versions.svelte.ts';

  interface Props {
    projectId: string;
    fileId: string;
  }
  let { projectId, fileId }: Props = $props();

  let error = $state<string | null>(null);
  let busy = $state(false);
  let fileInput = $state<HTMLInputElement | null>(null);
  // One request answers both who wrote each version and whether this account may
  // write one: the member list carries every name and the caller's own role.
  let names = $state<Record<string, string>>({});
  let canEdit = $state(false);

  // Which two versions are on the light table. Two, and no more: a third pick
  // replaces the older of them rather than being refused, so walking backwards
  // through a stack does not mean clearing the pair at every step.
  let compare = $state<number[]>([]);

  const file = $derived(versions.file);
  const history = $derived(versions.versions);
  // Loose on purpose: a rolling deploy can put this bundle in front of an API
  // pod whose File carries no deleted_at at all, and a missing key must not read
  // as a tombstone.
  const tombstoned = $derived(Boolean(file?.deleted_at));

  // Back to whatever holds the file, which is one of three places now. A deck
  // card's history belongs beside its deck rather than in Assets, where the
  // card is not.
  const backHref = $derived.by(() => {
    if (file?.deck_id) return `/projects/${projectId}/decks/${file.deck_id}`;
    if (file?.component_id) return `/projects/${projectId}/components/${file.component_id}`;
    const assets = `/projects/${projectId}/assets`;
    return file?.folder_id ? `${assets}?folder=${file.folder_id}` : assets;
  });
  const backLabel = $derived(
    file?.deck_id
      ? 'Back to the deck'
      : file?.component_id
        ? 'Back to the component'
        : 'Back to Assets'
  );

  $effect(() => {
    const id = fileId;
    error = null;

    void versions.load(id).catch((caught: unknown) => {
      error =
        caught instanceof ApiError && caught.status === 404
          ? 'That file does not exist, or you do not have access to it.'
          : apiMessage(caught);
    });
  });

  $effect(() => {
    const id = projectId;
    api
      .GET('/api/projects/{id}/members', { params: { path: { id } } })
      .then((result) => {
        const members = assertOk(result).members;
        names = Object.fromEntries(members.map((member) => [member.user_id, member.name]));
        canEdit = members.some(
          (member) => member.user_id === session.user?.id && member.role === 'editor'
        );
      })
      .catch(() => {
        // The file load owns the error message. Without the roster the history
        // still reads, which is the point of the screen.
        names = {};
        canEdit = false;
      });
  });

  $effect(() => {
    const id = projectId;
    realtime.subscribe(id);
    const off = realtime.on((event) => {
      if (event.project_id !== id) return;
      if (event.type === 'file_version_created') {
        if (event.data.file.id !== fileId) return;
        versions.applyVersion(event.data.file, event.data.version);
        return;
      }
      if (event.type === 'file_updated') {
        if (event.data.id !== fileId) return;
        versions.applyFile(event.data);
        return;
      }
      if (event.type === 'file_deleted') {
        if (event.data.id !== fileId) return;
        // A soft delete leaves the row and its history; a purge takes the bytes
        // for good, and the history on screen would go on offering to restore
        // versions that no longer exist.
        if (event.data.purged) {
          error = 'That file has been permanently deleted.';
          return;
        }
        versions.applyFile(event.data);
      }
    });

    return () => {
      off();
      realtime.unsubscribe(id);
    };
  });

  const pair = $derived(
    compare.length === 2
      ? compare
          .map((number) => history.find((version) => version.version_number === number))
          .filter((version) => version !== undefined)
          .sort((a, b) => a.version_number - b.version_number)
      : null
  );

  function toggleCompare(number: number): void {
    compare = compare.includes(number)
      ? compare.filter((value) => value !== number)
      : [...compare, number].slice(-2);
  }

  function who(userId: string): string {
    return names[userId] ?? 'Someone no longer on this project';
  }

  function when(timestamp: string): string {
    return new Date(timestamp).toLocaleString();
  }

  // An older version saved under the file's own name lands beside the current
  // one as "card (1).png", which says nothing about which version it is.
  function savedAs(filename: string, versionNumber: number, current: boolean): string {
    if (current) return filename;
    const dot = filename.lastIndexOf('.');
    if (dot <= 0) return `${filename}.v${versionNumber}`;
    return `${filename.slice(0, dot)}.v${versionNumber}${filename.slice(dot)}`;
  }

  async function download(versionNumber: number, current: boolean) {
    if (!file) return;
    try {
      await downloadFile(file.id, savedAs(file.filename, versionNumber, current), versionNumber);
    } catch (caught) {
      toasts.error(apiMessage(caught, 'Those bytes could not be downloaded.'));
    }
  }

  async function upload(list: FileList | null) {
    if (!file || !list || list.length === 0) return;
    busy = true;
    try {
      const created = await versions.upload(file.id, list[0]);
      await versions.refresh();
      if (created) toasts.success('Saved a new version.');
      else toasts.show('Those bytes are already the current version.');
    } catch (caught) {
      toasts.error(apiMessage(caught));
      await versions.refresh().catch(() => {});
    } finally {
      busy = false;
    }
  }

  async function restore(versionNumber: number) {
    if (!file) return;
    if (!confirm(`Restore version ${versionNumber} as the newest version of ${file.filename}?`)) {
      return;
    }

    busy = true;
    try {
      const created = await versions.restore(file.id, versionNumber);
      await versions.refresh();
      if (created) toasts.success(`Version ${versionNumber} is now the newest version.`);
      else toasts.show('That version is already the current one.');
    } catch (caught) {
      toasts.error(apiMessage(caught));
      await versions.refresh().catch(() => {});
    } finally {
      busy = false;
    }
  }
</script>

<div class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8" use:link>
  {#if error}
    <p role="alert" class="rounded-md border border-danger p-4 text-sm text-danger">{error}</p>
    <a class="focus-ring w-fit rounded underline" href="/projects/{projectId}">Back to files</a>
  {:else if !file}
    <Spinner label="Loading versions" />
  {:else}
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <div class="min-w-0">
        <h1 class="truncate text-2xl font-semibold">{file.filename}</h1>
        <p class="text-sm text-muted">
          Every version ever stored, newest first. Restoring one copies it forward. All of them
          count against project storage, and only deleting the file permanently gives that space
          back.
        </p>
      </div>
      <a class="focus-ring rounded px-3 py-2 text-sm underline" href={backHref}>{backLabel}</a>
    </div>

    {#if tombstoned}
      <p role="status" class="rounded-md border border-warning p-4 text-sm text-warning">
        This file is deleted. Every version below is still here and still downloadable, but nothing
        can be written to it until it is put back from
        <a class="focus-ring rounded underline" href="/projects/{projectId}/deleted">Deleted</a>.
      </p>
    {/if}

    {#if canEdit && !tombstoned}
      <div class="flex flex-wrap items-center gap-2">
        <Button onclick={() => fileInput?.click()} disabled={busy}>Upload new version</Button>
        {#if busy}<Spinner label="Working" />{/if}
        <input
          bind:this={fileInput}
          type="file"
          class="sr-only"
          aria-label="Bytes for a new version of {file.filename}"
          onchange={(event) => {
            const input = event.currentTarget;
            void upload(input.files).then(() => {
              // Cleared so re-picking the same file fires change again.
              input.value = '';
            });
          }}
        />
      </div>
    {/if}

    {#if pair && pair.length === 2}
      <section class="flex flex-col gap-3 rounded-md border border-edge bg-surface p-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-lg font-semibold">
            Version {pair[0].version_number} and version {pair[1].version_number}
          </h2>
          <Button variant="ghost" onclick={() => (compare = [])}>Clear comparison</Button>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          {#each pair as side (side.version_number)}
            <div class="flex flex-col gap-2">
              <Thumbnail
                fileId={file.id}
                version={side.version_number}
                class="h-64 w-full"
                fit="contain"
                alt="Version {side.version_number} of {file.filename}"
              />
              <p class="flex items-center gap-2 font-medium">
                Version {side.version_number}
                {#if side.is_current}
                  <span class="rounded-full bg-accent px-2 py-0.5 text-xs text-on-accent">
                    Current
                  </span>
                {/if}
              </p>
              <p class="text-sm text-muted">
                {formatBytes(side.byte_size)} · {side.content_type} ·
                <time datetime={side.created_at}>{when(side.created_at)}</time>
                · {who(side.created_by)}
              </p>
              <div>
                <Button
                  variant="secondary"
                  aria-label="Download version {side.version_number} of {file.filename} for comparison"
                  onclick={() => download(side.version_number, side.is_current)}
                >
                  Download
                </Button>
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <ul class="flex flex-col divide-y divide-edge rounded-md border border-edge bg-surface">
      {#each history as version (version.version_number)}
        <li class="flex flex-wrap items-center justify-between gap-3 p-3">
          <div class="min-w-0">
            <p class="flex items-center gap-2 font-medium">
              Version {version.version_number}
              {#if version.is_current}
                <span class="rounded-full bg-accent px-2 py-0.5 text-xs text-on-accent">
                  Current
                </span>
              {/if}
            </p>
            <p class="text-sm text-muted">
              {formatBytes(version.byte_size)} · {version.content_type} ·
              <time datetime={version.created_at}>{when(version.created_at)}</time>
              · {who(version.created_by)}
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              aria-pressed={compare.includes(version.version_number)}
              aria-label="Compare version {version.version_number} of {file.filename}"
              onclick={() => toggleCompare(version.version_number)}
            >
              {compare.includes(version.version_number) ? 'Comparing' : 'Compare'}
            </Button>
            <Button
              variant="secondary"
              aria-label="Download version {version.version_number} of {file.filename}"
              onclick={() => download(version.version_number, version.is_current)}
            >
              Download
            </Button>
            {#if canEdit && !tombstoned && !version.is_current}
              <Button
                variant="secondary"
                disabled={busy}
                aria-label="Restore version {version.version_number} of {file.filename}"
                onclick={() => restore(version.version_number)}
              >
                Restore
              </Button>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>
