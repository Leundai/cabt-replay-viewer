export type ReplayPlaybackSpeedId = 'slow' | 'normal' | 'fast' | 'turbo';

export type ReplayPlaybackSpeed = {
  id: ReplayPlaybackSpeedId;
  label: string;
  intervalMs: number;
};

export const REPLAY_PLAYBACK_SPEEDS: ReplayPlaybackSpeed[] = [
  { id: 'slow', label: '0.5x', intervalMs: 1400 },
  { id: 'normal', label: '1x', intervalMs: 800 },
  { id: 'fast', label: '2x', intervalMs: 400 },
  { id: 'turbo', label: '4x', intervalMs: 200 },
];

export const DEFAULT_REPLAY_PLAYBACK_SPEED: ReplayPlaybackSpeedId = 'normal';

export function normalizeReplayPlaybackSpeed(id: string): ReplayPlaybackSpeed {
  return REPLAY_PLAYBACK_SPEEDS.find((speed) => speed.id === id)
    ?? REPLAY_PLAYBACK_SPEEDS.find((speed) => speed.id === DEFAULT_REPLAY_PLAYBACK_SPEED)
    ?? REPLAY_PLAYBACK_SPEEDS[0];
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
