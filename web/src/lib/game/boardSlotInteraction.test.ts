import { describe, expect, it } from 'vitest';
import {
  boardSlotClickEffects,
  boardSlotDropAction,
  boardSlotFromElement,
  setupPlacementIndexAtSlot,
} from './boardSlotInteraction';
import { SlotType, targetFor, type CardView, type GameView, type PlayerView, type PokemonSlotView } from './types';

const pokemon: CardView = { name: 'Ralts', fullName: 'Ralts SIT', stage: 2 };

describe('board slot interaction model', () => {
  it('keeps attach prompt targeting ahead of every other click action', () => {
    expect(
      boardSlotClickEffects({
        ...clickContext(slot(0, 'bench', 1, false)),
        attachPromptSelectable: true,
        boardPromptSelectable: true,
        retreatSelectionActive: true,
        canRetreatToSelectedTarget: true,
        canPlaceSetupActive: true,
        playableTarget: true,
        canPlayOnBoard: true,
      }),
    ).toEqual([{ type: 'assignAttachPromptTarget' }]);
  });

  it('activates board prompt targets before setup or normal card play', () => {
    expect(
      boardSlotClickEffects({
        ...clickContext(slot(0, 'active', 0, false)),
        boardPromptSelectable: true,
        canPlaceSetupActive: true,
        playableTarget: true,
        canPlayOnBoard: true,
      }),
    ).toEqual([{ type: 'activateBoardPromptTarget' }]);
  });

  it('models setup placement and setup placement removal', () => {
    const active = slot(0, 'active', 0, true);
    const bench = slot(0, 'bench', 2, false);

    expect(boardSlotClickEffects({ ...clickContext(active), canPlaceSetupActive: true })).toEqual([
      { type: 'placeSetupActive' },
    ]);
    expect(
      boardSlotClickEffects({
        ...clickContext(active),
        setupPromptPlayerIndex: 0,
        setupActiveIndex: 4,
      }),
    ).toEqual([{ type: 'removeSetupPlacement', selectionIndex: 4 }]);
    expect(
      boardSlotClickEffects({
        ...clickContext(bench),
        setupPromptPlayerIndex: 0,
        setupBenchIndexes: [undefined, undefined, 6],
      }),
    ).toEqual([{ type: 'removeSetupPlacement', selectionIndex: 6 }]);
    expect(
      boardSlotClickEffects({
        ...clickContext(bench),
        setupPromptPlayerIndex: 0,
        selectedHandActive: true,
        setupBenchIndexes: [undefined, undefined, 6],
      }),
    ).toEqual([{ type: 'focusSlot' }]);
  });

  it('falls through from invalid retreat selection into the ordinary slot action', () => {
    expect(
      boardSlotClickEffects({
        ...clickContext(slot(0, 'bench', 2, false)),
        retreatSelectionActive: true,
        canRetreatToSelectedTarget: false,
        playableTarget: true,
      }),
    ).toEqual([{ type: 'clearRetreatSelection' }, { type: 'playToSlot' }]);
  });

  it('uses valid retreat targets as a terminal click action', () => {
    expect(
      boardSlotClickEffects({
        ...clickContext(slot(0, 'bench', 3, false)),
        retreatSelectionActive: true,
        canRetreatToSelectedTarget: true,
        playableTarget: true,
      }),
    ).toEqual([{ type: 'retreatToSlot', slotIndex: 3 }]);
  });

  it('orders play-to-slot, play-to-board, and focus fallback', () => {
    expect(boardSlotClickEffects({ ...clickContext(slot(0, 'active', 0, false)), playableTarget: true })).toEqual([
      { type: 'playToSlot' },
    ]);
    expect(boardSlotClickEffects({ ...clickContext(slot(0, 'active', 0, false)), canPlayOnBoard: true })).toEqual([
      { type: 'playSelectedToBoard' },
    ]);
    expect(boardSlotClickEffects(clickContext(slot(0, 'active', 0, false)))).toEqual([{ type: 'focusSlot' }]);
    expect(boardSlotClickEffects(clickContext(slot(0, 'bench', 0, true)))).toEqual([]);
  });

  it('uses the same priority for drops that target a slot', () => {
    expect(boardSlotDropAction({ attachPromptSelectable: true, canPlaceSetupActive: true, playableTarget: true })).toBe(
      'assignAttachPromptTarget',
    );
    expect(boardSlotDropAction({ attachPromptSelectable: false, canPlaceSetupActive: true, playableTarget: true })).toBe(
      'placeSetupActive',
    );
    expect(boardSlotDropAction({ attachPromptSelectable: false, canPlaceSetupActive: false, playableTarget: true })).toBe(
      'playToSlot',
    );
    expect(boardSlotDropAction({ attachPromptSelectable: false, canPlaceSetupActive: false, playableTarget: false })).toBe(
      'none',
    );
  });

  it('maps board slot datasets back to active and bench view objects', () => {
    const game = gameView([
      player(0, [slot(0, 'bench', 0, false), slot(0, 'bench', 1, false)]),
      player(1, [slot(1, 'bench', 0, false)]),
    ]);

    expect(boardSlotFromElement(game, elementDataset({ ownerIndex: '0', slotKind: 'active', slotIndex: '0' }))).toBe(
      game.players[0].active,
    );
    expect(boardSlotFromElement(game, elementDataset({ ownerIndex: '0', slotKind: 'bench', slotIndex: '1' }))).toBe(
      game.players[0].bench[1],
    );
    expect(boardSlotFromElement(game, elementDataset({ ownerIndex: '9', slotKind: 'bench', slotIndex: '0' }))).toBeNull();
    expect(boardSlotFromElement(game, elementDataset({ ownerIndex: '0', slotKind: 'deck', slotIndex: '0' }))).toBeNull();
  });

  it('finds setup placement indexes for active and bench slots', () => {
    expect(setupPlacementIndexAtSlot(slot(0, 'active', 0, true), 2, [])).toBe(2);
    expect(setupPlacementIndexAtSlot(slot(0, 'active', 0, true), null, [])).toBeUndefined();
    expect(setupPlacementIndexAtSlot(slot(0, 'bench', 3, true), null, [undefined, undefined, undefined, 7])).toBe(7);
    expect(setupPlacementIndexAtSlot(slot(0, 'bench', 1, true), null, [undefined, 9])).toBe(9);
  });
});

