// The card sizes a game gets quoted and printed at.
//
// These are Panda Game Manufacturing's standard sizes, taken from the "Cards"
// page of their Design Guidebook, and they are the reason the numbers are not
// the rounder ones a hobby shop lists: a proof cut at 63 x 88 mm is the same
// trim as the eventual production order, and one cut at 63.5 x 88.9 mm is not.
//
// They live here rather than beside the 3D settings because two features now
// size a card from them -- the studio that extrudes one and the print sheets
// that pack them -- and a second list is a second answer.

export interface CardSize {
  width_mm: number;
  height_mm: number;
}

export interface CardPreset extends CardSize {
  id: string;
  name: string;
}

// Poker is `blackjack` on Panda's own sheet; it is named for what a designer
// asks for. Ordered by area, so the dropdown reads small to large.
export const CARD_PRESETS: readonly CardPreset[] = [
  { id: 'mini', name: 'Mini (44 × 67 mm)', width_mm: 44, height_mm: 67 },
  { id: 'mini-square', name: 'Mini square (51 × 51 mm)', width_mm: 51, height_mm: 51 },
  { id: 'bridge', name: 'Bridge (57 × 87 mm)', width_mm: 57, height_mm: 87 },
  { id: 'euro', name: 'Euro (59 × 91 mm)', width_mm: 59, height_mm: 91 },
  { id: 'poker', name: 'Poker (63 × 88 mm)', width_mm: 63, height_mm: 88 },
  { id: 'square', name: 'Square (70 × 70 mm)', width_mm: 70, height_mm: 70 },
  { id: 'tarot', name: 'Tarot (70 × 120 mm)', width_mm: 70, height_mm: 120 },
];

export const DEFAULT_CARD_PRESET_ID = 'poker';

// What Panda asks for on every card file, and the radius their die cuts at.
// Recorded here because they are facts about a card rather than about either
// feature; the Letter proof sheets print at trim and use none of them.
export const PANDA_BLEED_MM = 3;
export const PANDA_MARGIN_MM = 3;
export const PANDA_CORNER_RADIUS_MM = 2.5;

export function cardPreset(id: string): CardPreset | undefined {
  return CARD_PRESETS.find((preset) => preset.id === id);
}

// Which preset a size currently matches, so a screen shows the named size
// rather than resetting its dropdown to the first entry. Takes the two lengths
// rather than a settings object: a deck and a 3D model both ask this.
export function matchingCardPreset(size: CardSize): CardPreset | undefined {
  return CARD_PRESETS.find(
    (preset) => preset.width_mm === size.width_mm && preset.height_mm === size.height_mm
  );
}
