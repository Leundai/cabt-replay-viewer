import { describe, expect, it } from 'vitest';
import {
  canStartReplayPlayback,
  nextReplayPlaybackStep,
  normalizeReplayPlaybackSpeed,
  replayMotionBudgetMs,
} from './replayPlaybackModel';

describe('replay playback model', () => {
  it('normalizes unknown speeds to the default speed', () => {
    expect(normalizeReplayPlaybackSpeed('missing').id).toBe('normal');
    expect(normalizeReplayPlaybackSpeed('fast')).toEqual({
      id: 'fast',
      label: '2x',
      multiplier: 2,
      intervalMs: 800,
      motionBudgetMs: 640,
    });
  });

  it('uses a readable 1x cadence and derives faster/slower speeds from it', () => {
    expect(normalizeReplayPlaybackSpeed('slow').intervalMs).toBe(3200);
    expect(normalizeReplayPlaybackSpeed('normal').intervalMs).toBe(1600);
    expect(normalizeReplayPlaybackSpeed('fast').intervalMs).toBe(800);
    expect(normalizeReplayPlaybackSpeed('turbo').intervalMs).toBe(400);
  });

  it('exposes a motion budget that follows the selected speed', () => {
    expect(replayMotionBudgetMs('slow')).toBeGreaterThan(replayMotionBudgetMs('normal'));
    expect(replayMotionBudgetMs('normal')).toBeGreaterThan(replayMotionBudgetMs('fast'));
    expect(replayMotionBudgetMs('fast')).toBeGreaterThan(replayMotionBudgetMs('turbo'));
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
