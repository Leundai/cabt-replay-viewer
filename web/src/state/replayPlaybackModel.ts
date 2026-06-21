export type ReplayPlaybackSpeedId = 'slow' | 'normal' | 'fast' | 'turbo';

export type ReplayPlaybackSpeed = {
  id: ReplayPlaybackSpeedId;
  label: string;
  multiplier: number;
  intervalMs: number;
  motionBudgetMs: number;
};

const REPLAY_PLAYBACK_BASE_INTERVAL_MS = 1600;
const REPLAY_MOTION_SETTLE_MS = 160;
const MIN_REPLAY_MOTION_BUDGET_MS = 260;
const MAX_REPLAY_MOTION_BUDGET_MS = 1800;

const speedDefinitions: Array<{ id: ReplayPlaybackSpeedId; label: string; multiplier: number }> = [
  { id: 'slow', label: '0.5x', multiplier: 0.5 },
  { id: 'normal', label: '1x', multiplier: 1 },
  { id: 'fast', label: '2x', multiplier: 2 },
  { id: 'turbo', label: '4x', multiplier: 4 },
];

export const REPLAY_PLAYBACK_SPEEDS: ReplayPlaybackSpeed[] = speedDefinitions.map((speed) => {
  const intervalMs = Math.round(REPLAY_PLAYBACK_BASE_INTERVAL_MS / speed.multiplier);
  return {
    ...speed,
    intervalMs,
    motionBudgetMs: Math.min(
      MAX_REPLAY_MOTION_BUDGET_MS,
      Math.max(MIN_REPLAY_MOTION_BUDGET_MS, intervalMs - REPLAY_MOTION_SETTLE_MS),
    ),
  };
});

export const DEFAULT_REPLAY_PLAYBACK_SPEED: ReplayPlaybackSpeedId = 'normal';

export function normalizeReplayPlaybackSpeed(id: string): ReplayPlaybackSpeed {
  return REPLAY_PLAYBACK_SPEEDS.find((speed) => speed.id === id)
    ?? REPLAY_PLAYBACK_SPEEDS.find((speed) => speed.id === DEFAULT_REPLAY_PLAYBACK_SPEED)
    ?? REPLAY_PLAYBACK_SPEEDS[0];
}

export function replayMotionBudgetMs(speedId: ReplayPlaybackSpeedId): number {
  return normalizeReplayPlaybackSpeed(speedId).motionBudgetMs;
}

export function nextReplayPlaybackStep(stepIndex: number, maxStepIndex: number): { stepIndex: number; shouldContinue: boolean } {
  const max = Math.max(0, Math.round(maxStepIndex));
  const current = clampStep(stepIndex, max);
  if (current >= max) {
    return { stepIndex: max, shouldContinue: false };
  }
  const next = current + 1;
  return {
    stepIndex: next,
    shouldContinue: next < max,
  };
}

export function canStartReplayPlayback(hasReplay: boolean, stepIndex: number, maxStepIndex: number): boolean {
  return hasReplay && clampStep(stepIndex, maxStepIndex) < Math.max(0, Math.round(maxStepIndex));
}

function clampStep(value: number, maxStepIndex: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(Math.max(0, Math.round(value)), Math.max(0, Math.round(maxStepIndex)));
}
