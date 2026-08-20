<script lang="ts">
  import Button from '../components/ui/Button.svelte';
  import Spinner from '../components/ui/Spinner.svelte';
  import { ApiError, api, assertOk } from '../api/client.ts';
  import type { ProjectMember } from '../lib/projects.svelte.ts';
  import { apiMessage } from '../lib/session.svelte.ts';
  import { link } from '../lib/router.svelte.ts';
  import { toasts } from '../lib/toasts.svelte.ts';

  interface Props {
    projectId: string;
  }
  let { projectId }: Props = $props();

  let members = $state<ProjectMember[] | null>(null);
  let email = $state('');
  let role = $state<'editor' | 'viewer'>('viewer');
  let busy = $state(false);

  async function load() {
    try {
      const data = assertOk(
        await api.GET('/api/projects/{id}/members', { params: { path: { id: projectId } } })
      );
      members = data.members;
    } catch (error) {
      toasts.error(apiMessage(error));
    }
  }

  $effect(() => {
    void load();
  });

  async function add(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    try {
      assertOk(
        await api.PUT('/api/projects/{id}/members', {
          params: { path: { id: projectId } },
          body: { email: email.trim(), role },
        })
      );
      email = '';
      await load();
    } catch (error) {
      const status = error instanceof ApiError ? error.status : undefined;
      toasts.error(
        status === 404
          ? 'No account with that email.'
          : status === 403
            ? 'Only the project owner can change membership.'
            : apiMessage(error)
      );
    } finally {
      busy = false;
    }
  }

  async function remove(userId: string) {
    try {
      assertOk(
        await api.DELETE('/api/projects/{id}/members/{userId}', {
          params: { path: { id: projectId, userId } },
        })
      );
      await load();
    } catch (error) {
      toasts.error(apiMessage(error));
    }
  }
</script>

<div class="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8" use:link>
  <a class="focus-ring w-fit rounded text-sm underline" href="/projects/{projectId}">
    Back to files
  </a>
  <h1 class="text-2xl font-semibold">Members</h1>

  <form class="flex flex-wrap items-end gap-2" onsubmit={add}>
    <label class="flex flex-1 flex-col gap-1 text-sm">
      <span class="font-medium">Add by email</span>
      <input
        bind:value={email}
        type="email"
        class="focus-ring min-h-11 rounded-md border border-edge bg-surface px-3 text-sm"
      />
    </label>
    <label class="flex flex-col gap-1 text-sm">
      <span class="font-medium">Role</span>
      <select
        bind:value={role}
        class="focus-ring min-h-11 rounded-md border border-edge bg-surface px-3 text-sm"
      >
        <option value="viewer">Viewer</option>
        <option value="editor">Editor</option>
      </select>
    </label>
    <Button type="submit" disabled={busy || !email.trim()}>Add</Button>
  </form>

  {#if !members}
    <Spinner label="Loading members" />
  {:else}
    <ul class="flex flex-col divide-y divide-edge rounded-md border border-edge bg-surface">
      {#each members as member (member.user_id)}
        <li class="flex items-center justify-between gap-4 p-3">
          <div class="min-w-0">
            <p class="truncate font-medium">{member.name}</p>
            <p class="truncate text-sm text-muted">{member.email}</p>
          </div>
          <div class="flex items-center gap-3">
            <span class="text-sm text-muted">
              {member.is_creator ? 'Owner' : member.role === 'editor' ? 'Editor' : 'Viewer'}
            </span>
            {#if !member.is_creator}
              <button
                type="button"
                class="focus-ring rounded px-2 py-1 text-sm text-muted hover:text-danger"
                onclick={() => remove(member.user_id)}
              >
                Remove
              </button>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>
