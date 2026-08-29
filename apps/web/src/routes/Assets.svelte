<script lang="ts">
  import FileExplorer from '../components/FileExplorer.svelte';
  import Spinner from '../components/ui/Spinner.svelte';
  import { ApiError, api, assertOk } from '../api/client.ts';
  import type { Project } from '../lib/projects.svelte.ts';
  import { apiMessage } from '../lib/session.svelte.ts';
  import { link } from '../lib/router.svelte.ts';
  import { toasts } from '../lib/toasts.svelte.ts';

  // Everything in the project that belongs to no deck and no component: the
  // reference art, the rules draft, the logo. What a deck or a component holds
  // is on its own screen and not here as well.
  interface Props {
    projectId: string;
    folderId: string | null;
  }
  let { projectId, folderId }: Props = $props();

  let project = $state<Project | null>(null);
  let error = $state<string | null>(null);

  $effect(() => {
    const id = projectId;
    project = null;
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
        toasts.error(error);
      });
  });
</script>

<div class="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8" use:link>
  {#if error}
    <p role="alert" class="rounded-md border border-danger p-4 text-sm text-danger">{error}</p>
    <a class="focus-ring rounded underline" href="/">Back to projects</a>
  {:else if !project}
    <Spinner label="Loading project" />
  {:else}
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <h1 class="text-2xl font-semibold">Assets</h1>
        <p class="text-sm text-muted">
          Files that belong to no deck and no component. Organise them into folders however suits.
        </p>
      </div>
      <a class="focus-ring rounded px-3 py-2 text-sm underline" href="/projects/{project.id}">
        Back to the project
      </a>
    </div>

    <FileExplorer projectId={project.id} {folderId} canEdit={project.role === 'editor'} />
  {/if}
</div>
