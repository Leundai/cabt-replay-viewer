import { describe, expect, it } from 'vitest';
import { cardsForPokemonSlot, pokemonSlotTitle } from './slotCards';
import type { PlayerView, PokemonSlotView } from './types';

function slot(overrides: Partial<PokemonSlotView> = {}): PokemonSlotView {
  return {
    ownerIndex: 1,
    slot: 'bench',
    index: 2,
    empty: false,
    pokemon: { id: 10, name: 'Bench Pokemon', fullName: 'Bench Pokemon' },
    cards: [
      { id: 10, name: 'Bench Pokemon', fullName: 'Bench Pokemon' },
      { id: 9, name: 'Basic Pokemon', fullName: 'Basic Pokemon' },
    ],
    damage: 0,
    hp: 100,
    retreat: [],
    energy: [{ id: 1, name: 'Grass Energy', fullName: 'Grass Energy' }],
    tools: [{ id: 2, name: 'Tool', fullName: 'Tool' }],
    specialConditions: [],
    ...overrides,
  };
}

const player: PlayerView = {
  index: 1,
  id: 1,
  name: 'Opponent',
  hand: [],
  deckCount: 0,
  discard: [],
  lostZone: [],
  stadium: [],
  playZone: [],
  prizes: Array.from({ length: 6 }, () => ({ name: 'Card', fullName: 'Card' })),
  active: slot({ slot: 'active', index: 0 }),
  bench: [],
};

describe('slot card helpers', () => {
  it('surfaces the Pokemon line, energy, and tools for a slot viewer', () => {
    expect(cardsForPokemonSlot(slot()).map((card) => card.name)).toEqual([
      'Bench Pokemon',
      'Basic Pokemon',
      'Grass Energy',
      'Tool',
    ]);
  });

  it('uses player and slot position in the viewer title', () => {
    expect(pokemonSlotTitle(player, slot())).toBe('Opponent Bench 3');
    expect(pokemonSlotTitle(player, slot({ slot: 'active', index: 0 }))).toBe('Opponent Active Pokemon');
  });

  it('returns no cards for an empty slot', () => {
    expect(cardsForPokemonSlot(slot({ empty: true, pokemon: undefined, cards: [], energy: [], tools: [] }))).toEqual([]);
  });
});
