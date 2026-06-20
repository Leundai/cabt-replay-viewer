<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import BoardLayer from './lib/components/BoardLayer.svelte';
  import BoardPerspectiveControls from './lib/components/BoardPerspectiveControls.svelte';
  import CardInspector from './lib/components/CardInspector.svelte';
  import GameBoard from './lib/components/GameBoard.svelte';
  import GameStatus from './lib/components/GameStatus.svelte';
  import Hand from './lib/components/Hand.svelte';
  import LogPanel from './lib/components/LogPanel.svelte';
  import MotionOverlay from './lib/components/MotionOverlay.svelte';
  import PlayerPanel from './lib/components/PlayerPanel.svelte';
  import ReplaySidebar from './lib/components/ReplaySidebar.svelte';
  import ReplayTimeline from './lib/components/ReplayTimeline.svelte';
  import TableShell from './lib/components/TableShell.svelte';
  import ZoneViewer from './lib/components/ZoneViewer.svelte';
  import type { ZoneName } from './state/zoneViewer.svelte';
  import type { GameView } from './lib/game/types';
  import type { ReplaySnapshot } from './lib/game/replay';
  import { cardInspectorStore } from './state/cardInspector.svelte';
  import { cardMotionStore } from './state/cardMotion.svelte';
  import { localReplayStore } from './state/localReplayStore';
  import { replayStore } from './state/replay.svelte';
  import { viewSettingsStore } from './state/viewSettings.svelte';
  import { zoneViewerStore } from './state/zoneViewer.svelte';

  let activeLibraryReplayId = $state('');

  let game = $derived(replayStore.currentView);
  let replay = $derived(replayStore.replay);
  let bottomPlayer = $derived(game?.players[viewSettingsStore.viewIndex] ?? game?.players[0]);
  let topPlayer = $derived(game?.players.find((player) => player.index !== bottomPlayer?.index));
  let currentStadium = $derived(game ? game.players.flatMap((player) => player.stadium)[0] : undefined);
  let currentStadiumOwner = $derived(game?.players.find((player) => player.stadium.length));
  let activePlayer = $derived(game?.players[game.activePlayerIndex]);
  let viewedCards = $derived(zoneViewerStore.cardsFor(game));
  let zoneViewerIsStadium = $derived(zoneViewerStore.zone === 'stadium');
  let statusLabel = $derived(replayStore.loading ? 'Loading replay' : replayStore.error);

  onMount(() => {
    const stopThemeSync = viewSettingsStore.startThemeSync();
    void loadInitialReplay();
    return stopThemeSync;
  });

  $effect(() => {
    document.documentElement.dataset.theme = viewSettingsStore.theme;
    document.documentElement.dataset.themePreference = viewSettingsStore.themePreference;
    document.documentElement.style.colorScheme = viewSettingsStore.theme;
  });

  // Drive the card-motion cinematics. We track only step + view + replay
  // identity; speed/playing are read untracked so changing speed never
  // re-fires a step. The store gates everything (direction, cadence, reduced
  // motion), so this stays a pure downstream side-effect of the snapshot.
  let lastView: GameView | null = null;
  let lastIndex = 0;
  let lastReplay: ReplaySnapshot | null = null;
  let wasPlaying = false;

  $effect(() => {
    const nextReplay = replayStore.replay;
    const nextIndex = replayStore.stepIndex;
    const nextView = replayStore.currentView;
    untrack(() => {
      if (nextReplay !== lastReplay) {
        lastReplay = nextReplay;
        lastView = null;
        lastIndex = 0;
        wasPlaying = false;
        cardMotionStore.clearAll();
      }
      const playing = replayStore.playing;
      cardMotionStore.onStep({
        prevView: lastView,
        nextView,
        prevIndex: lastIndex,
        nextIndex,
        speedId: replayStore.playbackSpeedId,
        // The final autoplay tick flips playing=false in the same synchronous
        // tick it advances the step, so treat a step as autoplay-driven when
        // play was active on the previous step too — keeps the last step gated
        // to its speed tier instead of unleashing the full manual cinematic.
        playing: playing || wasPlaying,
      });
      lastView = nextView;
      lastIndex = nextIndex;
      wasPlaying = playing;
    });
  });

  async function loadInitialReplay() {
    const params = new URLSearchParams(window.location.search);
    const replayId = params.get('replayId');
    if (replayId) {
      await openStoredReplay(replayId);
      return;
    }
    await loadDemoReplay();
  }

  async function loadDemoReplay() {
    activeLibraryReplayId = 'demo';
    // A real recorded episode (Kazama Yusuke vs Leundai) so the demo shows real
    // cards and art rather than synthetic placeholders.
    await replayStore.loadSaved('leundai-kazama-lucario-carm.json');
  }

  async function openStoredReplay(id: string) {
    activeLibraryReplayId = id;
    // Local library is the source of truth; fall back to the API only for a
    // deep-link to an id this browser hasn't cached locally.
    const local = await localReplayStore.get(id);
    if (local != null) {
      await replayStore.loadData(local);
      return;
    }
    await replayStore.loadApiReplay(id);
  }

  async function openReplayData(replayData: unknown) {
    activeLibraryReplayId = 'local';
    await replayStore.loadData(replayData);
  }

  function switchSides() {
    viewSettingsStore.switchToPlayer(topPlayer?.index ?? 0);
  }

  function showZone(playerIndex: number, zone: ZoneName, title: string, faceDown = false) {
    zoneViewerStore.show(playerIndex, zone, title, faceDown);
  }

  function closeReplay() {
    activeLibraryReplayId = '';
    replayStore.clear();
    cardInspectorStore.close();
    zoneViewerStore.close();
    cardMotionStore.clearAll();
  }

  // --- Cinema HUD auto-hide ---------------------------------------------------
  // The chrome (status chip, settings gear, transport dock + caption) dims away
  // during uninterrupted playback so the board owns the screen, and returns on
  // any pointer/key activity, on pause, or whenever the settings menu is open.
  let chromeResting = $state(false);
  let settingsOpen = $state(false);
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  function wakeChrome() {
    chromeResting = false;
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    if (replayStore.playing && !settingsOpen) {
      idleTimer = setTimeout(() => {
        if (replayStore.playing && !settingsOpen) {
          chromeResting = true;
        }
      }, 2800);
    }
  }

  $effect(() => {
    // Re-arm (or cancel) the idle countdown whenever playback or the menu toggles.
    replayStore.playing;
    settingsOpen;
    wakeChrome();
  });

