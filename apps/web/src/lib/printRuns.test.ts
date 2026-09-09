import { describe, expect, it } from 'vitest';
import { type OutstandingCard, copiesToPrint, outstandingLabel } from './printRuns.ts';

function owed(overrides: Partial<OutstandingCard> = {}): OutstandingCard {
  return {
    file_id: 'f1',
    version_number: 1,
    quantity: 3,
    printed_copies: 0,
    owed_copies: 3,
    printed_version_number: null,
    last_printed_at: null,
    reason: 'never',
    ...overrides,
  };
}

describe('how many copies a run puts on paper', () => {
  it('prints the deck’s own count when the mode is everything', () => {
    expect(copiesToPrint(3, owed({ owed_copies: 1 }), 'all', false)).toBe(3);
  });

  it('prints only what is outstanding when the mode is changed', () => {
    expect(copiesToPrint(3, owed({ owed_copies: 1 }), 'changed', false)).toBe(1);
  });

  it('leaves out a card that owes nothing', () => {
    expect(copiesToPrint(3, owed({ owed_copies: 0, reason: null }), 'changed', false)).toBe(0);
  });

  it('prints none of a card the deck holds none of, whichever mode is on', () => {
    expect(copiesToPrint(0, owed({ quantity: 0, owed_copies: 0 }), 'all', false)).toBe(0);
    expect(copiesToPrint(0, owed({ quantity: 0, owed_copies: 0 }), 'changed', false)).toBe(0);
  });

  it('collapses to one proof copy under one of each', () => {
    expect(copiesToPrint(3, owed({ owed_copies: 2 }), 'changed', true)).toBe(1);
    expect(copiesToPrint(3, owed(), 'all', true)).toBe(1);
  });

  // Dropping artwork off a sheet because a lookup missed is the one failure this
  // must not have, so an unknown card falls back to its own count.
  it('prints a card the server said nothing about at its full count', () => {
    expect(copiesToPrint(2, undefined, 'changed', false)).toBe(2);
  });
});

describe('the badge beside a card', () => {
  it('draws nothing for a card the printer is square with', () => {
    expect(outstandingLabel(owed({ owed_copies: 0, reason: null }))).toBeNull();
    expect(outstandingLabel(undefined)).toBeNull();
  });

  it('names each reason a card is owed', () => {
    expect(outstandingLabel(owed({ reason: 'never' }))).toBe('never printed');
    expect(outstandingLabel(owed({ reason: 'artwork' }))).toBe('new artwork');
    expect(outstandingLabel(owed({ reason: 'back' }))).toBe('new back');
    expect(outstandingLabel(owed({ reason: 'copies', owed_copies: 2 }))).toBe('2 more');
  });
});
