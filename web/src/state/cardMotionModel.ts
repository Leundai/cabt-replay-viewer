import type { CardView, GameView, PlayerView } from '../lib/game/types';
import { attackEffectKind, type AttackEffectKind } from '../lib/motionEffects';
import { replayMotionBudgetMs, type ReplayPlaybackSpeedId } from './replayPlaybackModel';

/**
 * Pure card-motion model. Turns the replay's append-only log stream into
 * transient, TCG-flavoured motion intents (attack lunge, deck draw,
 * play-to-centre reveal) and decides when a cinematic is allowed to play.
 *
 * Kept DOM-free and rune-free (mirrors the replayPlaybackModel / replay.svelte
 * split) so it is unit-testable in a plain node environment. The reactive store
 * in cardMotion.svelte.ts is a thin wrapper around these functions.
 *
 * Design notes (verified against real CABT replays):
 *  - The log delta for entering a step is `nextView.logs.slice(prevView.logs.length)`.
 *    `logs` is append-only and cumulative, so the slice is robust. We deliberately
 *    do NOT key off the raw `serial` field — it is a per-card instance id, not a
 *    monotonic event counter (it repeats and jumps around).
 *  - Cinematics only ever fire on a single forward transition (dir === 1) at a
 *    calm cadence. Backward steps, multi-step jumps (scrubbing the timeline by
 *    more than one notch / first/last), rapid mashing and turbo autoplay are
 *    suppressed. A deliberate one-notch forward nudge animates like a step —
 *    that is intentional and harmless (the board is a pure function anyway).
 *  - Intents carry selector STRINGS (encoding the stable ownerIndex), never DOM
 *    nodes, so consumers resolve live rects at play time and it survives switch-sides.
 */

export type RawLog = {
  type?: string;
  playerIndex?: number;
  cardId?: number;
  attackId?: number;
  serial?: number;
  fromArea?: number;
  toArea?: number;
  value?: number;
};

export type AttackIntent = {
  attackerKey: string;
  defenderKey: string;
  attackerOwner: number;
  defenderOwner: number;
  effectKind: AttackEffectKind;
  /** True when the slot's Pokemon changed this step (KO + replacement); the
   *  consumer skips the in-place move and lets the cardSwap transition own it. */
  attackerReplaced: boolean;
  defenderReplaced: boolean;
};

export type DrawIntent = {
  id: string;
  kind: 'draw';
  ownerIndex: number;
  count: number;
  /** The drawn cards' artwork, in draw order, parallel to `count`. Lets the
   *  overlay fly a FACE-UP clone for the bottom (face-up) owner that matches the
   *  card landing in the hand — so the flight is one continuous object, not a
   *  cardback ghost beside a separately-materialising face. Optional and purely
   *  additive: `count` is unchanged (the coalescing tests lock it). Entries may
   *  be null when the card's art can't be resolved (fall back to a cardback). */
  cards?: (CardView | null)[];
};

export type PlayIntent = {
  id: string;
  kind: 'play';
  ownerIndex: number;
  cardId: number;
  card: CardView | null;
  destSelector: string | null;
};

/** A facedown prize-card travel, derived from the prizesLeft snapshot DELTA.
 *  `setup` deals cards deck -> prize grid (they STAY); `take` lifts a claimed
 *  prize grid -> hand. `count` is how many prizes moved this step; the overlay
 *  caps the rendered flights to the 6-cell grid. Owner-keyed like DrawIntent. */
export type PrizeIntent = {
  id: string;
  kind: 'prize';
  ownerIndex: number;
  count: number;
  mode: 'setup' | 'take';
};

export type TravelIntent = DrawIntent | PlayIntent | PrizeIntent;

export type MotionIntents = {
  attack: AttackIntent | null;
  travels: TravelIntent[];
};

export type MotionEligibility = {
  attack: boolean;
  draw: boolean;
  reveal: boolean;
  prize: boolean;
  budgetMs: number;
};

const RAPID_STEP_MS = 220;
const RAPID_STEP_MOTION_BUDGET_MS = 260;

function slotKey(owner: number, kind: 'active' | 'bench', index: number): string {
  return `slot-${owner}-${kind}-${index}`;
}

/** Read a LogView's raw params as a typed CABT log entry. */
export function rawLog(entry: { params?: unknown }): RawLog {
  return (entry?.params ?? {}) as RawLog;
}

/** New log entries for the transition prevView -> nextView. Append-only, so a
 *  plain length-based slice is correct and far more robust than serial diffing. */
export function logDelta(prevView: GameView | null, nextView: GameView | null): RawLog[] {
  if (!nextView) {
    return [];
  }
  const start = prevView?.logs.length ?? 0;
  return nextView.logs.slice(start).map(rawLog);
}

