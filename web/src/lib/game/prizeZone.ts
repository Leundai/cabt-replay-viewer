import type { CardView, PrizeZoneView } from './types';

export function prizeZone(cards: CardView[], setup: boolean): PrizeZoneView {
  return {
    cards,
    remaining: cards.length,
    setup,
  };
}

export function visiblePrizeSlots(zone: PrizeZoneView) {
  const count = Math.min(6, Math.max(0, zone.remaining));
  return Array.from({ length: count }, (_item, index) => index);
}
