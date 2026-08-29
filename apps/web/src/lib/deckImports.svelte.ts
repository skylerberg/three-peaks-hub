import type { components } from '@three-peaks/shared/api';
import { normalizeSourceLabel } from '@three-peaks/shared';
import { ApiError, api, apiMessage, assertOk, authHeader } from '../api/client.ts';
import type { CanvaPage } from './canva/pages.ts';
import { readCanvaExport } from './canva/pages.ts';
import { ZipError } from './canva/zip.ts';
import { newId } from './ids.ts';
import { readUploadResponse } from './upload.ts';

type DeckImport = components['schemas']['DeckImport'];
type ImportRun = components['schemas']['ImportRun'];
type ImportRunDetail = components['schemas']['ImportRunDetail'];
// The plan appears only nested inside the started run, so the spec has no named
// component for it; derived rather than restated.
type ImportPlan = components['schemas']['StartedImportRun']['plan'];

type ImportStatus =
  'idle' | 'reading' | 'planning' | 'confirming' | 'importing' | 'finishing' | 'done';

interface PageSummary {
  page_number: number;
  title: string | null;
}

function pageCount(pages: number): string {
  return `${pages} ${pages === 1 ? 'page' : 'pages'}`;
}

class DeckImportStore {
  // What this deck was last imported from, and whether a run is open. Null is
  // a deck nothing has ever been imported into, which is not a state anybody
  // has to fix: the artwork goes into the deck itself.
  binding = $state<DeckImport | null>(null);
  loadingBinding = $state(false);

  run = $state<ImportRun | null>(null);
  plan = $state<ImportPlan | null>(null);
  pageList = $state<PageSummary[]>([]);
  posted = $state(0);
  summary = $state<ImportRunDetail | null>(null);
  openRun = $state<{ run_id: string; started_at: string } | null>(null);
  // Which deck the run, the plan and the summary above belong to. The store is
  // one instance and an unconfirmed plan outlives the screen that made it, so
  // without this the next deck's screen adopts it and imports into this one.
  runDeckId = $state<string | null>(null);
  // The same scope for the import row, which is read per deck and holds the id
  // of the open run a screen offers to resume or discard. Cleared before the
  // read rather than only overwritten after it, so nothing downstream can be
  // handed the deck just left while the next one is still on the wire.
  bindingDeckId = $state<string | null>(null);
  status = $state<ImportStatus>('idle');
  error = $state<string | null>(null);

  #projectId: string | null = null;
  #deckId: string | null = null;
  // Plain, not $state: each page closes over the whole export, and a proxy
  // around every Uint8Array would be deep-cloned by any snapshot of it. Only
  // the flat pageList above is reactive.
  #pages: CanvaPage[] | null = null;
  #file: File | null = null;
  #cancelled = false;
  // One counter per kind, so reloading the binding cannot cancel a run that is
  // halfway through uploading.
  #bindingGeneration = 0;
  #runGeneration = 0;

  // A run opening and closing is the only thing about this row that moves, so
  // it is derived from the run event rather than announced twice.
  applyOpenRun(deckId: string, runId: string | null): void {
    if (this.bindingDeckId !== deckId || !this.binding) return;
    this.binding = { ...this.binding, open_run_id: runId };
  }

