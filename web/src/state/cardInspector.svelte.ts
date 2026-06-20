import type { CardView } from '../lib/game/types';

class CardInspectorStore {
  card = $state<CardView | null>(null);

  show(card: CardView | undefined, faceDown = false): void {
    if (!card || faceDown) {
      return;
    }
    this.card = card;
  }

  close(): void {
    this.card = null;
  }
}

export const cardInspectorStore = new CardInspectorStore();
