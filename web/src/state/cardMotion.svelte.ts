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

  #batchSeq = 0;
  #lastStepAt = 0;
  #clearTimer: ReturnType<typeof setTimeout> | null = null;

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

    const allowedTravels = travels.filter((travel) =>
      travel.kind === 'draw' ? eligibility.draw : eligibility.reveal,
    );
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
    if (batch && typeof setTimeout !== 'undefined') {
      // Tear the batch down once the longest effect has settled so no ghost
      // lingers into a later, un-stepped frame (the paused single-step case).
      this.#clearTimer = setTimeout(() => {
        this.batch = null;
        this.#clearTimer = null;
      }, batch.budgetMs + 220);
    }
  }
}

export const cardMotionStore = new CardMotionStore();
