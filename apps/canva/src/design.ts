import { getDesignMetadata, openDesign, requestExport } from '@canva/design';

export interface DesignPage {
  pageNumber: number;
  pageId: string;
  title: string | null;
}

export interface Design {
  title: string | null;
  pages: DesignPage[];
}

export class DesignError extends Error {}

/**
 * Every page of the open design, in order, with the id and title the importer
 * matches on.
 *
 * Two APIs, because neither answers on its own. `openDesign` gives the order,
 * but a `PageRef` is a reference and carries no id at all -- the id is on the
 * `AbsolutePage` its own helper dereferences one into. `getDesignMetadata`
 * gives the titles and the ids together, but its order is documented as not
 * guaranteed, so they are joined by id rather than by position.
 *
 * It measured at 145ms for 47 pages, so the round trips are not worth avoiding.
 * Their order does happen to match `pageMetadata`'s today; relying on that
 * would be relying on the one thing the documentation says not to.
 */
export async function readDesign(): Promise<Design> {
  const meta = await getDesignMetadata();

  const titleById = new Map<string, string | null>();
  for (const page of meta.pageMetadata) {
    if (page.type !== 'absolute' || page.id === undefined) continue;
    // Canva returns an empty title for a page nobody named, and an empty title
    // is not a title -- the importer keys those by page number instead.
    const title = page.title ?? '';
    titleById.set(page.id, title.trim().length === 0 ? null : title);
  }

  const ids: string[] = [];
  await openDesign({ type: 'all_pages' }, async (session) => {
    for (const ref of session.pageRefs.toArray()) {
      if (ref.type !== 'absolute') {
        throw new DesignError(
          'This design has a page the importer cannot read. Only ordinary pages can be imported.'
        );
      }
      await session.helpers.openPage(ref, async (result) => {
        if (result.page.type === 'absolute') ids.push(result.page.id);
      });
    }
  });

  if (ids.length === 0) throw new DesignError('This design has no pages to import.');

  return {
    title: meta.title ?? null,
    pages: ids.map((pageId, index) => ({
      pageNumber: index + 1,
      pageId,
      title: titleById.get(pageId) ?? null,
    })),
  };
}

export interface ExportedPages {
  urls: string[];
}

/**
 * The design's pages as one PNG each.
 *
 * `zipped` belongs on the file type and not on the request; passed at the top
 * level it is silently ignored and a multi-page design comes back as a single
 * ZIP, which reads exactly like Canva refusing to split the export. And it is
 * declared optional on `ExportImageFileType` but is not -- `{ type: 'png' }`
 * alone is refused at runtime with `Invalid file type(s)`, so the bare string
 * is the only way to ask for the default. Neither is guessable from the docs.
 *
 * Returns null where the person closed the dialog, which is not a failure.
 */
export async function exportPages(pageCount: number): Promise<ExportedPages | null> {
  const result = await requestExport({
    acceptedFileTypes: [{ type: 'png', zipped: 'never' }],
  });
  if (result.status !== 'completed') return null;

  // The export dialog lets a person pick a subset of pages, and an ExportBlob
  // is a bare `{ url }` -- there is nothing in it saying which page it holds.
  // Lining a short list up against the full page list by position would put the
  // wrong artwork on the first cards and tombstone every card past them, and it
  // would look entirely normal on the way through.
  if (result.exportBlobs.length !== pageCount) {
    throw new DesignError(
      `That export has ${result.exportBlobs.length} of this design's ${pageCount} pages, ` +
        'and Canva does not say which ones. Choose every page in the export dialog.\n\n' +
        'An import is the whole deck: pages it leaves out are cards it deletes, so there ' +
        'is no safe way to read a partial export as an update to part of a deck.'
    );
  }

  return { urls: result.exportBlobs.map((blob) => blob.url) };
}
