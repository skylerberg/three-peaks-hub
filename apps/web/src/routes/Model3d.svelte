<script lang="ts">
  import { MODEL_SOURCE_TYPES, isModelSource, type ModelSettings } from '@three-peaks/shared';
  import type { components } from '@three-peaks/shared/api';
  import Studio from '../components/model3d/Studio.svelte';
  import Spinner from '../components/ui/Spinner.svelte';
  import { ApiError, api, assertOk, authHeader } from '../api/client.ts';
  import { models } from '../lib/model3d.svelte.ts';
  import type { ModelSources } from '../lib/model3d/index.ts';
  import { realtime } from '../lib/realtime.svelte.ts';
  import { link, router } from '../lib/router.svelte.ts';
  import { apiMessage } from '../lib/session.svelte.ts';
  import { toasts } from '../lib/toasts.svelte.ts';
  import { assertUploadSize, readUploadResponse } from '../lib/upload.ts';

  // One card of one deck, dialled in. The kind is not a choice here: a card is
  // a member of a deck, and everything else is a component with a section of
  // its own. What this screen owns is the card's own dial-in, which hangs off
  // the image the way its versions do.
  interface Props {
    projectId: string;
    fileId: string;
  }
  let { projectId, fileId }: Props = $props();

  type File = components['schemas']['File'];

  let project = $state<components['schemas']['Project'] | null>(null);
  let error = $state<string | null>(null);
  let artwork = $state<ModelSources['artwork'] | null>(null);
  let back = $state<ModelSources['artwork'] | null>(null);
  let siblings = $state<File[]>([]);

  const file = $derived(models.file);
  const settings = $derived(models.settings);
  // This screen is one card of one deck. A file that is neither belongs to
  // somebody else's screen, and dialling it in here would write settings no
  // screen ever reads back.
  const stranded = $derived(file !== null && file.deck_id === null && file.component_id === null);
  const canEdit = $derived(project?.role === 'editor');
  const backChoices = $derived(siblings.filter((sibling) => sibling.id !== fileId));
  const sources = $derived(artwork ? { artwork, back } : null);

  $effect(() => {
    const id = fileId;
    error = null;
    artwork = null;

    void models.load(id).catch((caught: unknown) => {
      error =
        caught instanceof ApiError && caught.status === 404
          ? 'That image does not exist, or you do not have access to it.'
          : apiMessage(caught);
    });
  });

  // A component's artwork has a studio of its own, and this is the URL an old
  // bookmark or a cached bundle points at. Sending it on beats showing a
  // dial-in that saves into a row nothing reads.
  $effect(() => {
    const componentId = file?.component_id;
    if (componentId) router.redirect(`/projects/${projectId}/components/${componentId}`);
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
        if (!stale) artwork = loaded;
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

  // The other cards of the same deck, which is the whole of what this card's
  // reverse can be: a deck's images are its own, and one from Assets is not in
  // this deck until it is moved in.
  $effect(() => {
    const current = file;
    if (!current?.deck_id) {
      siblings = [];
      return;
    }

    void api
      .GET('/api/decks/{deckId}', { params: { path: { deckId: current.deck_id } } })
      .then((result) => {
        siblings = assertOk(result)
          .cards.map((card) => card.file)
          .filter((row) => isModelSource(row.content_type));
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
      if (event.project_id !== id || event.data.source_file_id !== fileId) return;
      models.applySettings(event.data.settings);
    });

    return () => {
      off();
      realtime.unsubscribe(id);
    };
  });

  function change(patch: Partial<ModelSettings>): void {
    if (!canEdit) return;
    models.update(patch);
    models.scheduleSave();
  }

  const deckHref = $derived(
    file?.deck_id ? `/projects/${projectId}/decks/${file.deck_id}` : `/projects/${projectId}`
  );

  // Into the same deck the card is in, which is where its artwork already
  // lives: a .glb dropped into Assets would be the one file about this card
  // that is somewhere else.
  async function saveToProject(bytes: ArrayBuffer, filename: string): Promise<void> {
    const current = file;
    if (!current) return;

    const query = new URLSearchParams({ project_id: current.project_id, filename });

    assertUploadSize(bytes.byteLength);
    const response = await fetch(`/api/files/upload?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'model/gltf-binary', ...authHeader() },
      body: bytes,
    });

    await readUploadResponse(response, 'The model could not be saved.');
    toasts.success(`Saved ${filename} to Assets.`);
  }
</script>

<div class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8" use:link>
  {#if error}
    <p role="alert" class="rounded-md border border-danger p-4 text-sm text-danger">{error}</p>
    <a class="focus-ring rounded underline" href="/projects/{projectId}">Back to the project</a>
  {:else if models.loading || !file}
    <Spinner label="Loading image" />
  {:else if stranded}
    <p role="alert" class="rounded-md border border-edge p-4 text-sm">
      {file.filename} is not a card in a deck. Move it into one to dial it in, or make a component out
      of it.
    </p>
    <a class="focus-ring rounded underline" href="/projects/{projectId}/assets">Back to Assets</a>
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
      <a class="focus-ring rounded px-3 py-2 text-sm underline" href={deckHref}>
        {file.deck_id ? 'Back to the deck' : 'Back to the project'}
      </a>
    </div>

    <Studio
      {settings}
      {sources}
      {canEdit}
      {backChoices}
      onchange={change}
      exportName={file.filename.replace(/\.[^.]+$/, '')}
      onsave={saveToProject}
    />
  {/if}
</div>
