import { describe, expect, it } from 'vitest';
import {
  canInspectSlot,
  cardsForPokemonSlot,
  resolveSlotSelection,
  slotInspectionLabel,
  slotInspectionTitle,
  slotSelectionFor,
} from './slotInspection';
import { prizeZone } from './prizeZone';
import type { GameView, PlayerView, PokemonSlotView } from './types';

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
  prizes: prizeZone(Array.from({ length: 6 }, () => ({ name: 'Card', fullName: 'Card' })), true),
  active: slot({ slot: 'active', index: 0 }),
  bench: [slot({ index: 0 }), slot({ index: 1 }), slot()],
};

describe('slot inspection', () => {
  it('surfaces the Pokemon line, energy, and tools for a slot viewer', () => {
    expect(cardsForPokemonSlot(slot()).map((card) => card.name)).toEqual([
      'Bench Pokemon',
      'Basic Pokemon',
      'Grass Energy',
      'Tool',
    ]);
  });

  it('uses player and slot position in the viewer title and aria label', () => {
    expect(slotInspectionTitle(player, slot())).toBe('Opponent Bench 3');
    expect(slotInspectionTitle(player, slot({ slot: 'active', index: 0 }))).toBe('Opponent Active Pokemon');
    expect(slotInspectionLabel(slot())).toBe('View Bench Pokemon');
  });

  it('resolves selections against the current game view', () => {
    const selection = slotSelectionFor(player, slot({ index: 1 }));
    const game: GameView = {
      ready: true,
      phase: 2,
      phaseLabel: 'CABT replay',
      turn: 1,
      activePlayerIndex: 0,
      players: [{ ...player, index: 0, id: 0 }, player],
      logs: [],
      events: [],
    };

    expect(resolveSlotSelection(game, selection)?.slot.index).toBe(1);
  });

  it('does not inspect empty slots', () => {
    const empty = slot({ empty: true, pokemon: undefined, cards: [], energy: [], tools: [] });

    expect(canInspectSlot(empty)).toBe(false);
    expect(cardsForPokemonSlot(empty)).toEqual([]);
  });
});