function clickContext(slotView: PokemonSlotView) {
  return {
    slot: slotView,
    attachPromptSelectable: false,
    boardPromptSelectable: false,
    retreatSelectionActive: false,
    canRetreatToSelectedTarget: false,
    canPlaceSetupActive: false,
    setupPromptPlayerIndex: undefined,
    selectedHandActive: false,
    setupActiveIndex: null,
    setupBenchIndexes: [],
    playableTarget: false,
    canPlayOnBoard: false,
  };
}

function gameView(players: PlayerView[]): GameView {
  return {
    ready: true,
    phase: 3,
    phaseLabel: 'Main',
    turn: 1,
    activePlayerIndex: 0,
    players,
    prompts: [],
    logs: [],
    events: [],
  };
}

function player(index: number, bench: PokemonSlotView[]): PlayerView {
  return {
    index,
    id: index + 1,
    name: `Player ${index + 1}`,
    hand: [],
    deckCount: 0,
    discard: [],
    lostZone: [],
    stadium: [],
    playZone: [],
    prizesLeft: 6,
    active: slot(index, 'active', 0, false),
    bench,
    playableCardIds: [],
  };
}

function slot(ownerIndex: number, kind: 'active' | 'bench', index: number, empty: boolean): PokemonSlotView {
  return {
    ownerIndex,
    slot: kind,
    index,
    target: targetFor(ownerIndex, ownerIndex, kind === 'active' ? SlotType.ACTIVE : SlotType.BENCH, index),
    empty,
    pokemon: empty ? undefined : pokemon,
    cards: empty ? [] : [pokemon],
    damage: 0,
    hp: empty ? 0 : 60,
    retreat: [],
    energy: [],
    tools: [],
    specialConditions: [],
  };
}

function elementDataset(dataset: Record<string, string>): Pick<HTMLElement, 'dataset'> {
  return { dataset: dataset as DOMStringMap };
}
