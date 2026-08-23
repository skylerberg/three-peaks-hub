<script lang="ts">
  import { MODEL_SOURCE_TYPES, isModelSource, type ModelSettings } from '@three-peaks/shared';
  import type { components } from '@three-peaks/shared/api';
  import CardSettings from '../components/model3d/CardSettings.svelte';
  import ModelViewer from '../components/model3d/ModelViewer.svelte';
  import WoodSettings from '../components/model3d/WoodSettings.svelte';
  import Button from '../components/ui/Button.svelte';
  import Spinner from '../components/ui/Spinner.svelte';
  import { ApiError, api, assertOk, authHeader } from '../api/client.ts';
  import { models } from '../lib/model3d.svelte.ts';
  import type { BuiltModel, SourceImage } from '../lib/model3d/index.ts';
  import { realtime } from '../lib/realtime.svelte.ts';
  import { link } from '../lib/router.svelte.ts';
  import { apiMessage } from '../lib/session.svelte.ts';
  import { toasts } from '../lib/toasts.svelte.ts';
  import { assertUploadSize } from '../lib/upload.ts';

  interface Props {
    projectId: string;
    fileId: string;
  }
  let { projectId, fileId }: Props = $props();

  type File = components['schemas']['File'];

  let project = $state<components['schemas']['Project'] | null>(null);
  let error = $state<string | null>(null);
  let source = $state<SourceImage | null>(null);
  let back = $state<SourceImage | null>(null);
  let siblings = $state<File[]>([]);
  let exporting = $state(false);
  let built: BuiltModel | null = null;

  const file = $derived(models.file);
  const settings = $derived(models.settings);
  const canEdit = $derived(project?.role === 'editor');
  const backChoices = $derived(siblings.filter((sibling) => sibling.id !== fileId));

  $effect(() => {
    const id = fileId;
    error = null;
    source = null;

    void models.load(id).catch((caught: unknown) => {
      error =
        caught instanceof ApiError && caught.status === 404
          ? 'That image does not exist, or you do not have access to it.'
          : apiMessage(caught);
    });
  });

  $effect(() => {
    const id = projectId;
    api
      .GET('/api/projects/{id}', { params: { path: { id } } })
      .then((result) => {
        project = assertOk(result);
      })
      .catch(() => {
        // The file load above owns the error message; a second toast for the
        // same missing project would only say it twice.
        project = null;
      });
  });

  // The bytes, not the row. Reloaded only when the file itself changes, because
  // decoding a megapixel image on every slider move would make the whole panel
  // feel broken.
  $effect(() => {
    const current = file;
    if (!current) return;

    let stale = false;
    void (async () => {
      try {
        const { loadSource } = await import('../lib/model3d/index.ts');
        const loaded = await loadSource(current.id, current.content_type);
        if (!stale) source = loaded;
      } catch (caught) {
        if (!stale) error = caught instanceof Error ? caught.message : 'Could not read the image.';
      }
    })();

    return () => {
      stale = true;
    };
  });

  $effect(() => {
    const backId = settings.kind === 'card' ? settings.back_file_id : null;
    if (!backId) {
      back = null;
      return;
    }

    let stale = false;
    void (async () => {
      try {
        const { loadSource } = await import('../lib/model3d/index.ts');
        const row = assertOk(
          await api.GET('/api/files/{id}', { params: { path: { id: backId } } })
        );
        const loaded = await loadSource(row.id, row.content_type);
        if (!stale) back = loaded;
      } catch {
        if (!stale) {
          back = null;
          toasts.error('That card back could not be read.');
        }
      }
    })();

    return () => {
      stale = true;
    };
  });

  // Only images can be a card back, and only from the folder this file is in --
  // one directory request rather than a walk of the whole project.
  $effect(() => {
    const current = file;
    if (!current) return;

    void api
      .GET('/api/files/directory', {
        params: {
          query: {
            project_id: current.project_id,
            ...(current.folder_id ? { folder_id: current.folder_id } : {}),
          },
        },
      })
      .then((result) => {
        siblings = assertOk(result).files.filter((row) => isModelSource(row.content_type));
      })
      .catch(() => {
        siblings = [];
      });
  });

  $effect(() => {
    const id = projectId;
    realtime.subscribe(id);
    const off = realtime.on((event) => {
      if (event.type !== 'model_updated') return;
      if (event.project_id !== id || event.file_id !== fileId) return;
      void models.load(fileId).catch(() => {});
    });

    return () => {
      off();
      realtime.unsubscribe(id);
    };
  });

  function change(patch: Partial<ModelSettings>): void {
    if (!canEdit) return;
    models.update(patch as Partial<ModelSettings>);
    models.scheduleSave();
  }

  function glbName(): string {
    const base = file?.filename.replace(/\.[^.]+$/, '') ?? 'component';
    return `${base}.glb`;
  }

  async function withGlb(action: (bytes: ArrayBuffer, filename: string) => Promise<void> | void) {
    if (!built) {
      toasts.error('There is no model to export yet.');
      return;
    }

    exporting = true;
    try {
      const { exportGlb } = await import('../lib/model3d/index.ts');
      await action(await exportGlb(built.group), glbName());
    } catch (caught) {
      toasts.error(apiMessage(caught, 'The model could not be exported.'));
    } finally {
      exporting = false;
    }
  }

  function download() {
    void withGlb((bytes, filename) => {
      const url = URL.createObjectURL(new Blob([bytes], { type: 'model/gltf-binary' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    });
  }

  function saveToProject() {
    void withGlb(async (bytes, filename) => {
      const current = file;
      if (!current) return;

      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- one query string, built here and thrown away
      const query = new URLSearchParams({ project_id: current.project_id, filename });
      if (current.folder_id) query.set('folder_id', current.folder_id);

      assertUploadSize(bytes.byteLength);
      const response = await fetch(`/api/files/upload?${query}`, {
        method: 'POST',
        headers: { 'Content-Type': 'model/gltf-binary', ...authHeader() },
        body: bytes,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new ApiError(response.status, body.error ?? 'The model could not be saved.');
      }

      toasts.success(`Saved ${filename} to this project.`);
    });
  }
</script>

<div class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8" use:link>
  {#if error}
    <p role="alert" class="rounded-md border border-danger p-4 text-sm text-danger">{error}</p>
    <a class="focus-ring rounded underline" href="/projects/{projectId}">Back to the project</a>
  {:else if models.loading || !file}
    <Spinner label="Loading image" />
  {:else if !isModelSource(file.content_type)}
    <p role="alert" class="rounded-md border border-edge p-4 text-sm">
      {file.filename} is a {file.content_type}. A 3D model can be made from
      {MODEL_SOURCE_TYPES.join(', ')}.
    </p>
    <a class="focus-ring rounded underline" href="/projects/{projectId}">Back to the project</a>
  {:else}
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <h1 class="text-2xl font-semibold">{file.filename}</h1>
        <p class="text-sm text-muted">
          {#if models.saving}
            Saving settings…
          {:else if canEdit}
            Settings are saved to this project as you change them.
          {:else}
            You have read-only access to this project.
          {/if}
        </p>
      </div>
      <a
        class="focus-ring rounded px-3 py-2 text-sm underline"
        href="/projects/{projectId}{file.folder_id ? `?folder=${file.folder_id}` : ''}"
      >
        Back to files
      </a>
    </div>

    <div class="grid gap-6 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div class="flex flex-col gap-3">
        <ModelViewer {settings} {source} {back} onbuild={(model) => (built = model)} />
        <div class="flex flex-wrap gap-2">
          <Button variant="secondary" onclick={download} disabled={exporting}>Download .glb</Button>
          {#if canEdit}
            <Button onclick={saveToProject} disabled={exporting}>Save to project</Button>
          {/if}
        </div>
      </div>

      <div class="flex flex-col gap-4 rounded-lg border border-edge bg-surface p-4">
        <fieldset class="flex flex-col gap-2">
          <legend class="text-sm font-medium">Component type</legend>
          <div class="flex gap-2">
            <Button
              variant={settings.kind === 'card' ? 'primary' : 'secondary'}
              disabled={!canEdit}
              aria-pressed={settings.kind === 'card'}
              onclick={() => {
                models.setKind('card');
                models.scheduleSave();
              }}
            >
              Card
            </Button>
            <Button
              variant={settings.kind === 'wood' ? 'primary' : 'secondary'}
              disabled={!canEdit}
              aria-pressed={settings.kind === 'wood'}
              onclick={() => {
                models.setKind('wood');
                models.scheduleSave();
              }}
            >
              Wooden component
            </Button>
          </div>
        </fieldset>

        {#if settings.kind === 'card'}
          <CardSettings {settings} {backChoices} disabled={!canEdit} onchange={change} />
        {:else}
          <WoodSettings
            {settings}
            vector={file.content_type === 'image/svg+xml'}
            disabled={!canEdit}
            onchange={change}
          />
        {/if}
      </div>
    </div>
  {/if}
</div>
