import { resolveCardImageUrl } from '../game/cardImages';
import {
  SlotType,
  targetFor,
  type CardView,
  type GameView,
  type LogView,
  type PlayerView,
  type PokemonSlotView,
  type PromptView,
} from '../game/types';
import type { CabtAttack, CabtCardData } from './types';

export type CabtViewCardRef = {
  id: number;
  serial?: number;
  playerIndex?: number;
  name?: string;
};

export type CabtViewPokemonRef = CabtViewCardRef & {
  hp?: number;
  maxHp?: number;
  energies?: number[];
  energyCards?: CabtViewCardRef[];
  tools?: CabtViewCardRef[];
  preEvolution?: CabtViewCardRef[];
};

export type CabtViewPlayerState = {
  active?: Array<CabtViewPokemonRef | null>;
  bench?: Array<CabtViewPokemonRef | null>;
  benchMax?: number;
  deckCount?: number;
  discard?: CabtViewCardRef[];
  hand?: CabtViewCardRef[] | null;
  handCount?: number;
  prize?: Array<CabtViewCardRef | null>;
  poisoned?: boolean;
  burned?: boolean;
  asleep?: boolean;
  paralyzed?: boolean;
  confused?: boolean;
};

export type CabtViewCurrentState = {
  turn: number;
  yourIndex: number;
  result: number;
  stadium?: CabtViewCardRef[];
  players: CabtViewPlayerState[];
};

export type CabtCardViewCatalog = {
  cardToView: (cardRef: CabtViewCardRef) => CardView;
  retreatCost: (cardRef: CabtViewPokemonRef | null | undefined) => unknown[];
  cardNames?: string[];
};

export type CabtViewAdapterOptions = {
  current: CabtViewCurrentState | null | undefined;
  logs: LogView[];
  events: unknown[];
  cardCatalog: CabtCardViewCatalog;
  playerNames?: string[];
  activePhaseLabel: string;
  finishedPhaseLabel?: string;
  prompts?: PromptView[];
  winnerForResult?: (result: number) => number | undefined;
  availableActionsForPlayer?: (
    player: CabtViewPlayerState,
    index: number,
    activePlayerIndex: number,
  ) => PlayerView['availableActions'];
};

export type CabtDataMaps = {
  cardData: Record<number, CabtCardData>;
  attacks: Record<number, CabtAttack>;
};

export type CabtReplayCardRow = {
  id: number;
  name: string;
  set?: string;
  setNumber?: string;
  kind?: string;
  evolvesFrom?: string;
  hp?: number | null;
  type?: string;
  retreat?: number | null;
  attackName?: string;
  attackCost?: string;
  attackDamage?: string;
  attackText?: string;
  retreatCost?: number;
  attacks?: number[];
};

export type CabtReplayAttackRow = {
  attackId: number;
  name: string;
  text?: string;
  damage?: number;
  energies?: number[];
};

const energyNames = [
  'Colorless',
  'Grass',
  'Fire',
  'Water',
  'Lightning',
  'Psychic',
  'Fighting',
  'Darkness',
  'Metal',
  'Dragon',
  'Rainbow',
  'Team Rocket',
];

export function cabtStateToGameView(options: CabtViewAdapterOptions): GameView {
  const current = options.current;
  if (!current) {
    return {
      ready: false,
      phase: 0,
      phaseLabel: 'Waiting',
      turn: 0,
      activePlayerIndex: 0,
      players: [],
      prompts: [],
      logs: options.logs,
      events: options.events,
    };
  }

  const activePlayerIndex = clampPlayerIndex(current.yourIndex);
  const players = current.players.map((player, index) =>
    buildPlayerView(player, index, activePlayerIndex, options),
  );
  const finished = current.result >= 0;

  return {
    ready: true,
    phase: finished ? 7 : 2,
    phaseLabel: finished ? options.finishedPhaseLabel ?? 'Finished' : options.activePhaseLabel,
    turn: current.turn,
    activePlayerIndex,
    activePlayerId: players[activePlayerIndex]?.id,
    winner: finished ? options.winnerForResult?.(current.result) : undefined,
    players,
    prompts: options.prompts ?? [],
    logs: options.logs,
    events: options.events,
  };
}