</script>

<main class="app-shell">
  <ReplaySidebar
    activeReplayId={activeLibraryReplayId}
    {loadDemoReplay}
    {openStoredReplay}
    {openReplayData}
  />

  <section
    class="viewer-stage"
    class:chrome-resting={chromeResting}
    aria-label="Replay viewer"
    onpointermove={wakeChrome}
    onpointerdown={wakeChrome}
  >
    {#if replay && game && topPlayer && bottomPlayer}
      <TableShell debugZones={viewSettingsStore.debugZones} replayMode>
        <GameStatus
          phaseLabel={game.phaseLabel}
          turn={game.turn}
          activePlayerName={activePlayer?.name}
          resultLabel={game.phase === 7 ? 'Game finished' : ''}
          gameFinished={game.phase === 7}
        />

        <details class="hud-settings" bind:open={settingsOpen}>
          <summary class="hud-gear" aria-label="Viewer settings" title="Viewer settings">⚙</summary>
          <div class="hud-settings-menu">
            <BoardPerspectiveControls
              bind:boardTilt={viewSettingsStore.boardTilt}
              bind:boardPerspective={viewSettingsStore.boardPerspective}
              bind:boardScaleY={viewSettingsStore.boardScaleY}
              bind:boardLift={viewSettingsStore.boardLift}
              resetPerspective={() => viewSettingsStore.resetPerspective()}
            />
            <label>
              <input type="checkbox" bind:checked={viewSettingsStore.debugZones} />
              Debug zones
            </label>
            <label>
              <input type="checkbox" bind:checked={viewSettingsStore.showLogs} />
              Show logs
            </label>
            <label>
              Theme
              <select bind:value={viewSettingsStore.themePreference} aria-label="Theme preference">
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <div class="menu-actions">
              <button type="button" onclick={switchSides}>Switch sides</button>
              <button type="button" class="danger" onclick={closeReplay}>Close replay</button>
            </div>
          </div>
        </details>

        {#if replayStore.currentStep}
          <ReplayTimeline
            replay={replay}
            step={replayStore.currentStep}
            stepIndex={replayStore.stepIndex}
            copiedForkPoint={replayStore.copiedForkPoint}
            setStep={(index) => replayStore.setStep(index)}
            setStateIndex={(index) => replayStore.setStateIndex(index)}
            previousStep={() => replayStore.previousStep()}
            nextStep={() => replayStore.nextStep()}
            firstStep={() => replayStore.firstStep()}
            lastStep={() => replayStore.lastStep()}
            copyForkPoint={() => void replayStore.copyForkPoint()}
            playing={replayStore.playing}
            playbackSpeedId={replayStore.playbackSpeedId}
            playbackSpeeds={replayStore.playbackSpeeds}
            togglePlayback={() => replayStore.togglePlayback()}
            setPlaybackSpeed={(speedId) => replayStore.setPlaybackSpeed(speedId)}
          />
        {/if}

        <BoardLayer>
          <PlayerPanel side="top">
            <Hand
              player={topPlayer}
              disabled
              concealed
            />
          </PlayerPanel>

          <GameBoard
            {topPlayer}
            {bottomPlayer}
            topBenchSlots={topPlayer.bench}
            bottomBenchSlots={bottomPlayer.bench}
            topActiveSlot={topPlayer.active}
            bottomActiveSlot={bottomPlayer.active}
            {currentStadium}
            {currentStadiumOwner}
            {showZone}
            boardTilt={viewSettingsStore.boardTilt}
            boardPerspective={viewSettingsStore.boardPerspective}
            boardScaleY={viewSettingsStore.boardScaleY}
            boardLift={viewSettingsStore.boardLift}
          />

          <PlayerPanel side="bottom">
            <Hand
              player={bottomPlayer}
              disabled
            />
          </PlayerPanel>

          {#if viewSettingsStore.showLogs}
            <LogPanel logs={game.logs} />
          {/if}

          <ZoneViewer
            open={zoneViewerStore.open}
            title={zoneViewerStore.title}
            cards={viewedCards}
            faceDown={zoneViewerStore.faceDown}
            actionLabel={zoneViewerIsStadium && viewedCards.length ? 'Inspect stadium' : ''}
            actionDisabled
            close={() => zoneViewerStore.close()}
          />

          <MotionOverlay />
        </BoardLayer>
        <CardInspector />
      </TableShell>
    {:else}
      <div class="empty-stage">
        <strong>{statusLabel || 'Choose a replay'}</strong>
        <span>Load the demo, drop a JSON file, or import an episode from Kaggle.</span>
      </div>
    {/if}
  </section>
</main>

<style>
  .app-shell {
    /* A viewport-bound grid so each column scrolls on its own. Without a fixed
       height the grid row grows to the taller column and the whole page scrolls,
       which is why the sidebar's lower controls used to clip off-screen. */
    height: 100dvh;
    display: grid;
    grid-template-columns: minmax(320px, 380px) minmax(0, 1fr);
    background: var(--app-backdrop-bg);
    color: var(--text-primary);
  }

  input,
  select {
    min-width: 0;
    width: 100%;
    border: 1px solid var(--input-border);
    border-radius: 6px;
    padding: 8px 9px;
    background: var(--input-bg);
    color: var(--input-text);
    font: inherit;
  }

  button {
    border-radius: 6px;
    border-color: var(--button-border);
    background: var(--button-bg);
    color: var(--button-text);
    font-weight: 800;
  }

  .viewer-stage {
    min-width: 0;
    min-height: 0;
    height: 100%;
    position: relative;
    overflow: auto;
  }

  .viewer-stage :global(.table-shell) {
    width: max(100%, var(--min-table-width));
  }

  /* Cinema HUD: a single settings gear at top-right. Everything that used to be
     scattered across the top-right toolbar and the floating details panel now
     lives in its popover, so nothing shares an anchor or floats at a magic
     coordinate. */
  .hud-settings {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 10;
  }

  .hud-gear {
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    border: 1px solid var(--surface-toolbar-border);
    border-radius: 8px;
    background: var(--surface-toolbar-bg);
    box-shadow: var(--surface-toolbar-shadow);
    backdrop-filter: blur(var(--backdrop-blur));
    color: var(--text-primary);
    cursor: pointer;
    font-size: 17px;
    line-height: 1;
    user-select: none;
    transition: transform var(--dur-press) var(--ease-out);
  }

  .hud-gear::-webkit-details-marker,
  .hud-gear::marker {
    display: none;
  }

  .hud-settings[open] .hud-gear {
    transform: rotate(45deg);
    border-color: var(--accent-base);
  }

  .hud-settings-menu {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    width: 208px;
    display: grid;
    gap: 8px;
    padding: 10px;
    border: 1px solid var(--surface-toolbar-border);
    border-radius: 8px;
    background: var(--surface-toolbar-bg);
    box-shadow: var(--surface-toolbar-shadow);
    backdrop-filter: blur(var(--backdrop-blur));

    @starting-style {
      opacity: 0;
      transform: translateY(-6px);
    }
  }

  .hud-settings-menu label {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-secondary);
    font-size: 11px;
    line-height: 1.2;
  }

  .hud-settings-menu input[type="checkbox"] {
    width: auto;
  }

  .hud-settings-menu select {
    width: 100%;
    font-size: 11px;
  }

  .menu-actions {
    display: grid;
    gap: 6px;
    margin-top: 2px;
    padding-top: 8px;
    border-top: 1px solid var(--surface-inset-border);
  }

  .menu-actions button {
    width: 100%;
    font-size: 11px;
    padding: 7px 9px;
  }

  .menu-actions button.danger {
    color: var(--danger-strong);
    border-color: var(--danger-border);
  }

  /* Resting state: dim the chrome away during playback. Pointer-events drop so
     the board underneath stays fully interactive; any move re-wakes it. */
  .viewer-stage.chrome-resting :global(.game-status),
  .viewer-stage.chrome-resting .hud-settings,
  .viewer-stage.chrome-resting :global(.replay-dock),
  .viewer-stage.chrome-resting :global(.replay-caption) {
    opacity: 0;
    pointer-events: none;
  }

  .hud-settings {
    transition: opacity var(--dur-base) var(--ease-out);
  }

  @media (prefers-reduced-motion: reduce) {
    .viewer-stage.chrome-resting :global(.game-status),
    .viewer-stage.chrome-resting .hud-settings,
    .viewer-stage.chrome-resting :global(.replay-dock),
    .viewer-stage.chrome-resting :global(.replay-caption) {
      opacity: 1;
      pointer-events: auto;
    }
  }

  .empty-stage {
    min-height: 100vh;
    display: grid;
    place-content: center;
    gap: 8px;
    padding: 24px;
    text-align: center;
  }

  .empty-stage strong {
    font-size: 24px;
  }

  .empty-stage span {
    color: var(--text-secondary);
  }

  @media (max-width: 920px) {
    .app-shell {
      /* Stacked single column — let the page scroll naturally instead of
         trapping two full-height rows in one viewport. */
      height: auto;
      min-height: 100dvh;
      grid-template-columns: 1fr;
    }

    .viewer-stage {
      height: auto;
      min-height: 100vh;
    }
  }
</style>
