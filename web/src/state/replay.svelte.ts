import type { GameView } from '../lib/game/types';
import type { ReplaySnapshot, ReplayStep } from '../lib/game/replay';
import { getReplayArtifact } from '../lib/api/client';
import {
  DEFAULT_REPLAY_PLAYBACK_SPEED,
  REPLAY_PLAYBACK_SPEEDS,
  canStartReplayPlayback,
  nextReplayPlaybackStep,
  normalizeReplayPlaybackSpeed,
  type ReplayPlaybackSpeedId,
} from './replayPlaybackModel';
import { fetchReplaySource, readReplayJson, replayCandidates } from './replaySources';

class ReplayStore {
  replay = $state<ReplaySnapshot | null>(null);
  stepIndex = $state(0);
  loading = $state(false);
  error = $state('');
  copiedForkPoint = $state(false);
  playing = $state(false);
  playbackSpeedId = $state<ReplayPlaybackSpeedId>(DEFAULT_REPLAY_PLAYBACK_SPEED);
  private playbackTimer: ReturnType<typeof setInterval> | null = null;

  get currentStep(): ReplayStep | null {
    return this.replay?.steps[this.stepIndex] ?? null;
  }

  get currentView(): GameView | null {
    const replay = this.replay;
    const step = this.currentStep;
    if (!replay || !step) {
      return null;
    }
    return replay.viewAt(step.stateIndex);
  }

  get maxStepIndex(): number {
    return Math.max(0, (this.replay?.steps.length ?? 1) - 1);
  }

  get playbackSpeed() {
    return normalizeReplayPlaybackSpeed(this.playbackSpeedId);
  }

  get playbackSpeeds() {
    return REPLAY_PLAYBACK_SPEEDS;
  }

  async loadSaved(id = 'cabt-match.json'): Promise<void> {
    await this.loadFrom(() => loadCabtReplay(id));
  }

  async loadData(replayData: unknown): Promise<void> {
    await this.loadFrom(() => replayJsonToSnapshot(replayData));
  }

  async loadApiReplay(id: string): Promise<void> {
    await this.loadFrom(async () => {
      return replayJsonToSnapshot(await getReplayArtifact(id));
    });
  }

  private async loadFrom(loader: () => Promise<ReplaySnapshot>): Promise<void> {
    if (this.loading) {
      return;
    }
    this.pausePlayback();
    this.loading = true;
    this.error = '';
    this.copiedForkPoint = false;
    try {
      this.replay = await loader();
      this.stepIndex = 0;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.replay = null;
      this.stepIndex = 0;
    } finally {
      this.loading = false;
    }
  }

  clear(): void {
    this.pausePlayback();
    this.replay = null;
    this.stepIndex = 0;
    this.loading = false;
    this.error = '';
    this.copiedForkPoint = false;
  }

  setStep(index: number): void {
    this.stepIndex = clampIndex(index, this.maxStepIndex);
    this.copiedForkPoint = false;
    if (this.stepIndex >= this.maxStepIndex) {
      this.pausePlayback();
    }
  }

  nextStep(): void {
    this.setStep(this.stepIndex + 1);
  }

  previousStep(): void {
    this.setStep(this.stepIndex - 1);
  }

  firstStep(): void {
    this.setStep(0);
  }

  lastStep(): void {
    this.setStep(this.maxStepIndex);
  }

  setPlaybackSpeed(speedId: string): void {
    this.playbackSpeedId = normalizeReplayPlaybackSpeed(speedId).id;
    if (this.playing) {
      this.restartPlaybackTimer();
    }
  }

  togglePlayback(): void {
    if (this.playing) {
      this.pausePlayback();
      return;
    }
    this.startPlayback();
  }

  startPlayback(): void {
    if (!canStartReplayPlayback(!!this.replay, this.stepIndex, this.maxStepIndex)) {
      return;
    }
    this.playing = true;
    this.restartPlaybackTimer();
  }

  pausePlayback(): void {
    this.playing = false;
    if (this.playbackTimer) {
      clearInterval(this.playbackTimer);
      this.playbackTimer = null;
    }
  }

  setStateIndex(stateIndex: number): void {
    const replay = this.replay;
    if (!replay) {
      return;
    }
    const clampedState = clampIndex(stateIndex, Math.max(0, replay.stateCount - 1));
    const exact = replay.steps.findIndex((step) => step.stateIndex === clampedState);
    if (exact !== -1) {
      this.setStep(exact);
      return;
    }

    let bestIndex = 0;
    for (let index = 0; index < replay.steps.length; index += 1) {
      if (replay.steps[index].stateIndex <= clampedState) {
        bestIndex = index;
      }
    }
    this.setStep(bestIndex);
  }

  async copyForkPoint(): Promise<void> {
    const replay = this.replay;
    const step = this.currentStep;
    if (!replay || !step || typeof navigator === 'undefined' || !navigator.clipboard) {
      return;
    }

    await navigator.clipboard.writeText(JSON.stringify({
      replayId: replay.id,
      replayName: replay.name,
      stepIndex: step.index,
      stateIndex: step.stateIndex,
      actionIndex: step.actionIndex,
      actionType: step.type,
      turn: step.turn,
    }));
    this.copiedForkPoint = true;
  }

  private restartPlaybackTimer(): void {
    if (this.playbackTimer) {
      clearInterval(this.playbackTimer);
      this.playbackTimer = null;
    }
    if (!this.playing) {
      return;
    }
    this.playbackTimer = setInterval(() => {
      const next = nextReplayPlaybackStep(this.stepIndex, this.maxStepIndex);
      this.stepIndex = next.stepIndex;
      this.copiedForkPoint = false;
      if (!next.shouldContinue) {
        this.pausePlayback();
      }
    }, this.playbackSpeed.intervalMs);
  }
}

async function loadCabtReplay(id: string): Promise<ReplaySnapshot> {
  const candidates = replayCandidates(id);
  const failures: string[] = [];
  for (const url of candidates) {
    try {
      const response = await fetchReplaySource(url);
      if (!response.ok) {
        failures.push(`${url}: ${response.status}`);
        continue;
      }
      return replayJsonToSnapshot(await readReplayJson(response));
    } catch (error) {
      failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Unable to load CABT replay. Tried ${failures.join('; ')}`);
}

async function replayJsonToSnapshot(input: unknown): Promise<ReplaySnapshot> {
  const [{ cabtReplayToSnapshot, createCabtReplayMetadata }, { loadCabtGeneratedMetadata }] = await Promise.all([
    import('../lib/cabt/cabtReplay'),
    import('../lib/cabt/cabtMetadata'),
  ]);
  const metadata = await loadCabtGeneratedMetadata();
  return cabtReplayToSnapshot(input, createCabtReplayMetadata(metadata.cardRows, metadata.attackRows));
}


function clampIndex(value: number, max: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(max, Math.max(0, Math.round(value)));
}

export const replayStore = new ReplayStore();
