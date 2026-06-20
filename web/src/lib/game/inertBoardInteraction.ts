import type { BoardInteractionSurface } from './boardInteractionSurface';

const noop = () => {};
const preventDrop = (_event: DragEvent) => {};

export const inertBoardInteraction: BoardInteractionSurface = {
  strategy: null,
  canPlayOnBoard: false,
  slot: () => ({
    canDrop: false,
    promptSelectable: false,
    promptSelected: false,
    delta: 0,
    click: noop,
    dragOver: preventDrop,
    drop: preventDrop,
  }),
  bench: () => ({
    canDrop: false,
    click: noop,
    dragOver: preventDrop,
    drop: preventDrop,
  }),
  board: {
    click: noop,
    dragOver: preventDrop,
    drop: preventDrop,
  },
};
