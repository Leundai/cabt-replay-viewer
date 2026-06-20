import type { GameView, PokemonSlotView } from './types';

export type BoardSlotClickEffect =
  | { type: 'assignAttachPromptTarget' }
  | { type: 'activateBoardPromptTarget' }
  | { type: 'placeSetupActive' }
  | { type: 'removeSetupPlacement'; selectionIndex: number }
  | { type: 'playToSlot' }
  | { type: 'playSelectedToBoard' }
  | { type: 'focusSlot' }
  | { type: 'clearRetreatSelection' }
  | { type: 'retreatToSlot'; slotIndex: number };

export type BoardSlotClickContext = {
  slot: PokemonSlotView;
  attachPromptSelectable: boolean;
  boardPromptSelectable: boolean;
  retreatSelectionActive: boolean;
  canRetreatToSelectedTarget: boolean;
  canPlaceSetupActive: boolean;
  setupPromptPlayerIndex: number | undefined;
  selectedHandActive: boolean;
  setupActiveIndex: number | null;
  setupBenchIndexes: ReadonlyArray<number | undefined>;
  playableTarget: boolean;
  canPlayOnBoard: boolean;
};

export type BoardSlotDropAction = 'assignAttachPromptTarget' | 'placeSetupActive' | 'playToSlot' | 'none';

export type BoardSlotDropContext = {
  attachPromptSelectable: boolean;
  canPlaceSetupActive: boolean;
  playableTarget: boolean;
};

export function boardSlotClickEffects(context: BoardSlotClickContext): BoardSlotClickEffect[] {
  if (context.attachPromptSelectable) {
    return [{ type: 'assignAttachPromptTarget' }];
  }

  if (context.retreatSelectionActive) {
    if (context.canRetreatToSelectedTarget) {
      return [{ type: 'retreatToSlot', slotIndex: context.slot.index }];
    }
    return [{ type: 'clearRetreatSelection' }, ...standardBoardSlotClickEffects(context)];
  }

  return standardBoardSlotClickEffects(context);
}

export function boardSlotDropAction(context: BoardSlotDropContext): BoardSlotDropAction {
  if (context.attachPromptSelectable) {
    return 'assignAttachPromptTarget';
  }
  if (context.canPlaceSetupActive) {
    return 'placeSetupActive';
  }
  if (context.playableTarget) {
    return 'playToSlot';
  }
  return 'none';
}

export function setupPlacementIndexAtSlot(
  slot: PokemonSlotView,
  activeIndex: number | null,
  benchIndexes: ReadonlyArray<number | undefined>,
): number | undefined {
  if (slot.slot === 'active') {
    return activeIndex ?? undefined;
  }
  return benchIndexes[slot.index];
}

export function boardSlotFromElement(game: GameView | undefined, element: Pick<HTMLElement, 'dataset'>): PokemonSlotView | null {
  if (!game) {
    return null;
  }
  const ownerIndex = Number(element.dataset.ownerIndex);
  const slotKind = element.dataset.slotKind;
  const slotIndex = Number(element.dataset.slotIndex);
  const player = game.players.find((item) => item.index === ownerIndex);
  if (!player || !Number.isFinite(slotIndex)) {
    return null;
  }
  if (slotKind === 'active') {
    return player.active;
  }
  if (slotKind === 'bench') {
    return player.bench.find((slot) => slot.index === slotIndex) ?? null;
  }
  return null;
}

function standardBoardSlotClickEffects(context: BoardSlotClickContext): BoardSlotClickEffect[] {
  if (context.boardPromptSelectable) {
    return [{ type: 'activateBoardPromptTarget' }];
  }

  if (context.canPlaceSetupActive) {
    return [{ type: 'placeSetupActive' }];
  }

  if (canRemoveSetupPlacement(context)) {
    const selectionIndex = setupPlacementIndexAtSlot(context.slot, context.setupActiveIndex, context.setupBenchIndexes);
    if (selectionIndex !== undefined) {
      return [{ type: 'removeSetupPlacement', selectionIndex }];
    }
  }

  if (context.playableTarget) {
    return [{ type: 'playToSlot' }];
  }

  if (context.canPlayOnBoard) {
    return [{ type: 'playSelectedToBoard' }];
  }

  if (!context.slot.empty && context.slot.pokemon) {
    return [{ type: 'focusSlot' }];
  }

  return [];
}

function canRemoveSetupPlacement(context: BoardSlotClickContext): boolean {
  return (
    context.setupPromptPlayerIndex === context.slot.ownerIndex &&
    !context.selectedHandActive &&
    setupPlacementIndexAtSlot(context.slot, context.setupActiveIndex, context.setupBenchIndexes) !== undefined
  );
}
