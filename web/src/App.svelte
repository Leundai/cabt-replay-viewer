<script lang="ts">
  import { onMount } from 'svelte';
  import BoardLayer from './lib/components/BoardLayer.svelte';
  import BoardPerspectiveControls from './lib/components/BoardPerspectiveControls.svelte';
  import CardInspector from './lib/components/CardInspector.svelte';
  import GameBoard from './lib/components/GameBoard.svelte';
  import GameStatus from './lib/components/GameStatus.svelte';
  import Hand from './lib/components/Hand.svelte';
  import LogPanel from './lib/components/LogPanel.svelte';
  import PlayerPanel from './lib/components/PlayerPanel.svelte';
  import ReplaySidebar from './lib/components/ReplaySidebar.svelte';
  import ReplayTimeline from './lib/components/ReplayTimeline.svelte';
  import TableShell from './lib/components/TableShell.svelte';
  import ZoneViewer from './lib/components/ZoneViewer.svelte';
  import type { ZoneName } from './state/zoneViewer.svelte';
  import { cardInspectorStore } from './state/cardInspector.svelte';
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
    await replayStore.loadSaved('cabt-match.json');
  }

  async function openStoredReplay(id: string) {
    activeLibraryReplayId = id;
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
  }

</script>

<main class="app-shell">
  <ReplaySidebar
    activeReplayId={activeLibraryReplayId}
    {loadDemoReplay}
    {openStoredReplay}
    {openReplayData}
  />

  <section class="viewer-stage" aria-label="Replay viewer">
    {#if replay && game && topPlayer && bottomPlayer}
      <TableShell debugZones={viewSettingsStore.debugZones} replayMode>
        <GameStatus
          phaseLabel={game.phaseLabel}
          turn={game.turn}
          activePlayerName={activePlayer?.name}
          resultLabel={game.phase === 7 ? 'Game finished' : ''}
          gameFinished={game.phase === 7}
        />

        <div class="viewer-toolbar">
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
          <button type="button" onclick={switchSides}>Switch sides</button>
          <button type="button" onclick={closeReplay}>Close replay</button>
        </div>

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
    min-height: 100vh;
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
    min-height: 100vh;
    position: relative;
    overflow: auto;
  }

  .viewer-stage :global(.table-shell) {
    width: max(100%, var(--min-table-width));
  }

  .viewer-toolbar {
    position: absolute;
    top: 14px;
    right: 14px;
    z-index: 8;
    width: 148px;
    display: grid;
    gap: 8px;
    padding: 7px;
    border: 1px solid var(--surface-toolbar-border);
    border-radius: 6px;
    background: var(--surface-toolbar-bg);
    box-shadow: var(--surface-toolbar-shadow);
    backdrop-filter: blur(var(--backdrop-blur));
  }

  .viewer-toolbar label {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-secondary);
    font-size: 10px;
    line-height: 1.2;
  }

  .viewer-toolbar input[type="checkbox"] {
    width: auto;
  }

  .viewer-toolbar button,
  .viewer-toolbar select {
    width: 100%;
    font-size: 10px;
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
      grid-template-columns: 1fr;
    }
  }
</style>