  async loadBinding(projectId: string, deckId: string): Promise<void> {
    this.#bindingGeneration += 1;
    const generation = this.#bindingGeneration;
    this.#projectId = projectId;
    this.#deckId = deckId;
    this.bindingDeckId = null;
    this.binding = null;
    this.loadingBinding = true;

    try {
      const binding = await this.#readBinding(deckId);
      if (generation !== this.#bindingGeneration) return;
      this.binding = binding;
      this.bindingDeckId = deckId;
    } finally {
      if (generation === this.#bindingGeneration) this.loadingBinding = false;
    }
  }

  async readExport(file: File): Promise<void> {
    this.error = null;
    this.status = 'reading';
    this.run = null;
    this.plan = null;
    this.summary = null;
    this.posted = 0;

    try {
      const pages = await readCanvaExport(file);
      this.#file = file;
      this.#pages = pages;
      this.pageList = pages.map((page) => ({ page_number: page.page_number, title: page.title }));
    } catch (caught) {
      this.#pages = null;
      this.#file = null;
      this.pageList = [];
      // A refusal belongs on the screen, next to the control that caused it,
      // rather than in a toast that scrolls away while it is being read.
      this.error =
        caught instanceof ZipError
          ? caught.message
          : 'That file could not be read. Download the export from Canva again.';
    } finally {
      this.status = 'idle';
    }
  }

  async startRun(deckId: string): Promise<void> {
    const pages = this.#pages;
    if (!pages) return;

    this.#runGeneration += 1;
    const generation = this.#runGeneration;
    this.error = null;
    this.openRun = null;
    this.runDeckId = null;
    this.status = 'planning';

    try {
      const started = assertOk(
        await api.POST('/api/decks/{deckId}/import/runs', {
          params: { path: { deckId } },
          body: {
            id: newId(),
            source_label: normalizeSourceLabel(this.#file?.name),
            // A page with no title sends no title key at all: null and the
            // empty string are both 422s on the manifest.
            pages: pages.map((page) => ({
              page_number: page.page_number,
              ...(page.title === null ? {} : { title: page.title }),
            })),
          },
        })
      );
      if (generation !== this.#runGeneration) return;
      const { plan, ...run } = started;
      this.run = run;
      this.plan = plan;
      this.runDeckId = deckId;
      this.posted = 0;
      this.status = 'confirming';
    } catch (caught) {
      if (generation !== this.#runGeneration) return;
      // The open run named by the refusal is this deck's, and the scope above
      // is what keeps the next deck's screen from offering to discard it.
      if (this.#readOpenRun(caught)) this.runDeckId = deckId;
      this.error = apiMessage(caught);
      this.status = 'idle';
    }
  }

  async confirm(deckId: string): Promise<void> {
    const run = this.run;
    const pages = this.#pages;
    if (!run || !pages || this.runDeckId !== deckId) return;
    await this.#uploadAndFinish(run.id, pages);
  }

  // Resuming re-reads the same export: the plan lives in the run's own rows and
  // no route hands it back, so the pages that have not landed yet are the ones
  // this file has and the run's detail does not.
  async resume(deckId: string, runId: string, file: File): Promise<void> {
    this.error = null;
    let done: Set<number>;
    let planned: number;

    try {
      const detail = assertOk(
        await api.GET('/api/decks/{deckId}/import/runs/{runId}', {
          params: { path: { deckId, runId } },
        })
      );
      // Before a single page goes up: the run numbers its pages, so a different
      // export resumed into it writes its own artwork onto these cards.
      const label = detail.run.source_label;
      const offered = normalizeSourceLabel(file.name);
      if (label !== null && normalizeSourceLabel(label) !== offered) {
        this.error =
          `This import was started from “${label}”, and this is “${file.name}”. ` +
          'Choose that export, or discard the import and start again.';
        return;
      }
      planned = detail.run.page_count;
      done = new Set(
        detail.cards.map((card) => card.page_number).filter((page): page is number => page !== null)
      );
    } catch (caught) {
      this.error = apiMessage(caught);
      return;
    }

    await this.readExport(file);
    const pages = this.#pages;
    if (!pages) return;

    // The name alone is not the export: Canva names one after the design, so a
    // second export taken after an edit arrives under the name the run already
    // holds. The page count is the one thing about its shape the run kept.
    if (pages.length !== planned) {
      this.error =
        `This import was planned for an export of ${pageCount(planned)}, and this one has ` +
        `${pageCount(pages.length)}. Choose the export it started from, or discard the ` +
        'import and start again.';
      this.pageList = [];
      this.#pages = null;
      this.#file = null;
      return;
    }

    this.runDeckId = deckId;
    this.posted = done.size;
    await this.#uploadAndFinish(
      runId,
      pages.filter((page) => !done.has(page.page_number))
    );
  }

  async finish(runId: string): Promise<void> {
    const generation = this.#runGeneration;
    this.status = 'finishing';

    try {
      const detail = assertOk(
        await api.POST('/api/decks/import/runs/{runId}/finish', { params: { path: { runId } } })
      );
      if (generation !== this.#runGeneration) return;
      this.summary = detail;
      this.run = detail.run;
      this.openRun = null;
      this.status = 'done';
    } catch (caught) {
      if (generation !== this.#runGeneration) return;
      this.error = apiMessage(caught);
      this.status = 'idle';
    }

    await this.#refreshBinding();
  }

  // Nothing already imported is undone by this, which is what the screen has to
  // say before the button is pressed.
  async abandon(runId: string): Promise<void> {
    this.#runGeneration += 1;

    try {
      assertOk(
        await api.POST('/api/decks/import/runs/{runId}/abandon', { params: { path: { runId } } })
      );
      this.error = null;
    } catch (caught) {
      this.error = apiMessage(caught);
    }

    this.run = null;
    this.plan = null;
    this.posted = 0;
    this.openRun = null;
    this.runDeckId = null;
    this.status = 'idle';
    await this.#refreshBinding();
  }

  async listRuns(deckId: string): Promise<ImportRun[]> {
    const data = assertOk(
      await api.GET('/api/decks/{deckId}/import/runs', { params: { path: { deckId } } })
    );
    return data.runs;
  }

  // The loop stops between pages, so at most one request is ever in flight and
  // the abandon that follows cannot race a page landing after the run closes.
  cancel(): void {
    this.#cancelled = true;
  }

  reset(): void {
    // Generations first, so nothing still on the wire can refill this.
    this.#bindingGeneration += 1;
    this.#runGeneration += 1;
    this.binding = null;
    this.loadingBinding = false;
    this.run = null;
    this.plan = null;
    this.pageList = [];
    this.posted = 0;
    this.summary = null;
    this.openRun = null;
    this.runDeckId = null;
    this.bindingDeckId = null;
    this.status = 'idle';
    this.error = null;
    this.#projectId = null;
    this.#deckId = null;
    this.#pages = null;
    this.#file = null;
    this.#cancelled = false;
  }

  async #uploadAndFinish(runId: string, pages: readonly CanvaPage[]): Promise<void> {
    this.#runGeneration += 1;
    const generation = this.#runGeneration;
    this.#cancelled = false;
    this.error = null;
    this.status = 'importing';

    try {
      // One at a time. The quota is asserted inside each page request, so a
      // parallel burst can have every one of them pass a check that the set of
      // them fails.
      for (const page of pages) {
        if (generation !== this.#runGeneration) return;
        if (this.#cancelled) break;
        await this.#postPage(runId, page);
        if (generation !== this.#runGeneration) return;
        this.posted += 1;
      }
    } catch (caught) {
      if (generation !== this.#runGeneration) return;
      // The run stays open on a failure: what is already imported is worth
      // resuming, and abandoning it here would throw that away on the store's
      // own initiative.
      this.error = apiMessage(caught);
      this.status = 'idle';
      await this.#refreshBinding();
      return;
    }

    if (this.#cancelled) {
      await this.abandon(runId);
      return;
    }
    await this.finish(runId);
  }

  async #postPage(runId: string, page: CanvaPage): Promise<void> {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- one URL, then dropped
    const query = new URLSearchParams({ page_number: String(page.page_number) });
    // An empty title is a 400 rather than a 422, so an untitled page leaves the
    // parameter out entirely.
    if (page.title !== null) query.set('title', page.title);

    // The page image IS the body, which the generated client types as never --
    // and the status is what tells a 409 apart from a 413 here.
    const response = await fetch(`/api/decks/import/runs/${runId}/pages?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': page.content_type, ...authHeader() },
      body: new Blob([(await page.bytes()) as BlobPart], { type: page.content_type }),
    });

    await readUploadResponse(response, `Page ${page.page_number} failed (${response.status})`);
  }

  async #readBinding(deckId: string): Promise<DeckImport | null> {
    try {
      return assertOk(
        await api.GET('/api/decks/{deckId}/import', { params: { path: { deckId } } })
      );
    } catch (caught) {
      // A deck with no import answers 404 on this one route, and the deck the
      // screen has already loaded is the proof that this 404 is not that one.
      if (caught instanceof ApiError && caught.status === 404) {
        return null;
      }
      throw caught;
    }
  }

  // The open run on the binding is what the screen offers to resume, so a run
  // that has just closed has to leave it.
  async #refreshBinding(): Promise<void> {
    const projectId = this.#projectId;
    const deckId = this.#deckId;
    if (!projectId || !deckId) return;
    await this.loadBinding(projectId, deckId).catch(() => {});
  }

  // A second run is refused with the open one's id and start time spread into
  // the error body, which the generated client types as an error string alone.
  #readOpenRun(caught: unknown): boolean {
    if (!(caught instanceof ApiError) || caught.status !== 409) return false;
    const extra = caught.body as { run_id?: string; started_at?: string } | undefined;
    if (!extra?.run_id) return false;
    this.openRun = { run_id: extra.run_id, started_at: extra.started_at ?? '' };
    return true;
  }
}

export const deckImports = new DeckImportStore();
