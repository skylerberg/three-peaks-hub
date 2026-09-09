// What has already been put on paper, and what a card is therefore still owed.
//
// Separate from print.ts, which is the sheet layout and knows nothing about
// decks or history: nothing here decides where a card sits on a page.

// Why a card is still owed a trip through the printer. Enumerated rather than
// left a bare string, so adding a reason shows up as a red diff in the
// generated client -- which is the change a screen otherwise draws a blank
// badge for.
//
//  * never    -- no run has ever printed it
//  * artwork  -- every run that printed it did so at an older version
//  * back     -- printed at this artwork, but with a reverse the deck has since
//                replaced, so the piece of card is wrong on the side no
//                comparison of fronts can see
//  * copies   -- printed at this artwork and this back, and the deck now asks
//                for more of it than came off the printer
export const PRINT_REASONS = ['never', 'artwork', 'back', 'copies'] as const;
export type PrintReason = (typeof PRINT_REASONS)[number];

// How many cards one recorded run may name. A project prints every deck it has
// in one go, and a deck holds at most MAX_DECK_CARDS, so this is ten full decks
// at once -- well past what anyone feeds a desktop printer in a sitting, and
// low enough that recording a run is one request rather than a body nothing has
// bounded.
export const MAX_PRINT_RUN_CARDS = 5000;
