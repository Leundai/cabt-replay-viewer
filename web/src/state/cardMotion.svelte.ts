import { SvelteSet } from 'svelte/reactivity';
import type { GameView } from '../lib/game/types';
import { prefersReducedMotion } from '../lib/motion';
import type { ReplayPlaybackSpeedId } from './replayPlaybackModel';
import {
  deriveMotionIntents,
  logDelta,
  planEligibility,
  type AttackIntent,
  type TravelIntent,
} from './cardMotionModel';

export type {
  AttackIntent,
  DrawIntent,
  PlayIntent,
  PrizeIntent,
  TravelIntent,
} from './cardMotionModel';

export type MotionBatch = {
  batchId: number;
  attack: AttackIntent | null;
  travels: TravelIntent[];
  budgetMs: number;
  reduced: boolean;
};

export type OnStepArgs = {
  prevView: GameView | null;
  nextView: GameView | null;
  prevIndex: number;
  nextIndex: number;
  speedId: ReplayPlaybackSpeedId;
  playing: boolean;
};

/**
 * Reactive card-motion store. Holds the current motion batch and owns the gating
 * lifecycle; all derivation/gating logic lives in the pure cardMotionModel. The
 * board stays a pure function of the snapshot, so dropping a batch is always safe.
 */
class CardMotionStore {
  batch = $state<MotionBatch | null>(null);

  /** Slot keys whose real card is hidden while its play-clone is in flight, so
   *  the board doesn't pop the card into place ahead of the cinematic. Seeded
   *  synchronously when a batch publishes (same flush as the snapshot render, so
   *  there is never a one-frame flash) and released as each clone lands. */
  readonly suppressedDests = new SvelteSet<string>();

  /** Hand-card landing keys (`hand-{owner}-{i}`) whose real card is hidden while
   *  its deck→hand draw clone is in flight. The mirror of suppressedDests for the
   *  draw hand-off: the flight IS the card's entrance, so the real sorted hand
   *  card stays hidden (and skips its handEnter) until the clone lands on it —
   *  one continuous card, exactly like prototype E's flyFromTo. */
  readonly suppressedHand = new SvelteSet<string>();

  /** How many freshly-drawn cards owner `owner` is still hand-off-suppressing.
   *  Hand marks its LAST N sorted cards hidden (draws append then sort, so the
   *  newest cards are the trailing ones once sorted). Reactive (reads the set). */
  suppressedHandCount(owner: number): number {
    let n = 0;
    for (const key of this.suppressedHand) {
      if (key.startsWith(`hand-${owner}-`)) {
        n += 1;
      }
    }
    return n;
  }

  #batchSeq = 0;
  #lastStepAt = 0;
  #clearTimer: ReturnType<typeof setTimeout> | null = null;

  /** The active batch's motion budget, exposed so the hand reflow / entrance can
   *  share the same clock the overlay plans the flight against (so the hand
   *  expands WITH the arrival, not 280ms before it). 0 when no batch is live. */
  get activeBudgetMs(): number {
    return this.batch?.budgetMs ?? 0;
  }

  isSuppressed(key: string): boolean {
    return this.suppressedDests.has(key);
  }

  isHandSuppressed(key: string): boolean {
    return this.suppressedHand.has(key);
  }

  /** Reveal a landed card — called by the overlay when its clone settles. */
  releaseDest(key: string): void {
    this.suppressedDests.delete(key);
  }

  /** Reveal a landed hand card — called by the overlay when its draw clone lands. */
  releaseDrawHand(key: string): void {
    this.suppressedHand.delete(key);
  }

  /** Plan and (maybe) publish a motion batch for a step transition. */
  onStep(args: OnStepArgs): void {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const dir = args.nextIndex - args.prevIndex;
    const dt = now - this.#lastStepAt;
    // Only genuine forward steps set the cadence clock; a suppressed load/scrub/
    // backward step must not make the next real step look like rapid mashing.
    if (dir === 1) {
      this.#lastStepAt = now;
    }

    const hidden = typeof document !== 'undefined' && document.hidden;
    const eligibility = planEligibility({
      dir,
      prevViewKnown: !!args.prevView,
      speedId: args.speedId,
      playing: args.playing,
      dt,
      hidden,
    });

    if (!eligibility) {
      this.#publish(null);
      return;
    }

    const delta = logDelta(args.prevView, args.nextView);
    const { attack, travels } = deriveMotionIntents(args.prevView, args.nextView, delta);

    const allowedTravels = travels.filter((travel) => {
      if (travel.kind === 'draw') {
        return eligibility.draw;
      }
      if (travel.kind === 'prize') {
        return eligibility.prize;
      }
      return eligibility.reveal;
    });
    const allowedAttack = eligibility.attack ? attack : null;

    if (!allowedAttack && allowedTravels.length === 0) {
      this.#publish(null);
      return;
    }

    this.#publish({
      batchId: ++this.#batchSeq,
      attack: allowedAttack,
      travels: allowedTravels,
      budgetMs: eligibility.budgetMs,
      reduced: prefersReducedMotion(),
    });
  }

  clearAll(): void {
    this.#lastStepAt = 0;
    this.#publish(null);
  }

  #publish(batch: MotionBatch | null): void {
    if (this.#clearTimer) {
      clearTimeout(this.#clearTimer);
      this.#clearTimer = null;
    }
    this.batch = batch;

    // Re-seed suppression for this batch. Clearing first releases any card still
    // hidden by a superseded batch, so nothing can ever get stuck invisible.
    this.suppressedDests.clear();
    this.suppressedHand.clear();
    // The overlay caps draw + prize-take flights to 7 / 6 respectively; suppress
    // the same count so a hidden hand card always has a clone coming for it.
    const DRAW_CAP = 7;
    const PRIZE_CAP = 6;
    if (batch && !batch.reduced) {
      for (const travel of batch.travels) {
        // Only cards that actually land in a slot are hidden; a reveal that fades
        // at centre (no slot dest) has no real card to hand off to.
        if (travel.kind === 'play' && travel.destSelector?.startsWith('slot-')) {
          this.suppressedDests.add(travel.destSelector);
        } else if (travel.kind === 'draw') {
          const n = Math.min(travel.count, DRAW_CAP);
          for (let i = 0; i < n; i += 1) {
            this.suppressedHand.add(`hand-${travel.ownerIndex}-${i}`);
          }
        } else if (travel.kind === 'prize' && travel.mode === 'take') {
          // Prize-take hands off into the claiming owner's hand like a draw.
          const n = Math.min(travel.count, PRIZE_CAP);
          for (let i = 0; i < n; i += 1) {
            this.suppressedHand.add(`hand-${travel.ownerIndex}-${i}`);
          }
        }
      }
    }

    if (batch && typeof setTimeout !== 'undefined') {
      // Tear the batch down once the longest effect has settled so no ghost
      // lingers into a later, un-stepped frame (the paused single-step case).
      // Also a safety net: any card not released by its clone is revealed here.
      this.#clearTimer = setTimeout(() => {
        this.batch = null;
        this.suppressedDests.clear();
        this.suppressedHand.clear();
        this.#clearTimer = null;
      }, batch.budgetMs + 220);
    }
  }
}

export const cardMotionStore = new CardMotionStore();