function pokemonName(view: GameView | null, owner: number): string | undefined {
  return view?.players[owner]?.active?.pokemon?.fullName;
}

/** Find the played card's CardView anywhere in a player's view by id, so the
 *  reveal always shows the RIGHT art even when it lands in a zone we don't
 *  anchor to. (CardView.id is a species id, so this is the right artwork; the
 *  exact instance is irrelevant for a cinematic.) */
function findCardById(player: PlayerView, cardId: number): CardView | null {
  const flat: CardView[] = [
    ...player.hand,
    ...player.discard,
    ...player.lostZone,
    ...player.stadium,
    ...player.prizes.cards,
  ];
  for (const slot of [player.active, ...player.bench]) {
    if (slot?.pokemon) flat.push(slot.pokemon);
    flat.push(...(slot?.energy ?? []), ...(slot?.tools ?? []));
  }
  return flat.find((card) => card.id === cardId) ?? null;
}

/** Last-resort art lookup: scan every player's zones for the card's species id.
 *  A played card can land in (or originate from) the other player's view, so a
 *  single-player search sometimes misses the artwork and the reveal would skip. */
function findCardAnywhere(view: GameView, cardId: number): CardView | null {
  for (const player of view.players) {
    const found = findCardById(player, cardId);
    if (found) {
      return found;
    }
  }
  return null;
}

function resolvePlayDestination(
  nextView: GameView,
  owner: number,
  cardId: number,
): { selector: string | null; card: CardView | null } {
  const player = nextView.players[owner];
  if (!player) {
    return { selector: null, card: null };
  }
  if (player.active?.pokemon?.id === cardId) {
    return { selector: slotKey(owner, 'active', 0), card: player.active.pokemon ?? null };
  }
  const benchIndex = player.bench.findIndex((slot) => slot.pokemon?.id === cardId);
  if (benchIndex >= 0) {
    return { selector: slotKey(owner, 'bench', benchIndex), card: player.bench[benchIndex].pokemon ?? null };
  }
  // Trainers / items resolve to the discard pile after they take effect — but
  // ONLY when the card actually matches; never fall back to an unrelated card.
  const discardCard = player.discard.find((card) => card.id === cardId);
  if (discardCard) {
    return { selector: `discard-pile-${owner}`, card: discardCard };
  }
  // Otherwise surface the played card's art (found in any zone) at centre and
  // fade — or, if it can't be located, show nothing rather than a wrong card.
  return { selector: null, card: findCardById(player, cardId) ?? findCardAnywhere(nextView, cardId) };
}

/**
 * Pure intent derivation from a log delta. `prevView` is used only to detect
 * KO+replacement so the attack consumer can defer to the cardSwap transition
 * instead of fighting it.
 */
export function deriveMotionIntents(
  prevView: GameView | null,
  nextView: GameView | null,
  delta: RawLog[],
): MotionIntents {
  if (!nextView) {
    return { attack: null, travels: [] };
  }

  let attack: AttackIntent | null = null;
  // Map keeps first-insertion order, so it doubles as the draw ordering. `cards`
  // collects the resolved art per drawn card (in draw order) without touching the
  // locked `count`.
  const draws = new Map<number, { count: number; firstIndex: number; cards: (CardView | null)[] }>();
  const plays: TravelIntent[] = [];

  delta.forEach((log, index) => {
    if (log.type === 'Attack' && typeof log.playerIndex === 'number') {
      const attacker = log.playerIndex;
      const defender = attacker === 0 ? 1 : 0;
      const attackerSlot = nextView.players[attacker]?.active;
      const defenderSlot = nextView.players[defender]?.active;
      if (attackerSlot && !attackerSlot.empty && defenderSlot && !defenderSlot.empty) {
        // Keep the first attack of a delta; CABT only resolves one per step.
        attack ??= {
          attackerKey: slotKey(attacker, 'active', 0),
          defenderKey: slotKey(defender, 'active', 0),
          attackerOwner: attacker,
          defenderOwner: defender,
          effectKind: attackEffectKind(attackerSlot.pokemon?.cardType),
          attackerReplaced: pokemonName(prevView, attacker) !== pokemonName(nextView, attacker),
          defenderReplaced: pokemonName(prevView, defender) !== pokemonName(nextView, defender),
        };
      }
      return;
    }
    if (log.type === 'Draw' && typeof log.playerIndex === 'number') {
      // Resolve the drawn card's art so the face-up flight matches what lands.
      // CardView.id is a species id (right artwork, instance irrelevant for a
      // cinematic); a missing cardId or unfound art yields null (cardback fallback).
      const owner = log.playerIndex;
      const drawnCard =
        typeof log.cardId === 'number'
          ? (nextView.players[owner] ? findCardById(nextView.players[owner], log.cardId) : null) ??
            findCardAnywhere(nextView, log.cardId)
          : null;
      const existing = draws.get(owner);
      if (existing) {
        existing.count += 1;
        existing.cards.push(drawnCard);
      } else {
        draws.set(owner, { count: 1, firstIndex: index, cards: [drawnCard] });
      }
      return;
    }
    if (log.type === 'Play' && typeof log.playerIndex === 'number' && typeof log.cardId === 'number') {
      const { selector, card } = resolvePlayDestination(nextView, log.playerIndex, log.cardId);
      plays.push({
        id: `play-${log.playerIndex}-${log.cardId}-${index}`,
        kind: 'play',
        ownerIndex: log.playerIndex,
        cardId: log.cardId,
        card,
        destSelector: selector,
      });
    }
  });

  // Draws lead the batch (in first-seen order) so the "pull from deck" reads
  // before any reveal.
  const drawTravels: TravelIntent[] = [...draws.entries()].map(([owner, entry]) => ({
    id: `draw-${owner}-${entry.firstIndex}`,
    kind: 'draw',
    ownerIndex: owner,
    count: entry.count,
    cards: entry.cards,
  }));

  // Prizes from the prizesLeft snapshot DELTA per owner (robust — no log-area
  // bookkeeping). prizesLeft RISING from 0/unknown is a setup deal-out; FALLING
  // is a claim. We deliberately ignore the MoveCard logs here so a single source
  // of truth (the count) drives both cinematics and they can never double-fire.
  const prizeTravels = derivePrizeTravels(prevView, nextView);

  return { attack, travels: [...drawTravels, ...prizeTravels, ...plays] };
}

