<script lang="ts">
  import { formatBytes } from '@three-peaks/shared';
  import Button from '../components/ui/Button.svelte';
  import Spinner from '../components/ui/Spinner.svelte';
  import { ApiError, api, assertOk } from '../api/client.ts';
  import { type DeletedEntry, deleted, isNameConflict } from '../lib/deleted.svelte.ts';
  import { realtime } from '../lib/realtime.svelte.ts';
  import { link } from '../lib/router.svelte.ts';
  import { apiMessage, session } from '../lib/session.svelte.ts';
  import { toasts } from '../lib/toasts.svelte.ts';

  interface Props {
    projectId: string;
  }
  let { projectId }: Props = $props();

  let error = $state<string | null>(null);
  let busy = $state(false);
  // The roster answers both halves of this screen at once: the name behind each
  // deletion, and whether this account may undo one.
  let names = $state<Record<string, string>>({});
  let canEdit = $state(false);

  const entries = $derived(deleted.entries);

  $effect(() => {
    const id = projectId;
    error = null;

    void deleted.load(id).catch((caught: unknown) => {
      error =
        caught instanceof ApiError && caught.status === 404
          ? 'That project does not exist, or you do not have access to it.'
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
        // The listing owns the error message. Reading what was deleted does not
        // need the roster, so a failure here costs only the names.
        names = {};
        canEdit = false;
      });
  });

  $effect(() => {
    const id = projectId;
    realtime.subscribe(id);
    const off = realtime.on((event) => {
      if (event.project_id !== id) return;
      void deleted.refresh().catch(() => {});
    });
    return () => {
      off();
      realtime.unsubscribe(id);
    };
  });

  function who(userId: string | null): string {
    if (userId === null) return 'Someone whose account is gone';
    return names[userId] ?? 'Someone no longer on this project';
  }

  function when(timestamp: string): string {
    return new Date(timestamp).toLocaleString();
  }

  function where(entry: DeletedEntry): string {
    return entry.path || 'Files';
  }

  // The obvious second name to try, with a file's extension left where a reader
  // expects to find it.
  function suffixed(entry: DeletedEntry): string {
    const dot = entry.kind === 'file' ? entry.name.lastIndexOf('.') : -1;
    if (dot <= 0) return `${entry.name} (restored)`;
    return `${entry.name.slice(0, dot)} (restored)${entry.name.slice(dot)}`;
  }

  async function send(entry: DeletedEntry, name: string | undefined): Promise<void> {
    if (entry.kind === 'file') await deleted.restoreFile(entry.id, name);
    else await deleted.restoreFolder(entry.id, name);
  }

  async function restore(entry: DeletedEntry) {
    busy = true;
    try {
      try {
        await send(entry, undefined);
        toasts.success(`${entry.name} is back in ${where(entry)}.`);
      } catch (caught) {
        // A taken name is the only refusal a prompt can get past. Offering one
        // for a folder standing in the way would ask for a second answer to a
        // question the first answer never reached.
        if (!isNameConflict(caught)) throw caught;
        const chosen = prompt(
          `${caught.message}.\n\nRestore ${entry.name} under a different name, or cancel.`,
          suffixed(entry)
        );
        if (!chosen?.trim()) {
          toasts.error(caught.message);
          return;
        }
        await send(entry, chosen.trim());
        toasts.success(`${entry.name} is back in ${where(entry)} as ${chosen.trim()}.`);
      }
    } catch (caught) {
      toasts.error(apiMessage(caught));
    } finally {
      await deleted.refresh().catch(() => {});
      busy = false;
    }
  }

  // A folder purge is the one action here that destroys something nobody
  // deleted, so the question has to say that rather than warn in the abstract.
  function purgeQuestion(entry: DeletedEntry): string {
    return entry.kind === 'folder'
      ? `Permanently delete the folder ${entry.name}? Everything still inside it goes too, ` +
          'including files nobody deleted, and none of it can be brought back.'
      : `Permanently delete ${entry.name}? Every version of it goes too, and none of it can be brought back.`;
  }

  async function purge(entry: DeletedEntry) {
    if (!confirm(purgeQuestion(entry))) return;
    busy = true;
    try {
      if (entry.kind === 'file') await deleted.purgeFile(entry.id);
      else await deleted.purgeFolder(entry.id);
      toasts.success(`${entry.name} is gone, and its space is back.`);
    } catch (caught) {
      toasts.error(apiMessage(caught));
    } finally {
      await deleted.refresh().catch(() => {});
      busy = false;
    }
  }
</script>

<div class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8" use:link>
  {#if error}
    <p role="alert" class="rounded-md border border-danger p-4 text-sm text-danger">{error}</p>
    <a class="focus-ring w-fit rounded underline" href="/projects/{projectId}">Back to files</a>
  {:else}
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <div class="min-w-0">
        <h1 class="text-2xl font-semibold">Deleted</h1>
        <p class="text-sm text-muted">
          Newest first. Nothing here has lost its bytes or its history, so all of it still counts
          against project storage; deleting something permanently is what gives that space back.
        </p>
      </div>
      <a class="focus-ring rounded px-3 py-2 text-sm underline" href="/projects/{projectId}">
        Back to files
      </a>
    </div>

    {#if deleted.loading && entries.length === 0}
      <Spinner label="Loading deleted files" />
    {:else if entries.length === 0}
      <p class="rounded-md border border-edge bg-surface p-8 text-center text-muted">
        Nothing in this project has been deleted.
      </p>
    {:else}
      <ul class="flex flex-col divide-y divide-edge rounded-md border border-edge bg-surface">
        {#each entries as entry (`${entry.kind}:${entry.id}`)}
          <li class="flex flex-wrap items-center justify-between gap-3 p-3">
            <div class="min-w-0">
              <p class="flex items-center gap-2 font-medium">
                <span aria-hidden="true">{entry.kind === 'folder' ? '📁' : '📄'}</span>
                <span class="truncate">{entry.name}</span>
              </p>
              <p class="text-sm text-muted">
                {#if entry.kind === 'folder'}
                  Folder
                {:else}
                  {formatBytes(entry.byte_size ?? 0)} · {entry.content_type}
                {/if}
                · in {where(entry)} ·
                <time datetime={entry.deleted_at}>{when(entry.deleted_at)}</time>
                · {who(entry.deleted_by)}
              </p>
              {#if entry.blocked_by !== null}
                <p class="text-sm text-warning">
                  Blocked by {entry.blocked_by}. Restore that first.
                </p>
              {/if}
            </div>
            {#if canEdit}
              <div class="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  disabled={busy || entry.blocked_by !== null}
                  aria-label="Restore {entry.name}"
                  onclick={() => restore(entry)}
                >
                  Restore
                </Button>
                <Button
                  variant="danger"
                  disabled={busy}
                  aria-label="Permanently delete {entry.name}"
                  onclick={() => purge(entry)}
                >
                  Delete permanently
                </Button>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>
