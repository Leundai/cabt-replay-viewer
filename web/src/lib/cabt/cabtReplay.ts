import { cabtStateToGameView, createReplayCabtCardCatalog, type CabtReplayAttackRow, type CabtReplayCardRow, type CabtViewCurrentState, type CabtViewPlayerState, type CabtViewPokemonRef } from './cabtViewAdapter';
import type { GameView, LogView } from '../game/types';
import type { ReplaySnapshot, ReplayStep } from '../game/replay';
import { replaceEnergySymbols } from '../game/energy';
import { labelFor } from '../game/labels';

type CardRow = CabtReplayCardRow & {
  set: string;
  setNumber: string;
  kind: string;
  rule: string;
  evolvesFrom: string;
  hp: number | null;
  type: string;
  retreat: number | null;
  attackName: string;
  attackCost: string;
  attackDamage: string;
  attackText: string;
};

type CabtVisualizeFrame = {
  logs?: Array<Record<string, unknown>>;
  select?: Record<string, unknown> | null;
  selected?: unknown;
  action?: unknown;
  obs?: unknown;
  current: CabtViewCurrentState;
};

type KaggleContext = {
  id?: string;
  title?: string;
  rewards?: number[];
  statuses?: string[];
  steps?: Array<Array<{ action?: unknown; observation?: Record<string, unknown>; status?: string; reward?: number; visualize?: unknown }>>;
  info?: {
    TeamNames?: string[];
    EpisodeId?: string | number;
  };
  environment?: {
    id?: string;
    title?: string;
    rewards?: number[];
    statuses?: string[];
    steps?: Array<Array<{ action?: unknown; observation?: Record<string, unknown>; status?: string; reward?: number }>>;
    info?: {
      TeamNames?: string[];
      EpisodeId?: string | number;
    };
  };
};

type CabtRunnerJson = {
  visualize?: CabtVisualizeFrame[];
  steps?: Array<{ index?: number; action?: unknown; observation?: unknown }>;
};

const REPLAY_LIMITS = {
  frames: 10_000,
  logsPerFrame: 200,
  players: 4,
  active: 2,
  bench: 8,
  hand: 100,
  deckCount: 300,
  discard: 300,
  prize: 20,
  stadium: 4,
  attachedCards: 100,
  energyTypes: 100,
};

export type CabtReplayMetadata = {
  cardRows: CardRow[];
  attackRows: CabtReplayAttackRow[];
  cardDatabase: Map<number, CardRow>;
  attackDatabase: Map<number, CabtReplayAttackRow>;
  replayCardCatalog: ReturnType<typeof createReplayCabtCardCatalog>;
};

export function createCabtReplayMetadata(
  cardRows: CabtReplayCardRow[],
  attackRows: CabtReplayAttackRow[],
): CabtReplayMetadata {
  const rows = cardRows as CardRow[];
  return {
    cardRows: rows,
    attackRows,
    cardDatabase: new Map<number, CardRow>(rows.map((card) => [card.id, card])),
    attackDatabase: new Map<number, CabtReplayAttackRow>(attackRows.map((attack) => [attack.attackId, attack])),
    replayCardCatalog: createReplayCabtCardCatalog(cardRows, attackRows),
  };
}

