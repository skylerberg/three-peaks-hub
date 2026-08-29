<script lang="ts">
  import {
    COMPONENT_KIND_INFO,
    COMPONENT_NAME_LIMITS,
    type ComponentKind,
  } from '@three-peaks/shared';
  import type { components as ApiComponents } from '@three-peaks/shared/api';
  import Thumbnail from '../components/Thumbnail.svelte';
  import Button from '../components/ui/Button.svelte';
  import Input from '../components/ui/Input.svelte';
  import Spinner from '../components/ui/Spinner.svelte';
  import { ApiError, api, assertOk } from '../api/client.ts';
  import { projectComponents } from '../lib/components.svelte.ts';
  import { realtime } from '../lib/realtime.svelte.ts';
  import { link, router } from '../lib/router.svelte.ts';
  import { apiMessage } from '../lib/session.svelte.ts';
  import { toasts } from '../lib/toasts.svelte.ts';

  // One section, which is one kind. The kinds are separate sections rather than
  // tabs of one because a project has one box and a dozen wooden pieces, and
  // navigating to a thing by what it is is the whole point of the arrangement.
  interface Props {
    projectId: string;
    kind: ComponentKind;
  }
  let { projectId, kind }: Props = $props();

  let project = $state<ApiComponents['schemas']['Project'] | null>(null);
  let error = $state<string | null>(null);
  let creating = $state(false);
  let newName = $state('');

  const info = $derived(COMPONENT_KIND_INFO[kind]);
  const canEdit = $derived(project?.role === 'editor');
  const list = $derived(projectComponents.list);

  $effect(() => {
    const id = projectId;
    error = null;
    api
      .GET('/api/projects/{id}', { params: { path: { id } } })
      .then((result) => {
        project = assertOk(result);
      })
      .catch((caught) => {
        error =
          caught instanceof ApiError && caught.status === 404
            ? 'That project does not exist, or you do not have access to it.'
            : apiMessage(caught);
      });
  });

  $effect(() => {
    projectComponents.loadList(projectId, kind).catch((caught) => toasts.error(apiMessage(caught)));
  });

  $effect(() => {
    const id = projectId;
    realtime.subscribe(id);
    const off = realtime.on((event) => {
      if (event.project_id !== id) return;
      if (event.type === 'component_created' || event.type === 'component_updated') {
        projectComponents.apply(event.data);
      } else if (event.type === 'component_deleted') {
        projectComponents.apply(event.data, true);
      }
    });
    return () => {
      off();
      realtime.unsubscribe(id);
    };
  });

  async function create(event: SubmitEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    try {
      const made = await projectComponents.create(projectId, kind, name);
      newName = '';
      creating = false;
      router.navigate(`/projects/${projectId}/components/${made.id}`);
    } catch (caught) {
      toasts.error(apiMessage(caught));
    }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Delete ${name}? Its artwork is kept, and Deleted can put it back.`)) return;
    try {
      await projectComponents.remove(id);
    } catch (caught) {
      toasts.error(apiMessage(caught));
    }
  }

  function artworkOf(component: ApiComponents['schemas']['Component']) {
    return component.files.find((entry) => entry.role === 'artwork')?.file ?? null;
  }
</script>

<div class="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8" use:link>
  {#if error}
    <p role="alert" class="rounded-md border border-danger p-4 text-sm text-danger">{error}</p>
    <a class="focus-ring rounded underline" href="/">Back to projects</a>
  {:else}
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h1 class="text-2xl font-semibold">{info.section}</h1>
      <a class="focus-ring rounded px-3 py-2 text-sm underline" href="/projects/{projectId}">
        Back to the project
      </a>
    </div>

    {#if canEdit}
      {#if creating}
        <form class="flex flex-wrap items-end gap-2" onsubmit={create}>
          <Input
            label="Name"
            bind:value={newName}
            maxlength={COMPONENT_NAME_LIMITS[1]}
            required
            autocomplete="off"
          />
          <Button type="submit">Create</Button>
          <Button variant="secondary" onclick={() => (creating = false)}>Cancel</Button>
        </form>
      {:else}
        <div>
          <Button onclick={() => (creating = true)}>New {info.singular}</Button>
        </div>
      {/if}
    {/if}

    {#if projectComponents.loadingList && list.length === 0}
      <Spinner label="Loading {info.section.toLowerCase()}" />
    {:else if list.length === 0}
      <p class="rounded-md border border-edge p-4 text-sm text-muted">
        No {info.section.toLowerCase()} yet. Each one is named first, and its artwork is uploaded into
        it afterwards.
      </p>
    {:else}
      <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {#each list as component (component.id)}
          {@const artwork = artworkOf(component)}
          <li class="flex flex-col gap-2 rounded-lg border border-edge bg-surface p-3">
            <a
              class="focus-ring flex flex-col gap-2 rounded"
              href="/projects/{projectId}/components/{component.id}"
            >
              <div class="flex h-28 items-center justify-center overflow-hidden rounded bg-canvas">
                {#if artwork}
                  <Thumbnail fileId={artwork.id} alt={component.name} />
                {:else}
                  <span class="text-xs text-muted">No artwork yet</span>
                {/if}
              </div>
              <span class="truncate text-sm font-medium">{component.name}</span>
            </a>
            {#if component.missing_roles.length > 0}
              <p class="text-xs text-warning">
                Waiting for {component.missing_roles.join(' and ')}
              </p>
            {/if}
            {#if canEdit}
              <div>
                <Button variant="secondary" onclick={() => remove(component.id, component.name)}>
                  Delete
                </Button>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>