export function createLiveCabtCardCatalog(dataMaps: CabtDataMaps): CabtCardViewCatalog {
  return {
    cardToView(cardRef) {
      const data = dataMaps.cardData[cardRef.id];
      if (!data) {
        return unknownCard(cardRef.id);
      }
      const view: CardView = {
        id: data.cardId,
        name: data.name,
        fullName: data.name,
        set: data.set,
        setNumber: data.setNumber,
        superType: data.cardType === 0 ? 'Pokemon' : data.cardType === 5 ? 'Energy' : 'Trainer',
        cardType: data.energyType,
        trainerType: data.cardType >= 1 && data.cardType <= 4 ? data.cardType : undefined,
        energyType: data.cardType === 5 ? data.energyType : undefined,
        stage: data.basic ? 2 : data.stage1 ? 3 : data.stage2 ? 4 : undefined,
        evolvesFrom: data.evolvesFrom ?? undefined,
        hp: data.hp,
        retreat: Array.from({ length: data.retreatCost ?? 0 }, () => 'Colorless'),
        attacks: data.attacks?.map((attackId) => dataMaps.attacks[attackId]).filter(Boolean).map((attack) => ({
          name: attack.name,
          cost: attack.energies?.map((energy) => energyNames[energy] ?? 'Colorless') ?? [],
          damage: attack.damage === undefined ? '' : String(attack.damage),
          text: attack.text,
        })),
        powers: data.skills?.map((skill) => ({ name: skill.name, text: skill.text })),
      };
      return withImage(view);
    },
    retreatCost(cardRef) {
      return Array.from({
        length: cardRef ? dataMaps.cardData[cardRef.id]?.retreatCost ?? 0 : 0,
      }, () => 'Colorless');
    },
    cardNames: Object.values(dataMaps.cardData).map((card) => card.name),
  };
}

export function createReplayCabtCardCatalog(
  cards: CabtReplayCardRow[],
  attacks: CabtReplayAttackRow[],
): CabtCardViewCatalog {
  const cardDatabase = new Map<number, CabtReplayCardRow>(cards.map((card) => [card.id, card]));
  const attackDatabase = new Map<number, CabtReplayAttackRow>(attacks.map((attack) => [attack.attackId, attack]));

  function retreatCostFor(data: CabtReplayCardRow | undefined): number {
    return data?.retreat ?? data?.retreatCost ?? 0;
  }

  function attacksForCard(data: CabtReplayCardRow | undefined): CardView['attacks'] {
    if (!data) {
      return undefined;
    }
    const engineAttacks = data.attacks
      ?.map((attackId) => attackDatabase.get(attackId))
      .filter((attack): attack is CabtReplayAttackRow => !!attack);
    if (engineAttacks?.length) {
      return engineAttacks.map((attack) => ({
        name: displayName(attack.name),
        cost: (attack.energies ?? []).map(energyName),
        damage: attack.damage ? String(attack.damage) : '',
        text: attack.text ?? '',
      }));
    }
    if (!data.attackName) {
      return undefined;
    }
    return [{
      name: data.attackName,
      cost: energyCostLabels(data.attackCost ?? ''),
      damage: data.attackDamage ?? '',
      text: data.attackText ?? '',
    }];
  }

  return {
    cardToView(cardRef) {
      const data = cardDatabase.get(cardRef.id);
      const rawName = cardRef.name || data?.name || `Card ${cardRef.id}`;
      const name = displayName(rawName);
      const kind = data?.kind ?? '';
      const isPokemon = kind.includes('Pokemon') || kind.includes('Pokémon') || !!data?.hp;
      const isEnergy = kind.includes('Energy') || /Energy\b/.test(rawName);
      const isTrainer = !isPokemon && !isEnergy;
      return withImage({
        id: cardRef.id,
        name,
        fullName: name,
        set: data?.set || undefined,
        setNumber: data?.setNumber || undefined,
        superType: isPokemon ? 'Pokemon' : isEnergy ? 'Energy' : 'Trainer',
        cardType: isPokemon ? energySymbolToType(data?.type) : undefined,
        trainerType: isTrainer ? kind : undefined,
        energyType: isEnergy ? energySymbolToType(data?.type || rawName) : undefined,
        stage: stageLabel(kind),
        evolvesFrom: data?.evolvesFrom || undefined,
        hp: data?.hp ?? undefined,
        retreat: Array.from({ length: retreatCostFor(data) }, () => 'Colorless'),
        attacks: attacksForCard(data),
      });
    },
    retreatCost(cardRef) {
      return Array.from({ length: retreatCostFor(cardDatabase.get(cardRef?.id ?? -1)) }, () => 'Colorless');
    },
    cardNames: [...new Set(cards.map((card) => card.name))],
  };
}

export function faceDownCard(): CardView {
  return {
    name: 'Card',
    fullName: 'Card',
  };
}

function buildPlayerView(
  player: CabtViewPlayerState,
  index: number,
  activePlayerIndex: number,
  options: CabtViewAdapterOptions,
): PlayerView {
  const hand = player.hand ?? [];
  const bench = player.bench ?? [];
  return {
    index,
    id: index,
    name: options.playerNames?.[index] ?? `Player ${index + 1}`,
    hand: hand.length
      ? hand.map(options.cardCatalog.cardToView)
      : Array.from({ length: player.handCount ?? 0 }, () => faceDownCard()),
    deckCount: player.deckCount ?? 0,
    discard: (player.discard ?? []).map(options.cardCatalog.cardToView),
    lostZone: [],
    stadium: stadiumForPlayer(options.current?.stadium ?? [], index).map(options.cardCatalog.cardToView),
    playZone: [],
    prizesLeft: player.prize?.length ?? 0,
    active: pokemonToSlot(player.active?.[0] ?? null, index, 'active', 0, activePlayerIndex, player, options.cardCatalog),
    bench: Array.from({ length: Math.max(player.benchMax ?? 5, bench.length) }, (_item, benchIndex) =>
      pokemonToSlot(bench[benchIndex] ?? null, index, 'bench', benchIndex, activePlayerIndex, player, options.cardCatalog),
    ),
    playableCardIds: hand.map((card) => card.id),
    availableActions: options.availableActionsForPlayer?.(player, index, activePlayerIndex) ?? inertAvailableActions(player),
  };
}