export function cabtReplayToSnapshot(input: unknown, metadata: CabtReplayMetadata): ReplaySnapshot {
  const visualFrames = extractVisualizeFrames(input);
  if (!visualFrames.length) {
    throw new Error('CABT replay did not include visualize frames.');
  }
  validateVisualizeFrames(visualFrames);

  const environment = replayEnvironment(input);
  const players = playerNames(input);
  const steps: ReplayStep[] = [];
  const logs: LogView[] = [];
  const logEnds: number[] = [];
  let logId = 1;
  let turnCount = 0;
  let winner = -1;
  const viewAt = createViewResolver(visualFrames, players, logs, logEnds, metadata);

  visualFrames.forEach((frame, index) => {
    for (const entry of frame.logs ?? []) {
      logs.push({ id: logId++, message: formatLog(entry, metadata, players), params: entry });
    }
    logEnds[index] = logs.length;
    const view = viewAt(index);
    if (!view) {
      return;
    }
    turnCount = Math.max(turnCount, view.turn);
    winner = typeof view.winner === 'number' ? view.winner : winner;
    steps.push({
      index,
      label: stepLabel(frame, index, metadata, players),
      stateIndex: index,
      actionIndex: index === 0 ? null : index - 1,
      sequence: index,
      turn: view.turn,
      phase: view.phase,
      activePlayerIndex: view.activePlayerIndex,
      type: String(frame.select?.type ?? 'frame'),
      payload: {
        select: frame.select,
        selected: frame.selected,
        action: frame.action,
      },
    });
  });

  return {
    id: String(environment?.id ?? 'cabt-local-replay'),
    name: environment?.title ? `${environment.title} replay` : 'CABT replay',
    created: Date.now(),
    players: players.map((name, index) => ({ userId: index, name })),
    winner,
    stateCount: visualFrames.length,
    actionCount: Math.max(0, steps.length - 1),
    turnCount,
    cardNames: metadata.replayCardCatalog.cardNames ?? [...new Set([...metadata.cardDatabase.values()].map((card) => card.name))],
    viewAt,
    steps,
  };
}

function createViewResolver(
  frames: CabtVisualizeFrame[],
  players: string[],
  logs: LogView[],
  logEnds: number[],
  metadata: CabtReplayMetadata,
): ReplaySnapshot['viewAt'] {
  let cachedStateIndex = -1;
  let cachedView: GameView | null = null;

  return (stateIndex: number) => {
    if (!Number.isInteger(stateIndex) || stateIndex < 0 || stateIndex >= frames.length) {
      return null;
    }
    if (stateIndex === cachedStateIndex) {
      return cachedView;
    }
    cachedStateIndex = stateIndex;
    cachedView = frameToGameView(
      frames[stateIndex],
      players,
      logs.slice(0, logEnds[stateIndex] ?? logs.length),
      metadata,
    );
    return cachedView;
  };
}

function extractVisualizeFrames(input: unknown): CabtVisualizeFrame[] {
  const runnerFrames = (input as CabtRunnerJson)?.visualize;
  if (Array.isArray(runnerFrames)) {
    return runnerFrames as CabtVisualizeFrame[];
  }

  const topLevelSteps = (input as KaggleContext)?.steps;
  const topLevelFrames = framesFromKaggleSteps(topLevelSteps);
  if (topLevelFrames.length) {
    return topLevelFrames;
  }

  const steps = (input as KaggleContext)?.environment?.steps;
  const environmentFrames = framesFromKaggleSteps(steps);
  if (environmentFrames.length) {
    return environmentFrames;
  }

  return [];
}

function framesFromKaggleSteps(steps: KaggleContext['steps']): CabtVisualizeFrame[] {
  const frames = steps?.[0]?.[0]?.observation?.visualize;
  if (Array.isArray(frames)) {
    return frames as CabtVisualizeFrame[];
  }

  const firstStepFrames = (steps?.[0]?.[0] as { visualize?: unknown } | undefined)?.visualize;
  if (Array.isArray(firstStepFrames)) {
    return firstStepFrames as CabtVisualizeFrame[];
  }

  return [];
}

function validateVisualizeFrames(frames: CabtVisualizeFrame[]): void {
  assertArrayLength(frames, 'visualize frames', REPLAY_LIMITS.frames);
  frames.forEach((frame, index) => {
    if (!isRecord(frame.current)) {
      throw new Error(`CABT replay frame ${index} is missing current state.`);
    }
    assertArrayLength(frame.logs, `frame ${index} logs`, REPLAY_LIMITS.logsPerFrame, true);
    assertArrayLength(frame.current.players, `frame ${index} players`, REPLAY_LIMITS.players);
    assertArrayLength(frame.current.stadium, `frame ${index} stadium`, REPLAY_LIMITS.stadium, true);
    frame.current.players.forEach((player, playerIndex) => {
      validatePlayerState(player, `frame ${index} player ${playerIndex}`);
    });
  });
}

