<script lang="ts">
  import { COMPONENT_KINDS, COMPONENT_KIND_INFO } from '@three-peaks/shared';
  import Spinner from '../components/ui/Spinner.svelte';
  import { ApiError, api, assertOk } from '../api/client.ts';
  import type { Project } from '../lib/projects.svelte.ts';
  import { apiMessage } from '../lib/session.svelte.ts';
  import { link } from '../lib/router.svelte.ts';
  import { toasts } from '../lib/toasts.svelte.ts';

  // The project's front door, and a list of the places things are. Everything
  // in a project is one of these: a deck, a component of some kind, or a loose
  // asset -- so the way in is by what a thing is rather than by which folder
  // somebody happened to put it in.
  interface Props {
    projectId: string;
  }
  let { projectId }: Props = $props();

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
        // 404 covers both "does not exist" and "you cannot see it", by design.
        error =
          caught instanceof ApiError && caught.status === 404
            ? 'That project does not exist, or you do not have access to it.'
            : apiMessage(caught);
        toasts.error(error);
      });
  });

  const sections = $derived.by(() => {
    const open = project;
    return open
      ? [
          {
            href: `/projects/${open.id}/decks`,
            title: 'Decks',
            blurb: 'Cards, their order and copy counts, and the artwork each deck holds.',
          },
          ...COMPONENT_KINDS.map((kind) => ({
            href: `/projects/${open.id}/components/${kind}`,
            title: COMPONENT_KIND_INFO[kind].section,
            blurb: `Every ${COMPONENT_KIND_INFO[kind].singular} in the project, with its own artwork and its 3D dial-in.`,
          })),
          {
            href: `/projects/${open.id}/assets`,
            title: 'Assets',
            blurb: 'Files that belong to no deck and no component, in folders of your own.',
          },
        ]
      : [];
  });
</script>

<div class="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8" use:link>
  {#if error}
    <p role="alert" class="rounded-md border border-danger p-4 text-sm text-danger">{error}</p>
    <a class="focus-ring rounded underline" href="/">Back to projects</a>
  {:else if !project}
    <Spinner label="Loading project" />
  {:else}
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h1 class="text-2xl font-semibold">{project.name}</h1>
        {#if project.description}
          <p class="text-sm text-muted">{project.description}</p>
        {/if}
      </div>
      <div class="flex items-center gap-1">
        <a
          class="focus-ring rounded px-3 py-2 text-sm underline"
          href="/projects/{project.id}/print"
        >
          Print
        </a>
        <a
          class="focus-ring rounded px-3 py-2 text-sm underline"
          href="/projects/{project.id}/scene"
        >
          Blender scene
        </a>
        <a
          class="focus-ring rounded px-3 py-2 text-sm underline"
          href="/projects/{project.id}/members"
        >
          Members
        </a>
        <a
          class="focus-ring rounded px-3 py-2 text-sm underline"
          href="/projects/{project.id}/deleted"
        >
          Deleted
        </a>
      </div>
    </div>

    <ul class="grid gap-3 sm:grid-cols-2">
      {#each sections as section (section.href)}
        <li>
          <a
            class="focus-ring flex min-h-11 flex-col gap-1 rounded-lg border border-edge bg-surface p-4 hover:bg-accent-soft"
            href={section.href}
          >
            <span class="font-medium">{section.title}</span>
            <span class="text-sm text-muted">{section.blurb}</span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</div>