function pokemonToSlot(
  pokemonCard: CabtViewPokemonRef | null,
  ownerIndex: number,
  slot: 'active' | 'bench',
  index: number,
  activePlayerIndex: number,
  player: CabtViewPlayerState,
  cardCatalog: CabtCardViewCatalog,
): PokemonSlotView {
  const slotType = slot === 'active' ? SlotType.ACTIVE : SlotType.BENCH;
  const pokemonView = pokemonCard ? cardCatalog.cardToView(pokemonCard) : undefined;
  const maxHp = pokemonCard?.maxHp ?? pokemonView?.hp ?? 0;
  const currentHp = pokemonCard?.hp ?? maxHp;
  return {
    ownerIndex,
    slot,
    index,
    target: targetFor(activePlayerIndex, ownerIndex, slotType, index),
    empty: !pokemonCard,
    pokemon: pokemonView,
    cards: pokemonView ? [pokemonView, ...(pokemonCard?.preEvolution ?? []).map(cardCatalog.cardToView)] : [],
    damage: Math.max(0, maxHp - currentHp),
    hp: maxHp,
    retreat: cardCatalog.retreatCost(pokemonCard),
    energy: (pokemonCard?.energyCards ?? []).map(cardCatalog.cardToView),
    tools: (pokemonCard?.tools ?? []).map(cardCatalog.cardToView),
    specialConditions: [
      player.poisoned ? 'Poisoned' : null,
      player.burned ? 'Burned' : null,
      player.asleep ? 'Asleep' : null,
      player.paralyzed ? 'Paralyzed' : null,
      player.confused ? 'Confused' : null,
    ].filter((condition): condition is string => !!condition),
  };
}

function stadiumForPlayer(stadium: CabtViewCardRef[], playerIndex: number) {
  const owned = stadium.filter((item) => item.playerIndex === playerIndex);
  return owned.length ? owned : stadium.filter((item) => item.playerIndex === undefined || item.playerIndex === null);
}

function inertAvailableActions(player: CabtViewPlayerState): PlayerView['availableActions'] {
  return {
    active: {
      attacks: [],
      abilities: [],
      retreat: { legal: false, targets: [] },
    },
    bench: (player.bench ?? []).map((_bench, benchIndex) => ({ index: benchIndex, abilities: [] })),
  };
}

function unknownCard(id: number): CardView {
  return {
    id,
    name: `Card ${id}`,
    fullName: `Card ${id}`,
  };
}

function withImage(view: CardView): CardView {
  return {
    ...view,
    imageUrl: resolveCardImageUrl(view),
  };
}

function displayName(name: string): string {
  return name
    .replaceAll('{G}', 'Grass')
    .replaceAll('{R}', 'Fire')
    .replaceAll('{W}', 'Water')
    .replaceAll('{L}', 'Lightning')
    .replaceAll('{P}', 'Psychic')
    .replaceAll('{F}', 'Fighting')
    .replaceAll('{D}', 'Darkness')
    .replaceAll('{M}', 'Metal')
    .replaceAll('{C}', 'Colorless');
}

function energySymbolToType(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  if (value.includes('{G}') || /grass/i.test(value)) return 1;
  if (value.includes('{R}') || /fire/i.test(value)) return 2;
  if (value.includes('{W}') || /water/i.test(value)) return 3;
  if (value.includes('{L}') || /lightning/i.test(value)) return 4;
  if (value.includes('{P}') || /psychic/i.test(value)) return 5;
  if (value.includes('{F}') || /fighting/i.test(value)) return 6;
  if (value.includes('{D}') || /dark/i.test(value)) return 7;
  if (value.includes('{M}') || /metal/i.test(value)) return 8;
  return 0;
}

function energyCostLabels(cost: string): string[] {
  return [...cost.matchAll(/\{([A-Z])\}/g)].map((match) => displayName(`{${match[1]}}`));
}

function energyName(energy: number): string {
  return energyNames[energy] ?? 'Colorless';
}

function stageLabel(kind: string): string | undefined {
  if (kind.includes('Basic Pokemon') || kind.includes('Basic Pokémon')) return 'Basic';
  if (kind.includes('Stage 1')) return 'Stage 1';
  if (kind.includes('Stage 2')) return 'Stage 2';
  return undefined;
}

function clampPlayerIndex(index: number): number {
  return index === 1 ? 1 : 0;
}