/** Per-owner prize travels from the prizesLeft snapshot delta. Setup fires once,
 *  when prizes first appear (prev 0/undefined -> m>0); take fires when the count
 *  drops by n>0. Pure: reads only the two views' counts. */
function derivePrizeTravels(prevView: GameView | null, nextView: GameView): TravelIntent[] {
  const travels: TravelIntent[] = [];
  nextView.players.forEach((nextPlayer, owner) => {
    const next = nextPlayer.prizes?.remaining;
    if (typeof next !== 'number') {
      return;
    }
    const prev = prevView?.players[owner]?.prizes?.remaining;
    const prevCount = typeof prev === 'number' ? prev : 0;
    if (prevCount <= 0 && next > 0) {
      // Prizes appeared: deal them out from the deck onto the grid (they STAY).
      travels.push({ id: `prize-setup-${owner}`, kind: 'prize', ownerIndex: owner, count: next, mode: 'setup' });
      return;
    }
    const taken = prevCount - next;
    if (taken > 0) {
      travels.push({ id: `prize-take-${owner}`, kind: 'prize', ownerIndex: owner, count: taken, mode: 'take' });
    }
  });
  return travels;
}

/**
 * Pure gating. Returns which effect kinds are eligible and the per-batch time
 * budget, or null to suppress everything. `dt` is ms since the previous step.
 */
export function planEligibility(args: {
  dir: number;
  prevViewKnown: boolean;
  speedId: ReplayPlaybackSpeedId;
  playing: boolean;
  dt: number;
  hidden: boolean;
}): MotionEligibility | null {
  const { dir, prevViewKnown, speedId, playing, dt, hidden } = args;
  if (hidden) {
    return null;
  }
  // Only a single forward transition earns a cinematic. dir > 1 (multi-step
  // scrub / first/last) and dir <= 0 (backward / same) are suppressed.
  if (dir !== 1 || !prevViewKnown) {
    return null;
  }
  // Turbo autoplay: the board just flies; suppress everything.
  if (playing && speedId === 'turbo') {
    return null;
  }
  const budgetMs = replayMotionBudgetMs(speedId);
  // Mashing the step key (paused) outruns any cadence — clip to attack only.
  if (dt < RAPID_STEP_MS) {
    return { attack: true, draw: false, reveal: false, prize: false, budgetMs: Math.min(budgetMs, RAPID_STEP_MOTION_BUDGET_MS) };
  }
  // Fast autoplay: only the short in-place attack fits.
  if (playing && speedId === 'fast') {
    return { attack: true, draw: false, reveal: false, prize: false, budgetMs };
  }
  // Normal / slow autoplay, or any calm manual step: the full repertoire (prizes
  // ride the same gate as draws/reveals — one forward step, never on turbo).
  return { attack: true, draw: true, reveal: true, prize: true, budgetMs };
}
