<script lang="ts">
  import type { ReplaySnapshot, ReplayStep } from '../game/replay';
  import type { ReplayPlaybackSpeed, ReplayPlaybackSpeedId } from '../../state/replayPlaybackModel';
  import { labelSwap } from '../motion';

  type Props = {
    replay: ReplaySnapshot;
    step: ReplayStep;
    stepIndex: number;
    copiedForkPoint?: boolean;
    setStep: (index: number) => void;
    setStateIndex: (index: number) => void;
    previousStep: () => void;
    nextStep: () => void;
    firstStep: () => void;
    lastStep: () => void;
    copyForkPoint: () => void;
    playing?: boolean;
    playbackSpeedId?: ReplayPlaybackSpeedId;
    playbackSpeeds?: ReplayPlaybackSpeed[];
    togglePlayback?: () => void;
    setPlaybackSpeed?: (speedId: string) => void;
  };

  let {
    replay,
    step,
    stepIndex,
    copiedForkPoint = false,
    setStep,
    setStateIndex,
    previousStep,
    nextStep,
    firstStep,
    lastStep,
    copyForkPoint,
    playing = false,
    playbackSpeedId = 'normal',
    playbackSpeeds = [],
    togglePlayback = () => {},
    setPlaybackSpeed = () => {},
  }: Props = $props();

  let showInfo = $state(false);
  let maxStepIndex = $derived(Math.max(0, replay.steps.length - 1));
  let maxStateIndex = $derived(Math.max(0, replay.stateCount - 1));
  let actionValue = $derived(step.actionIndex === null ? 'Initial' : `${step.actionIndex + 1} / ${replay.actionCount}`);
  let stateValue = $derived(`${step.stateIndex} / ${maxStateIndex}`);
  let payloadPreview = $derived(formatPayload(step.payload));
  let createdLabel = $derived(Number.isFinite(replay.created) ? new Date(replay.created).toLocaleString() : '');
  let playerLabel = $derived(replay.players.map((player) => player.name).join(' vs '));

  function onStepInput(event: Event) {
    setStep(Number((event.currentTarget as HTMLInputElement).value));
  }

  function onStateInput(event: Event) {
    setStateIndex(Number((event.currentTarget as HTMLInputElement).value));
  }

  function onSpeedChange(event: Event) {
    setPlaybackSpeed((event.currentTarget as HTMLSelectElement).value);
  }

  function formatPayload(payload: unknown): string {
    if (payload === null || payload === undefined) {
      return '';
    }
    const json = JSON.stringify(payload);
    return json.length > 180 ? `${json.slice(0, 177)}...` : json;
  }
</script>

