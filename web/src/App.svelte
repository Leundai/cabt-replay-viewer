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
  import ReplayTimeline from './lib/components/ReplayTimeline.svelte';
  import TableShell from './lib/components/TableShell.svelte';
  import ZoneViewer from './lib/components/ZoneViewer.svelte';
  import {
    importKaggleEpisode,
    importReplayJson,
    kaggleStatus,
    listKaggleEpisodes,
    listKaggleSubmissions,
    listReplays,
    readAdminToken,
    setAdminToken,
    type KaggleEpisode,
    type KaggleStatus,
    type KaggleSubmission,
    type ReplaySummary,
  } from './lib/api/client';
  import { inertBoardInteraction } from './lib/game/inertBoardInteraction';
  import type { ZoneName } from './state/zoneViewer.svelte';
  import { cardInspectorStore } from './state/cardInspector.svelte';
  import { replayStore } from './state/replay.svelte';
  import { viewSettingsStore } from './state/viewSettings.svelte';
  import { zoneViewerStore } from './state/zoneViewer.svelte';

  const defaultCompetition = 'pokemon-tcg-ai-battle';

  let searchQuery = $state('');
  let library = $state<ReplaySummary[]>([]);
  let libraryLoading = $state(false);
  let libraryError = $state('');
  let uploadDragActive = $state(false);
  let uploadInput = $state<HTMLInputElement>();
  let activeLibraryReplayId = $state('');

  let adminToken = $state(readAdminToken());
  let kaggle = $state<KaggleStatus>({
    configured: false,
    authMode: 'none',
    adminRequired: true,
    publicImportsEnabled: false,
    message: 'Checking Kaggle configuration...',
  });
  let competition = $state(defaultCompetition);
  let submissions = $state<KaggleSubmission[]>([]);
  let episodes = $state<KaggleEpisode[]>([]);
  let selectedSubmissionId = $state<number | null>(null);
  let kaggleLoading = $state(false);
  let kaggleError = $state('');

  let game = $derived(replayStore.currentView);
  let replay = $derived(replayStore.replay);
  let bottomPlayer = $derived(game?.players[viewSettingsStore.viewIndex] ?? game?.players[0]);
  let topPlayer = $derived(game?.players.find((player) => player.index !== bottomPlayer?.index));
  let currentStadium = $derived(game ? game.players.flatMap((player) => player.stadium)[0] : undefined);
  let currentStadiumOwner = $derived(game?.players.find((player) => player.stadium.length));
  let activePlayer = $derived(game?.players[game.activePlayerIndex]);
  let viewedCards = $derived(zoneViewerStore.cardsFor(game));
  let zoneViewerIsStadium = $derived(zoneViewerStore.zone === 'stadium');
  let statusLabel = $derived(replayStore.loading ? 'Loading replay' : replayStore.error || libraryError || kaggleError);
  let filteredSubmissions = $derived(filterSubmissions(submissions, searchQuery));

  onMount(() => {
    const stopThemeSync = viewSettingsStore.startThemeSync();
    void refreshLibrary();
    void refreshKaggleStatus();
    void loadDemoReplay();
    return stopThemeSync;
  });

  $effect(() => {
    document.documentElement.dataset.theme = viewSettingsStore.theme;
    document.documentElement.dataset.themePreference = viewSettingsStore.themePreference;
    document.documentElement.style.colorScheme = viewSettingsStore.theme;
  });

  async function refreshLibrary() {
    libraryLoading = true;
    libraryError = '';
    try {
      library = await listReplays(searchQuery);
    } catch (error) {
      libraryError = error instanceof Error ? error.message : String(error);
      library = [];
    } finally {
      libraryLoading = false;
    }
  }

  async function refreshKaggleStatus() {
    try {
      kaggle = await kaggleStatus();
    } catch (error) {
      kaggle = {
        configured: false,
        authMode: 'unavailable',
        adminRequired: true,
        publicImportsEnabled: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async function loadDemoReplay() {
    activeLibraryReplayId = 'demo';
    await replayStore.loadSaved('cabt-match.json');
  }

  async function openStoredReplay(id: string) {
    activeLibraryReplayId = id;
    await replayStore.loadApiReplay(id);
  }

  async function importFile(file: File | undefined) {
    uploadDragActive = false;
    if (!file) {
      return;
    }

    try {
      const replayJson = JSON.parse(await file.text());
      await replayStore.loadData(replayJson);
      try {
        const saved = await importReplayJson(replayJson, file.name);
        activeLibraryReplayId = saved.id;
        await refreshLibrary();
      } catch (error) {
        libraryError = error instanceof Error ? error.message : String(error);
      }
    } catch (error) {
      replayStore.error = error instanceof Error ? error.message : String(error);
    }
  }

  async function fetchSubmissions() {
    kaggleLoading = true;
    kaggleError = '';
    episodes = [];
    selectedSubmissionId = null;
    try {
      submissions = await listKaggleSubmissions(competition.trim() || defaultCompetition);
    } catch (error) {
      kaggleError = error instanceof Error ? error.message : String(error);
      submissions = [];
    } finally {
      kaggleLoading = false;
    }
  }

  async function fetchEpisodes(submissionId: number) {
    kaggleLoading = true;
    kaggleError = '';
    selectedSubmissionId = submissionId;
    try {
      episodes = await listKaggleEpisodes(submissionId);
    } catch (error) {
      kaggleError = error instanceof Error ? error.message : String(error);
      episodes = [];
    } finally {
      kaggleLoading = false;
    }
  }

  async function openKaggleEpisode(episodeId: number) {
    kaggleLoading = true;
    kaggleError = '';
    try {
      const saved = await importKaggleEpisode(episodeId);
      activeLibraryReplayId = saved.id;
      await replayStore.loadApiReplay(saved.id);
      await refreshLibrary();
    } catch (error) {
      kaggleError = error instanceof Error ? error.message : String(error);
    } finally {
      kaggleLoading = false;
    }
  }

  function filterSubmissions(items: KaggleSubmission[], query: string): KaggleSubmission[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return items;
    }
    return items.filter((submission) => [
      submission.id,
      submission.teamId,
      submission.teamName,
      submission.submittedBy,
      submission.description,
      submission.status,
      submission.score,
    ].some((value) => String(value ?? '').toLowerCase().includes(normalized)));
  }

  function openUploadPicker() {
    uploadInput?.click();
  }

  function onFileChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    void importFile(input.files?.[0]);
    input.value = '';
  }

  function onReplayDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    void importFile(event.dataTransfer?.files?.[0]);
  }

  function onReplayDragOver(event: DragEvent) {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    uploadDragActive = true;
  }

  function updateAdminToken(value: string) {
    adminToken = value;
    setAdminToken(value);
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

  function noopHand() {}
</script>

<main class="app-shell">
  <aside class="replay-sidebar" aria-label="Replay sources">
    <header>
      <div>
        <strong>CABT Replay Viewer</strong>
        <span>Kaggle episodes, downloaded JSON, and saved replays.</span>
      </div>
      <button type="button" onclick={loadDemoReplay}>Demo</button>
    </header>

    <label class="search-box">
      Search
      <input
        type="search"
        placeholder="team, submission, player..."
        bind:value={searchQuery}
        oninput={() => void refreshLibrary()}
      />
    </label>

    <section
      class="drop-target"
      class:drag-active={uploadDragActive}
      role="group"
      aria-label="JSON replay upload"
      ondragover={onReplayDragOver}
      ondragleave={() => (uploadDragActive = false)}
      ondrop={onReplayDrop}
    >
      <div>
        <strong>Drop JSON</strong>
        <span>CABT runner or Kaggle episode replay</span>
      </div>
      <button type="button" onclick={openUploadPicker}>Open JSON</button>
      <input
        bind:this={uploadInput}
        type="file"
        accept=".json,application/json"
        onchange={onFileChange}
        tabindex="-1"
        aria-hidden="true"
      />
    </section>

    <section class="source-panel">
      <div class="panel-heading">
        <strong>Saved replays</strong>
        <button type="button" disabled={libraryLoading} onclick={refreshLibrary}>
          {libraryLoading ? 'Refreshing' : 'Refresh'}
        </button>
      </div>
      {#if library.length === 0}
        <p class="empty">Imported Kaggle episodes and JSON files will appear here.</p>
      {:else}
        <div class="replay-list">
          {#each library as item}
            <button
              type="button"
              class:active={activeLibraryReplayId === item.id}
              onclick={() => openStoredReplay(item.id)}
            >
              <span>
                <strong>{item.name}</strong>
                <small>{item.players.join(' vs ') || item.source}</small>
              </span>
              <small>{item.actionCount} actions</small>
            </button>
          {/each}
        </div>
      {/if}
    </section>

    <section class="source-panel kaggle-panel">
      <div class="panel-heading">
        <strong>Kaggle</strong>
        <span class:ready={kaggle.configured}>{kaggle.authMode}</span>
      </div>
      <p>{kaggle.message}</p>
      {#if kaggle.adminRequired}
        <label>
          Admin token
          <input
            type="password"
            autocomplete="off"
            placeholder="CABT_ADMIN_TOKEN"
            value={adminToken}
            oninput={(event) => updateAdminToken((event.currentTarget as HTMLInputElement).value)}
          />
        </label>
      {/if}
      <label>
        Competition
        <input bind:value={competition} />
      </label>
      <button type="button" disabled={kaggleLoading} onclick={fetchSubmissions}>
        {kaggleLoading ? 'Working...' : 'Load submissions'}
      </button>
      {#if kaggleError}
        <p class="panel-error">{kaggleError}</p>
      {/if}

      {#if filteredSubmissions.length}
        <div class="submission-list">
          {#each filteredSubmissions as submission}
            <button
              type="button"
              class:active={selectedSubmissionId === submission.id}
              onclick={() => fetchEpisodes(submission.id)}
            >
              <strong>{submission.teamName || submission.submittedBy || `Submission ${submission.id}`}</strong>
              <small>#{submission.id}{submission.score !== undefined ? ` · ${submission.score}` : ''}</small>
            </button>
          {/each}
        </div>
      {/if}

      {#if episodes.length}
        <div class="episode-list">
          {#each episodes as episode}
            <button type="button" onclick={() => openKaggleEpisode(episode.id)}>
              <span>Episode {episode.id}</span>
              <small>{episode.status || episode.reward || 'Open replay'}</small>
            </button>
          {/each}
        </div>
      {/if}
    </section>
  </aside>

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
              onSelect={noopHand}
              onDrag={noopHand}
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
            interaction={inertBoardInteraction}
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
              onSelect={noopHand}
              onDrag={noopHand}
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

  .replay-sidebar {
    position: relative;
    z-index: 20;
    display: grid;
    align-content: start;
    gap: 14px;
    min-height: 100vh;
    padding: 18px;
    border-right: 1px solid var(--surface-toolbar-border);
    background: var(--surface-toolbar-bg);
    box-shadow: var(--surface-toolbar-shadow);
    overflow: auto;
  }

  .replay-sidebar header,
  .panel-heading,
  .drop-target,
  .replay-list button,
  .submission-list button,
  .episode-list button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .replay-sidebar header div,
  .drop-target div,
  .replay-list span {
    min-width: 0;
    display: grid;
    gap: 4px;
  }

  .replay-sidebar header strong {
    font-size: 18px;
  }

  .replay-sidebar span,
  .replay-sidebar small,
  .source-panel p,
  .empty {
    color: var(--text-secondary);
    font-size: 12px;
  }

  .source-panel .panel-error {
    padding: 8px;
    border: 1px solid var(--danger-border);
    border-radius: 6px;
    background: var(--danger-bg);
    color: var(--danger-strong);
    font-weight: 750;
  }

  .search-box,
  .kaggle-panel label {
    display: grid;
    gap: 6px;
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 800;
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

  .drop-target,
  .source-panel {
    display: grid;
    gap: 10px;
    padding: 12px;
    border: 1px solid var(--surface-inset-border);
    border-radius: 8px;
    background: var(--surface-inset-bg);
  }

  .drop-target.drag-active {
    border-color: var(--accent-base);
    background: var(--accent-tint);
  }

  .drop-target input {
    position: fixed;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }

  .panel-heading span {
    padding: 3px 7px;
    border-radius: 999px;
    background: var(--danger-bg);
    color: var(--danger-strong);
    font-size: 11px;
    font-weight: 850;
  }

  .panel-heading span.ready {
    background: var(--accent-tint);
    color: var(--accent-strong);
  }

  .replay-list,
  .submission-list,
  .episode-list {
    display: grid;
    gap: 8px;
  }

  .replay-list button,
  .submission-list button,
  .episode-list button {
    width: 100%;
    padding: 9px;
    text-align: left;
    background: var(--surface-card-bg);
  }

  .replay-list button.active,
  .submission-list button.active {
    outline: 2px solid var(--accent-base);
    outline-offset: 1px;
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

    .replay-sidebar {
      min-height: auto;
      border-right: 0;
      border-bottom: 1px solid var(--surface-toolbar-border);
    }
  }
</style>
