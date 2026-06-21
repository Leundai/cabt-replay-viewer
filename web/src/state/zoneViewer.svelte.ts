import { cardsForPokemonSlot, pokemonSlotTitle } from '../lib/game/slotCards';
import type { CardView, GameView, PlayerView, PokemonSlotView } from '../lib/game/types';

export type ZoneName = 'discard' | 'lostZone' | 'stadium' | 'playZone';
export type SlotName = PokemonSlotView['slot'];

type OpenZone = {
  playerIndex: number;
  zone: ZoneName;
  title: string;
  faceDown?: boolean;
};

type OpenSlot = {
  playerIndex: number;
  slot: SlotName;
  slotIndex: number;
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

  showSlot(playerIndex: number, slot: SlotName, slotIndex: number, faceDown = false) {
    this.openZone = { playerIndex, slot, slotIndex, faceDown };
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
    const resolved = 'slotIndex' in this.openZone ? this.slotFor(game, this.openZone) : null;
    return resolved ? pokemonSlotTitle(resolved.player, resolved.slot) : '';
  }

  cardsFor(game: GameView | null | undefined): CardView[] {
    if (!this.openZone) {
      return [];
    }
    if ('slotIndex' in this.openZone) {
      const resolved = this.slotFor(game, this.openZone);
      return resolved ? cardsForPokemonSlot(resolved.slot) : [];
    }
    return game
      ? (game.players[this.openZone.playerIndex]?.[this.openZone.zone] ?? [])
      : [];
  }

  private slotFor(game: GameView | null | undefined, selection: OpenSlot): { player: PlayerView; slot: PokemonSlotView } | null {
    const player = game?.players[selection.playerIndex];
    if (!player) {
      return null;
    }
    const slot = selection.slot === 'active' ? player.active : player.bench[selection.slotIndex];
    return slot ? { player, slot } : null;
  }
}

export const zoneViewerStore = new ZoneViewerStore();