function validatePlayerState(player: CabtViewPlayerState, label: string): void {
  if (!isRecord(player)) {
    throw new Error(`${label} state is invalid.`);
  }
  assertArrayLength(player.active, `${label} active`, REPLAY_LIMITS.active, true);
  assertArrayLength(player.bench, `${label} bench`, REPLAY_LIMITS.bench, true);
  assertArrayLength(player.discard, `${label} discard`, REPLAY_LIMITS.discard, true);
  assertArrayLength(player.hand, `${label} hand`, REPLAY_LIMITS.hand, true);
  assertArrayLength(player.prize, `${label} prize`, REPLAY_LIMITS.prize, true);
  assertCount(player.benchMax, `${label} benchMax`, REPLAY_LIMITS.bench, true);
  assertCount(player.deckCount, `${label} deckCount`, REPLAY_LIMITS.deckCount, true);
  assertCount(player.handCount, `${label} handCount`, REPLAY_LIMITS.hand, true);
  player.active?.forEach((pokemon, index) => validatePokemonRef(pokemon, `${label} active ${index}`));
  player.bench?.forEach((pokemon, index) => validatePokemonRef(pokemon, `${label} bench ${index}`));
}

function validatePokemonRef(pokemon: CabtViewPokemonRef | null, label: string): void {
  if (pokemon == null) {
    return;
  }
  if (!isRecord(pokemon)) {
    throw new Error(`${label} pokemon is invalid.`);
  }
  assertArrayLength(pokemon.energies, `${label} energy types`, REPLAY_LIMITS.energyTypes, true);
  assertArrayLength(pokemon.energyCards, `${label} energy cards`, REPLAY_LIMITS.attachedCards, true);
  assertArrayLength(pokemon.tools, `${label} tools`, REPLAY_LIMITS.attachedCards, true);
  assertArrayLength(pokemon.preEvolution, `${label} evolution stack`, REPLAY_LIMITS.attachedCards, true);
}

