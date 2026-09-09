import type { components } from '@three-peaks/shared/api';
import { api, assertOk } from '../api/client.ts';

export type OutstandingDeck = components['schemas']['PrintOutstanding']['decks'][number];
export type OutstandingCard = OutstandingDeck['cards'][number];
export type PrintRun = components['schemas']['PrintRun'];

// What one run puts on paper. `all` is every copy of every selected card;
// `changed` is only what the printer does not already have, which is the whole
// reason a run is recorded at all.
export type PrintMode = 'all' | 'changed';

export interface RecordedCard {
  file_id: string;
  version_number: number;
  copies: number;
  back_file_id?: string | null;
  back_version_number?: number | null;
}

export async function readOutstanding(projectId: string): Promise<OutstandingDeck[]> {
  const data = assertOk(
    await api.GET('/api/print/outstanding', { params: { query: { project_id: projectId } } })
  );
  return data.decks;
}

export async function recordPrintRun(
  projectId: string,
  cards: readonly RecordedCard[]
): Promise<PrintRun> {
  return assertOk(
    await api.POST('/api/print/runs', {
      body: { project_id: projectId, cards: cards as RecordedCard[] },
    })
  );
}

export async function undoPrintRun(runId: string): Promise<void> {
  assertOk(await api.DELETE('/api/print/runs/{runId}', { params: { path: { runId } } }));
}

/**
 * How many copies of one card this run puts on paper.
 *
 * A card the deck holds none of prints none of itself, whichever mode is on --
 * a zero copy count is a card kept in the list with nothing physical made of
 * it, and that is true of a reprint as much as of a first print. One of each
 * collapses whatever is left to a single proof copy.
 *
 * A card the server said nothing about falls back to its own count rather than
 * to zero: leaving artwork off a sheet because a lookup missed is the one
 * failure this feature must not have.
 */
export function copiesToPrint(
  quantity: number,
  outstanding: OutstandingCard | undefined,
  mode: PrintMode,
  oneOfEach: boolean
): number {
  if (quantity === 0) return 0;
  const wanted = mode === 'changed' ? (outstanding?.owed_copies ?? quantity) : quantity;
  if (wanted <= 0) return 0;
  return oneOfEach ? 1 : wanted;
}

// The badge beside a card's name. Null is a card the printer is already square
// with, which is drawn as nothing rather than as "up to date" on every row.
export function outstandingLabel(outstanding: OutstandingCard | undefined): string | null {
  if (!outstanding || outstanding.reason === null) return null;
  switch (outstanding.reason) {
    case 'never':
      return 'never printed';
    case 'artwork':
      return 'new artwork';
    case 'back':
      return 'new back';
    case 'copies':
      return `${outstanding.owed_copies} more`;
  }
}
