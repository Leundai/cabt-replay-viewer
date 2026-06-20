import type { BoardInteractionStrategy } from './boardInteraction';
import type { PlayerView, PokemonSlotView } from './types';

export type BoardSlotSurface = {
  canDrop: boolean;
  promptSelectable: boolean;
  promptSelected: boolean;
  delta: number;
  click: (event: MouseEvent) => void;
  dragOver: (event: DragEvent) => void;
  drop: (event: DragEvent) => void;
};

export type BoardBenchSurface = {
  canDrop: boolean;
  click: (event: MouseEvent) => void;
  dragOver: (event: DragEvent) => void;
  drop: (event: DragEvent) => void;
};

export type BoardPlaneSurface = {
  click: (event: MouseEvent) => void;
  dragOver: (event: DragEvent) => void;
  drop: (event: DragEvent) => void;
};

export type BoardInteractionSurface = {
  strategy: BoardInteractionStrategy | null;
  canPlayOnBoard: boolean;
  slot: (slot: PokemonSlotView) => BoardSlotSurface;
  bench: (player: PlayerView) => BoardBenchSurface;
  board: BoardPlaneSurface;
};