<section class="replay-dock" aria-label="Replay timeline">
  <div class="replay-caption" title={step.label}>
    {#key step.label}
      <span in:labelSwap out:labelSwap>{step.label}</span>
    {/key}
  </div>
  <div class="replay-controls" aria-label="Replay playback controls">
    <button aria-label="First action" onclick={firstStep} disabled={stepIndex === 0}>|&lt;</button>
    <button aria-label="Previous action" onclick={previousStep} disabled={stepIndex === 0}>&lt;</button>
    <button
      class="play-toggle"
      aria-label={playing ? 'Pause replay' : 'Play replay'}
      onclick={togglePlayback}
      disabled={stepIndex >= maxStepIndex}
    >
      {playing ? 'Pause' : 'Play'}
    </button>
    <input
      aria-label="Action step"
      type="range"
      min="0"
      max={maxStepIndex}
      value={stepIndex}
      oninput={onStepInput}
    />
    <label class="speed-control">
      Speed
      <select aria-label="Replay speed" value={playbackSpeedId} onchange={onSpeedChange}>
        {#each playbackSpeeds as speed}
          <option value={speed.id}>{speed.label}</option>
        {/each}
      </select>
    </label>
    <button aria-label="Next action" onclick={nextStep} disabled={stepIndex >= maxStepIndex}>&gt;</button>
    <button aria-label="Last action" onclick={lastStep} disabled={stepIndex >= maxStepIndex}>&gt;|</button>
    <button
      class="info-toggle"
      class:active={showInfo}
      aria-label="Replay details"
      aria-expanded={showInfo}
      title="Replay details"
      onclick={() => (showInfo = !showInfo)}
    >i</button>
  </div>

  {#if showInfo}
  <aside class="replay-details" aria-label="Replay details">
    <div class="replay-meta">
    <strong>{replay.name}</strong>
    <span>{playerLabel}</span>
    <span>{createdLabel}</span>
  </div>

  <div class="replay-readout">
    <span>Action <b>{actionValue}</b></span>
    <span>State <b>{stateValue}</b></span>
    <span>Turn <b>{step.turn}</b></span>
    <span>{step.label}</span>
  </div>

  <div class="state-controls">
    <label>
      State
      <input
        aria-label="State index"
        type="number"
        min="0"
        max={maxStateIndex}
        value={step.stateIndex}
        oninput={onStateInput}
      />
    </label>
    <button onclick={copyForkPoint}>{copiedForkPoint ? 'Fork point copied' : 'Copy fork point'}</button>
  </div>

    {#if payloadPreview}
      <pre>{payloadPreview}</pre>
    {/if}
  </aside>
  {/if}
</section>

<style>
  .replay-dock {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 12;
    height: var(--replay-dock-h, 48px);
    display: flex;
    align-items: center;
    padding: 7px 16px;
    border-top: 1px solid var(--surface-toolbar-border);
    background: var(--surface-toolbar-bg);
    color: var(--text-primary);
    box-shadow: var(--surface-toolbar-shadow);
    backdrop-filter: blur(var(--backdrop-blur));
    transition: opacity var(--dur-base, 220ms) var(--ease-out, ease);
  }

  .replay-caption {
    position: absolute;
    left: 50%;
    bottom: calc(100% + 7px);
    width: min(520px, calc(100% - 44px));
    transform: translateX(-50%);
    display: grid;
    justify-items: center;
    align-items: center;
    pointer-events: none;
  }

  /* Stack the outgoing and incoming caption in one cell so they crossfade
     in place (blur in labelSwap bridges them into a single morph). */
  .replay-caption > span {
    grid-area: 1 / 1;
  }

  .replay-caption span {
    max-width: 100%;
    min-width: 0;
    overflow: hidden;
    padding: 7px 13px;
    border: 1px solid var(--surface-toolbar-border);
    border-radius: 999px;
    background: var(--surface-toolbar-bg);
    color: var(--text-primary);
    box-shadow: var(--surface-toolbar-shadow);
    backdrop-filter: blur(var(--backdrop-blur));
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    font-weight: 850;
    line-height: 1;
  }

  /* Replay details popover — anchored just above the dock instead of floating at
     a hard-coded coordinate. Opens from the dock's "i" toggle. */
  .replay-details {
    position: absolute;
    bottom: calc(var(--replay-dock-h, 48px) + 8px);
    right: 14px;
    z-index: 13;
    width: 240px;
    max-height: min(60vh, 420px);
    overflow: auto;
    display: grid;
    gap: 8px;
    padding: 10px;
    border: 1px solid var(--surface-toolbar-border);
    border-radius: 8px;
    background: var(--surface-toolbar-bg);
    color: var(--text-primary);
    box-shadow: var(--surface-toolbar-shadow);
    backdrop-filter: blur(var(--backdrop-blur));

    @starting-style {
      opacity: 0;
      transform: translateY(6px);
    }
  }

  .replay-meta,
  .replay-readout,
  .state-controls {
    display: grid;
    gap: 5px;
    min-width: 0;
    font-size: 11px;
    line-height: 1.2;
  }

  .replay-meta span,
  .replay-readout span {
    min-width: 0;
    overflow: hidden;
    color: var(--text-secondary);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .replay-meta strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }

  .replay-controls {
    width: 100%;
    display: grid;
    grid-template-columns: 32px 32px minmax(0, 1fr) 32px 32px;
    align-items: center;
    gap: 8px;
  }

  .replay-controls button,
  .replay-controls select,
  .state-controls button {
    min-width: 0;
    border-radius: 5px;
    border: 1px solid var(--button-border);
    background: var(--button-bg);
    color: var(--button-text);
    font-size: 11px;
    font-weight: 800;
  }

  .replay-controls button {
    width: 32px;
    height: 30px;
    padding: 0;
  }

  .replay-controls {
    grid-template-columns: 32px 32px 64px minmax(0, 1fr) 88px 32px 32px 32px;
  }

  .play-toggle {
    width: 64px !important;
  }

  .info-toggle {
    width: 32px;
    height: 30px;
    padding: 0;
    font-style: italic;
    font-family: Georgia, "Times New Roman", serif;
  }

  .info-toggle.active {
    border-color: var(--accent-base);
    color: var(--accent-strong);
    background: var(--accent-tint);
  }

  .speed-control {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 5px;
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 800;
  }

  .speed-control select {
    width: 48px;
    height: 30px;
    padding: 0 4px;
  }

  .state-controls {
    align-items: stretch;
  }

  .state-controls label {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-secondary);
  }

  .state-controls input {
    width: 100%;
    height: 26px;
    border: 1px solid var(--input-border);
    border-radius: var(--radius-sm);
    background: var(--input-bg);
    color: var(--input-text);
    font: inherit;
    font-weight: 800;
  }

  .state-controls button {
    height: 26px;
    padding: 0 9px;
  }

  input[type='range'] {
    width: 100%;
    height: 22px;
    -webkit-appearance: none;
    appearance: none;
    background: transparent;
    cursor: pointer;
  }

  input[type='range']::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: var(--radius-pill);
    background: var(--surface-inset-border);
  }

  input[type='range']::-moz-range-track {
    height: 4px;
    border-radius: var(--radius-pill);
    background: var(--surface-inset-border);
  }

  input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    margin-top: -6px;
    width: 16px;
    height: 16px;
    border-radius: var(--radius-pill);
    border: 2px solid var(--surface-toolbar-bg);
    background: var(--accent-base);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
    transition: transform var(--dur-press) var(--ease-out);
  }

  input[type='range']::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border-radius: var(--radius-pill);
    border: 2px solid var(--surface-toolbar-bg);
    background: var(--accent-base);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
    transition: transform var(--dur-press) var(--ease-out);
  }

  /* Grab feedback while scrubbing — the thumb swells under the pointer. */
  input[type='range']:active::-webkit-slider-thumb {
    transform: scale(1.18);
  }

  input[type='range']:active::-moz-range-thumb {
    transform: scale(1.18);
  }

  @media (prefers-reduced-motion: reduce) {
    input[type='range']:active::-webkit-slider-thumb,
    input[type='range']:active::-moz-range-thumb {
      transform: none;
    }
  }

  pre {
    margin: 0;
    max-height: 66px;
    overflow: auto;
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 10px;
  }

  @media (max-width: 860px) {
    .replay-dock {
      right: 0;
      padding: 7px 10px;
    }

    .replay-caption {
      width: min(420px, calc(100% - 20px));
      bottom: calc(100% + 5px);
    }

    .replay-caption span {
      padding: 6px 10px;
      font-size: 12px;
    }

    .replay-controls {
      grid-template-columns: 30px 30px 54px minmax(0, 1fr) 72px 30px 30px 30px;
      gap: 5px;
    }

    .play-toggle {
      width: 54px !important;
    }

    .info-toggle {
      width: 30px;
    }

    .speed-control {
      grid-template-columns: 1fr;
      gap: 2px;
      font-size: 10px;
    }

    .speed-control select {
      width: 100%;
      height: 24px;
    }

    .replay-details {
      width: min(280px, calc(100vw - 24px));
      right: 10px;
    }
  }
</style>
