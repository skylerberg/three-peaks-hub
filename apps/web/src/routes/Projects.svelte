<script lang="ts">
  import Button from '../components/ui/Button.svelte';
  import Input from '../components/ui/Input.svelte';
  import Spinner from '../components/ui/Spinner.svelte';
  import { apiMessage } from '../lib/session.svelte.ts';
  import { projects } from '../lib/projects.svelte.ts';
  import { link } from '../lib/router.svelte.ts';
  import { toasts } from '../lib/toasts.svelte.ts';

  let creating = $state(false);
  let newName = $state('');
  let busy = $state(false);
  let loadError = $state<string | null>(null);

  // Reads nothing reactive on purpose: this asks once, when the screen appears.
  $effect(() => {
    void attemptLoad();
  });

  async function attemptLoad(again = false): Promise<void> {
    loadError = null;
    try {
      await (again ? projects.reload() : projects.ensureLoaded());
    } catch (error) {
      loadError = apiMessage(error);
      toasts.error(loadError);
    }
  }

  async function create(event: SubmitEvent) {
    event.preventDefault();
    if (!newName.trim()) return;

    busy = true;
    try {
      await projects.create(newName.trim());
      newName = '';
      creating = false;
    } catch (error) {
      toasts.error(apiMessage(error));
    } finally {
      busy = false;
    }
  }
</script>

<div class="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8" use:link>
  <div class="flex items-center justify-between gap-4">
    <h1 class="text-2xl font-semibold">Projects</h1>
    <Button onclick={() => (creating = !creating)}>
      {creating ? 'Cancel' : 'New project'}
    </Button>
  </div>

  {#if creating}
    <form
      class="flex flex-col gap-3 rounded-md border border-edge bg-surface p-4"
      onsubmit={create}
    >
      <Input label="Project name" bind:value={newName} placeholder="Colori" />
      <div>
        <Button type="submit" disabled={busy || !newName.trim()}>
          {busy ? 'Creating…' : 'Create project'}
        </Button>
      </div>
    </form>
  {/if}

  {#if projects.loading && projects.projects.length === 0}
    <Spinner label="Loading projects" />
  {:else if projects.projects.length === 0 && loadError}
    <div class="flex flex-col items-start gap-3 rounded-md border border-danger p-4">
      <p role="alert" class="text-sm text-danger">{loadError}</p>
      <Button variant="secondary" onclick={() => attemptLoad(true)}>Try again</Button>
    </div>
  {:else if projects.projects.length === 0}
    <p class="rounded-md border border-dashed border-edge p-8 text-center text-muted">
      No projects yet. Create one to start uploading files.
    </p>
  {:else}
    <ul class="grid gap-3 sm:grid-cols-2">
      {#each projects.projects as project (project.id)}
        <li>
          <a
            href="/projects/{project.id}"
            class="focus-ring flex min-h-11 flex-col gap-1 rounded-md border border-edge bg-surface
                   p-4 transition-colors hover:bg-accent-soft"
          >
            <span class="font-medium">{project.name}</span>
            {#if project.description}
              <span class="line-clamp-2 text-sm text-muted">{project.description}</span>
            {/if}
            <span class="text-xs text-muted">
              {project.role === 'editor' ? 'Editor' : 'Viewer'}
            </span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</div>
