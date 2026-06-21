import type { CardView, PlayerView, PokemonSlotView } from './types';

export function cardsForPokemonSlot(slot: PokemonSlotView): CardView[] {
  if (slot.empty) {
    return [];
  }
  return [...slot.cards, ...slot.energy, ...slot.tools];
}

export function pokemonSlotTitle(player: PlayerView, slot: PokemonSlotView): string {
  const label = slot.slot === 'active' ? 'Active Pokemon' : `Bench ${slot.index + 1}`;
  return `${player.name} ${label}`;
}
