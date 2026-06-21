import type { CardView, PrizeZoneView } from './types';

export const MAX_PRIZE_SLOTS = 6;

export function prizeZone(cards: CardView[], setup: boolean): PrizeZoneView {
  return {
    cards,
    remaining: cards.length,
    setup,
  };
}

export function visiblePrizeSlots(_zone: PrizeZoneView) {
  // The table has a fixed six-card prize footprint; the badge carries the
  // known remaining count when replay data is sparse or prizes are taken.
  return Array.from({ length: MAX_PRIZE_SLOTS }, (_item, index) => index);
}
