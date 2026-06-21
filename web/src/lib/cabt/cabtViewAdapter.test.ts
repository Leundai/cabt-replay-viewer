import { describe, expect, it } from 'vitest';
import { cabtStateToGameView, createReplayCabtCardCatalog } from './cabtViewAdapter';
import type { CabtCardViewCatalog } from './cabtViewAdapter';

describe('cabtStateToGameView', () => {
  const catalog: CabtCardViewCatalog = {
    cardToView(cardRef) {
      const name = cardRef.name ?? `Card ${cardRef.id}`;
      return {
        id: cardRef.id,
        name,
        fullName: name,
        hp: cardRef.id === 10 ? 100 : undefined,
      };
    },
    retreatCost(cardRef) {
      return Array.from({ length: cardRef?.id === 10 ? 2 : 0 }, () => 'Colorless');
    },
  };

  it('normalizes CABT players into stable board slots and card zones', () => {
    const view = cabtStateToGameView({
      current: {
        turn: 3,
        yourIndex: 0,
        result: -1,
        stadium: [
          { id: 98, name: 'Shared Stadium' },
          { id: 99, name: 'Owned Stadium', playerIndex: 1 },
        ],
        players: [
          {
            active: [{
              id: 10,
              name: 'Active Pokemon',
              hp: 70,
              maxHp: 100,
              energyCards: [{ id: 1, name: 'Grass Energy' }],
              tools: [{ id: 2, name: 'Tool' }],
              preEvolution: [{ id: 9, name: 'Basic Pokemon' }],
            }],
            bench: [{ id: 11, name: 'Bench Pokemon', hp: 60, maxHp: 60 }],
            benchMax: 3,
            deckCount: 12,
            discard: [{ id: 3, name: 'Discarded Card' }],
            hand: null,
            handCount: 2,
            prize: [null, null, null],
            poisoned: true,
            asleep: true,
          },
          {
            active: [],
            bench: [],
            benchMax: 2,
            deckCount: 10,
            discard: [],
            hand: [{ id: 4, name: 'Visible Card' }],
            prize: [],
          },
        ],
      },
      cardCatalog: catalog,
      activePhaseLabel: 'Player turn',
      logs: [],
      events: [],
    });

    expect(view.ready).toBe(true);
    expect(view.players[0].hand).toEqual([{ name: 'Card', fullName: 'Card' }, { name: 'Card', fullName: 'Card' }]);
    expect(view.players[0].prizes).toEqual([
      { name: 'Card', fullName: 'Card' },
      { name: 'Card', fullName: 'Card' },
      { name: 'Card', fullName: 'Card' },
    ]);
    expect(view.players[0].prizes).toHaveLength(3);
    expect(view.players[0].stadium.map((card) => card.name)).toEqual(['Shared Stadium']);
    expect(view.players[1].stadium.map((card) => card.name)).toEqual(['Owned Stadium']);
    expect(view.players[0].active.damage).toBe(30);
    expect(view.players[0].active.retreat).toHaveLength(2);
    expect(view.players[0].active.energy).toEqual([expect.objectContaining({ name: 'Grass Energy' })]);
    expect(view.players[0].active.tools).toEqual([expect.objectContaining({ name: 'Tool' })]);
    expect(view.players[0].active.cards.map((card) => card.name)).toEqual(['Active Pokemon', 'Basic Pokemon']);
    expect(view.players[0].active.specialConditions).toEqual(['Poisoned', 'Asleep']);
    expect(view.players[0].bench).toHaveLength(3);
  });
});

describe('createReplayCabtCardCatalog', () => {
  it('turns replay metadata rows into card views', () => {
    const catalog = createReplayCabtCardCatalog(
      [
        {
          id: 1,
          name: 'Basic {G} Energy',
          kind: 'Energy',
          type: '{G}',
        },
        {
          id: 710,
          name: 'Celebi',
          kind: 'Basic Pokemon',
          hp: 80,
          retreat: 1,
          attacks: [50],
        },
      ],
      [
        {
          attackId: 50,
          name: 'Leaf Step',
          text: 'A tiny test attack.',
          damage: 20,
          energies: [1],
        },
      ],
    );

    expect(catalog.cardToView({ id: 1 })).toEqual(expect.objectContaining({
      name: 'Basic Grass Energy',
      superType: 'Energy',
      energyType: 'Grass',
    }));
    expect(catalog.cardToView({ id: 710 })).toEqual(expect.objectContaining({
      name: 'Celebi',
      superType: 'Pokemon',
      stage: 'Basic',
      retreat: ['Colorless'],
      attacks: [expect.objectContaining({ name: 'Leaf Step', cost: ['Grass'], damage: '20' })],
    }));
  });
});
