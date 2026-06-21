import {
  cardsForPokemonSlot,
  resolveSlotSelection,
  slotInspectionTitle,
  type SlotSelection,
} from '../lib/game/slotInspection';
import type { CardView, GameView } from '../lib/game/types';

export type ZoneName = 'discard' | 'lostZone' | 'stadium' | 'playZone';

type OpenZone = {
  playerIndex: number;
  zone: ZoneName;
  title: string;
  faceDown?: boolean;
};

type OpenSlot = SlotSelection & {
  faceDown?: boolean;
};

class ZoneViewerStore {
  openZone = $state<OpenZone | OpenSlot | null>(null);

  get open() {
    return !!this.openZone;
  }

  get title() {
    return this.openZone && 'title' in this.openZone ? this.openZone.title : '';
  }

  get faceDown() {
    return this.openZone?.faceDown ?? false;
  }

  get zone() {
    return this.openZone && 'zone' in this.openZone ? this.openZone.zone : undefined;
  }

  show(playerIndex: number, zone: ZoneName, title: string, faceDown = false) {
    this.openZone = { playerIndex, zone, title, faceDown };
  }

  showSlot(selection: SlotSelection, faceDown = false) {
    this.openZone = { ...selection, faceDown };
  }

  close() {
    this.openZone = null;
  }

  titleFor(game: GameView | null | undefined): string {
    if (!this.openZone) {
      return '';
    }
    if ('title' in this.openZone) {
      return this.openZone.title;
    }
    const resolved = 'slotIndex' in this.openZone ? resolveSlotSelection(game, this.openZone) : null;
    return resolved ? slotInspectionTitle(resolved.player, resolved.slot) : '';
  }

  cardsFor(game: GameView | null | undefined): CardView[] {
    if (!this.openZone) {
      return [];
    }
    if ('slotIndex' in this.openZone) {
      const resolved = resolveSlotSelection(game, this.openZone);
      return resolved ? cardsForPokemonSlot(resolved.slot) : [];
    }
    return game
      ? (game.players[this.openZone.playerIndex]?.[this.openZone.zone] ?? [])
      : [];
  }
}

export const zoneViewerStore = new ZoneViewerStore();
