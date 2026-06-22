import type { CardView, GameView, PlayerView, PokemonSlotView } from './types';

export type SlotSelection = {
  playerIndex: number;
  slot: PokemonSlotView['slot'];
  slotIndex: number;
};

export type ResolvedSlotSelection = {
  player: PlayerView;
  slot: PokemonSlotView;
};

export function canInspectSlot(slot: PokemonSlotView) {
  return !slot.empty && cardsForPokemonSlot(slot).length > 0;
}

export function cardsForPokemonSlot(slot: PokemonSlotView): CardView[] {
  if (slot.empty) {
    return [];
  }
  return [...slot.cards, ...slot.energy, ...slot.tools];
}

export function slotInspectionLabel(slot: PokemonSlotView) {
  return slot.pokemon ? `View ${slot.pokemon.fullName || slot.pokemon.name}` : undefined;
}

export function slotInspectionTitle(player: PlayerView, slot: PokemonSlotView): string {
  const label = slot.slot === 'active' ? 'Active Pokemon' : `Bench ${slot.index + 1}`;
  return `${player.name} ${label}`;
}

export function slotSelectionFor(player: PlayerView, slot: PokemonSlotView): SlotSelection {
  return {
    playerIndex: player.index,
    slot: slot.slot,
    slotIndex: slot.index,
  };
}

export function resolveSlotSelection(game: GameView | null | undefined, selection: SlotSelection): ResolvedSlotSelection | null {
  const player = game?.players[selection.playerIndex];
  if (!player) {
    return null;
  }
  const slot = selection.slot === 'active' ? player.active : player.bench[selection.slotIndex];
  return slot ? { player, slot } : null;
}
