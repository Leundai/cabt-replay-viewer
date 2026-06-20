export type CardView = {
  id?: number;
  name: string;
  fullName: string;
  set?: string;
  setNumber?: string;
  cardImage?: string;
  imageUrl?: string;
  superType?: 'Pokemon' | 'Energy' | 'Trainer';
  cardType?: string;
  trainerType?: string;
  energyType?: string;
  stage?: string;
  evolvesFrom?: string;
  hp?: number;
  retreat?: string[];
  attacks?: AttackView[];
  powers?: PowerView[];
};

export type AttackView = {
  name: string;
  cost?: string[];
  damage?: string;
  text?: string;
};

export type PowerView = {
  name: string;
  powerType?: string;
  text?: string;
};

export type PokemonSlotView = {
  ownerIndex: number;
  slot: 'active' | 'bench';
  index: number;
  empty: boolean;
  pokemon?: CardView;
  cards: CardView[];
  damage: number;
  hp: number;
  retreat: string[];
  energy: CardView[];
  tools: CardView[];
  specialConditions: string[];
};

export type PlayerView = {
  index: number;
  id: number;
  name: string;
  hand: CardView[];
  deckCount: number;
  discard: CardView[];
  lostZone: CardView[];
  stadium: CardView[];
  playZone: CardView[];
  prizesLeft: number;
  active: PokemonSlotView;
  bench: PokemonSlotView[];
};

export type LogView = {
  id: number;
  message: string;
  params?: unknown;
  client?: number;
};

export type GameView = {
  ready: boolean;
  phase: number;
  phaseLabel: string;
  turn: number;
  activePlayerIndex: number;
  activePlayerId?: number;
  winner?: number;
  players: PlayerView[];
  logs: LogView[];
  events: unknown[];
};