function assertArrayLength(value: unknown, label: string, max: number, optional = false): asserts value is unknown[] {
  if (value == null && optional) {
    return;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  if (value.length > max) {
    throw new Error(`${label} exceeds the ${max} item limit.`);
  }
}

function assertCount(value: unknown, label: string, max: number, optional = false): void {
  if (value == null && optional) {
    return;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) {
    throw new Error(`${label} must be an integer from 0 to ${max}.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function replayEnvironment(input: unknown): NonNullable<KaggleContext['environment']> {
  const context = input as KaggleContext;
  return context.environment ?? context;
}

function frameToGameView(
  frame: CabtVisualizeFrame,
  playerNamesForReplay: string[],
  logs: LogView[],
  metadata: CabtReplayMetadata,
): GameView {
  return cabtStateToGameView({
    current: frame.current,
    activePhaseLabel: 'CABT replay',
    finishedPhaseLabel: 'Finished',
    cardCatalog: metadata.replayCardCatalog,
    playerNames: playerNamesForReplay,
    logs: [...logs],
    events: [frame],
    winnerForResult: replayWinnerForResult,
  });
}

function playerNames(input: unknown): string[] {
  const names = replayEnvironment(input)?.info?.TeamNames;
  return names?.length ? names.slice(0, REPLAY_LIMITS.players).map((name) => String(name).slice(0, 80)) : ['Player 1', 'Player 2'];
}

function stepLabel(frame: CabtVisualizeFrame, index: number, metadata: CabtReplayMetadata, players: string[]): string {
  const prizeSummary = prizeMoveSummary(frame.logs ?? [], players);
  if (prizeSummary) {
    return prizeSummary;
  }

  const attackSummary = attackLogSummary(frame.logs ?? [], metadata, players);
  if (attackSummary) {
    return attackSummary;
  }

  const latestLog = frame.logs?.at(-1);
  if (latestLog) {
    return formatLog(latestLog, metadata, players);
  }
  const selectType = frame.select?.type;
  const context = frame.select?.context;
  if (selectType || context) {
    const parts = [labelFor(selectType), labelFor(context)].filter(Boolean);
    // Dedupe so a redundant pairing like "Main · Main" reads as just "Main".
    return [...new Set(parts)].join(' · ');
  }
  return index === 0 ? 'Initial state' : `Frame ${index}`;
}

/** Prefer the real team name; fall back to a generic label only when missing. */
function actorName(playerIndex: number | undefined, players: string[]): string {
  if (playerIndex === undefined) {
    return 'Game';
  }
  return players[playerIndex] || `Player ${playerIndex + 1}`;
}

function formatLog(log: Record<string, unknown>, metadata: CabtReplayMetadata, players: string[]): string {
  const playerIndex = typeof log.playerIndex === 'number' ? log.playerIndex : undefined;
  const actor = actorName(playerIndex, players);
  const card = cardName(Number(log.cardId), metadata);
  switch (log.type) {
    case 'TurnStart':
      return `${actor} turn started.`;
    case 'TurnEnd':
      return `${actor} ended their turn.`;
    case 'Draw':
      return `${actor} drew ${card}.`;
    case 'Play':
      return `${actor} played ${card}.`;
    case 'Attach':
      return `${actor} attached ${card}.`;
    case 'Attack':
      return `${actor} used ${attackNameForLog(log, metadata)} with ${card}.`;
    case 'MoveCard':
      if (Number(log.fromArea) === 6 && Number(log.toArea) === 2) {
        return `${actor} took ${card} as a Prize card.`;
      }
      return `${actor} moved ${card} from ${areaName(log.fromArea)} to ${areaName(log.toArea)}.`;
    case 'HpChange':
    case 'HPChange':
      return `${actor}'s ${card} HP changed.`;
    case 'Result':
      return 'The battle finished.';
    default:
      return `${actor}: ${labelFor(String(log.type ?? 'Event'))}${Number.isFinite(Number(log.cardId)) ? ` ${card}` : ''}.`;
  }
}

function prizeMoveSummary(logs: Array<Record<string, unknown>>, players: string[]): string {
  const prizeMoves = logs.filter((log) => log.type === 'MoveCard' && Number(log.fromArea) === 6 && Number(log.toArea) === 2);
  if (!prizeMoves.length) {
    return '';
  }

  const playerIndex = typeof prizeMoves[0].playerIndex === 'number' ? prizeMoves[0].playerIndex : undefined;
  const samePlayer = prizeMoves.every((log) => log.playerIndex === playerIndex);
  if (!samePlayer || playerIndex === undefined) {
    return `Players took ${prizeMoves.length} Prize cards.`;
  }

  const actor = actorName(playerIndex, players);
  return prizeMoves.length === 1 ? `${actor} took 1 Prize card.` : `${actor} took ${prizeMoves.length} Prize cards.`;
}

function attackLogSummary(logs: Array<Record<string, unknown>>, metadata: CabtReplayMetadata, players: string[]): string {
  const attack = logs.find((log) => log.type === 'Attack');
  return attack ? formatLog(attack, metadata, players) : '';
}

function areaName(area: unknown): string {
  const areaMap: Record<number, string> = {
    1: 'deck',
    2: 'hand',
    3: 'discard',
    4: 'active',
    5: 'bench',
    6: 'prize',
    7: 'stadium',
    8: 'energy',
    9: 'tool',
    10: 'evolution stack',
    11: 'player',
    12: 'selection',
  };
  return areaMap[Number(area)] ?? 'zone';
}

function cardName(id: number, metadata: CabtReplayMetadata): string {
  return displayName(metadata.cardDatabase.get(id)?.name ?? (Number.isFinite(id) ? `Card ${id}` : 'a card'));
}

function attackNameForLog(log: Record<string, unknown>, metadata: CabtReplayMetadata): string {
  const attack = metadata.attackDatabase.get(Number(log.attackId));
  if (attack?.name) {
    return displayName(attack.name);
  }
  return Number.isFinite(Number(log.attackId)) ? `attack ${log.attackId}` : 'an attack';
}

function displayName(name: string): string {
  return replaceEnergySymbols(name);
}

function replayWinnerForResult(result: number): number | undefined {
  if (result >= 0 && result <= 1) {
    return result;
  }
  if (result === 2) {
    return 3;
  }
  return undefined;
}
