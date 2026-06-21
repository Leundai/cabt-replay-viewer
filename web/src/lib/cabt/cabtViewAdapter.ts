import { resolveCardImageUrl } from '../game/cardImages';
import { energyNameFromCode, normalizeEnergyType, replaceEnergySymbols } from '../game/energy';
import { prizeZone } from '../game/prizeZone';
import {
  type CardView,
  type GameView,
  type LogView,
  type PlayerView,
  type PokemonSlotView,
} from '../game/types';

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
  retreatCost: (cardRef: CabtViewPokemonRef | null | undefined) => string[];
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
  winnerForResult?: (result: number) => number | undefined;
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
      logs: options.logs,
      events: options.events,
    };
  }

  const activePlayerIndex = clampPlayerIndex(current.yourIndex);
  const players = current.players.map((player, index) =>
    buildPlayerView(player, index, options),
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
    logs: options.logs,
    events: options.events,
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
        cost: (attack.energies ?? []).map(energyNameFromCode),
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
        cardType: isPokemon ? normalizeEnergyType(data?.type) : undefined,
        trainerType: isTrainer ? kind : undefined,
        energyType: isEnergy ? normalizeEnergyType(data?.type || rawName) : undefined,
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
  options: CabtViewAdapterOptions,
): PlayerView {
  const hand = player.hand ?? [];
  const bench = player.bench ?? [];
  const prizes = prizeZone(
    (player.prize ?? []).map((cardRef) =>
      cardRef ? options.cardCatalog.cardToView(cardRef) : faceDownCard(),
    ),
    player.prize !== undefined,
  );
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
    prizes,
    active: pokemonToSlot(player.active?.[0] ?? null, index, 'active', 0, player, options.cardCatalog),
    bench: Array.from({ length: Math.max(player.benchMax ?? 5, bench.length) }, (_item, benchIndex) =>
      pokemonToSlot(bench[benchIndex] ?? null, index, 'bench', benchIndex, player, options.cardCatalog),
    ),
  };
}

function pokemonToSlot(
  pokemonCard: CabtViewPokemonRef | null,
  ownerIndex: number,
  slot: 'active' | 'bench',
  index: number,
  player: CabtViewPlayerState,
  cardCatalog: CabtCardViewCatalog,
): PokemonSlotView {
  const pokemonView = pokemonCard ? cardCatalog.cardToView(pokemonCard) : undefined;
  const maxHp = pokemonCard?.maxHp ?? pokemonView?.hp ?? 0;
  const currentHp = pokemonCard?.hp ?? maxHp;
  return {
    ownerIndex,
    slot,
    index,
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

function withImage(view: CardView): CardView {
  return {
    ...view,
    imageUrl: resolveCardImageUrl(view),
  };
}

function displayName(name: string): string {
  return replaceEnergySymbols(name);
}

function energyCostLabels(cost: string): string[] {
  return [...cost.matchAll(/\{([A-Z])\}/g)].map((match) => displayName(`{${match[1]}}`));
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
