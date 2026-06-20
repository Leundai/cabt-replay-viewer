import { describe, expect, it } from 'vitest';
import {
  canStartReplayPlayback,
  nextReplayPlaybackStep,
  normalizeReplayPlaybackSpeed,
} from './replayPlaybackModel';

describe('replay playback model', () => {
  it('normalizes unknown speeds to the default speed', () => {
    expect(normalizeReplayPlaybackSpeed('missing').id).toBe('normal');
    expect(normalizeReplayPlaybackSpeed('fast')).toEqual({
      id: 'fast',
      label: '2x',
      intervalMs: 400,
    });
  });

  it('advances one step and stops at the end', () => {
    expect(nextReplayPlaybackStep(0, 3)).toEqual({ stepIndex: 1, shouldContinue: true });
    expect(nextReplayPlaybackStep(2, 3)).toEqual({ stepIndex: 3, shouldContinue: false });
    expect(nextReplayPlaybackStep(3, 3)).toEqual({ stepIndex: 3, shouldContinue: false });
  });

  it('starts only when a replay has remaining steps', () => {
    expect(canStartReplayPlayback(true, 0, 1)).toBe(true);
    expect(canStartReplayPlayback(true, 1, 1)).toBe(false);
    expect(canStartReplayPlayback(false, 0, 1)).toBe(false);
  });
});
