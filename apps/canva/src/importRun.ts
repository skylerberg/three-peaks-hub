import { api, assertOk, postBytes } from 'src/api';
import type { DesignPage } from 'src/design';

export interface PlanRow {
  page_number: number;
  title: string | null;
  action: 'add' | 'update';
  matched_by: string | null;
  name: string | null;
}

interface Removal {
  file_id: string;
  name: string;
}

export interface StartedRun {
  runId: string;
  added: number;
  updated: number;
  removed: Removal[];
  pages: PlanRow[];
}

export interface RunCounts {
  pages: number;
  added: number;
  updated: number;
  unchanged: number;
  removed: number;
  restored: number;
}

/**
 * Opens the run and returns what the server decided it will do.
 *
 * The whole manifest goes up front -- every page number, title and page id --
 * so the matching is settled before a single image is uploaded and the plan can
 * be read by a person first. Re-importing tombstones the cards the design has
 * stopped having, and this is the only place that can be seen coming.
 */
export async function startRun(
  deckId: string,
  design: { title: string | null; pages: DesignPage[] }
): Promise<StartedRun> {
  const started = assertOk(
    await api.POST('/api/decks/{deckId}/import/runs', {
      params: { path: { deckId } },
      body: {
        ...(design.title === null ? {} : { source_label: design.title }),
        pages: design.pages.map((page) => ({
          page_number: page.pageNumber,
          ...(page.title === null ? {} : { title: page.title }),
          page_id: page.pageId,
        })),
      },
    })
  );

  return {
    runId: started.id,
    added: started.plan.added,
    updated: started.plan.updated,
    removed: started.plan.removed,
    pages: started.plan.pages as PlanRow[],
  };
}

export interface Progress {
  done: number;
  total: number;
}

/**
 * Uploads every page and finishes the run.
 *
 * Sequential, for the reason the page route's own quota assertion gives. The
 * export URLs Canva hands back last an hour, which is far longer than any deck
 * takes, so there is nothing to win by overlapping them.
 */
export async function uploadPages(
  runId: string,
  pages: DesignPage[],
  urls: string[],
  onProgress: (progress: Progress) => void
): Promise<RunCounts> {
  for (const [index, page] of pages.entries()) {
    const url = urls[index];
    if (url === undefined) throw new Error(`Page ${page.pageNumber} has no exported image`);

    // Fetched here rather than by the API. Canva's docs say to download export
    // blobs from a backend because of CSP; measured against the real thing the
    // iframe can fetch them, which is what keeps apps/api free of any outbound
    // request and of the allowlist one would need.
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Could not download page ${page.pageNumber} from Canva`);
    }
    const bytes = await response.blob();

    const query = new URLSearchParams({ page_number: String(page.pageNumber) });
    // An empty title is refused as a bad request, so an untitled page leaves
    // the parameter out rather than sending nothing under a name.
    if (page.title !== null) query.set('title', page.title);

    await postBytes(`/api/decks/import/runs/${runId}/pages`, query, bytes, 'image/png');
    onProgress({ done: index + 1, total: pages.length });
  }

  const finished = assertOk(
    await api.POST('/api/decks/import/runs/{runId}/finish', { params: { path: { runId } } })
  );
  return finished.run.counts as RunCounts;
}

// Leaves everything already uploaded in place: nothing is tombstoned and the
// deck is not touched. The alternative -- finishing -- is the destructive one.
export async function abandonRun(runId: string): Promise<void> {
  assertOk(
    await api.POST('/api/decks/import/runs/{runId}/abandon', { params: { path: { runId } } })
  );
}
