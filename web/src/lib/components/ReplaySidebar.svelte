<script lang="ts">
  import { onMount } from 'svelte';
  import {
    getKaggleLeaderboard,
    getReplayArtifact,
    importCachedLeaderboardEpisode,
    importKaggleEpisode,
    kaggleStatus,
    listKaggleEpisodes,
    listKaggleSubmissions,
    refreshKaggleLeaderboard,
    setAdminToken,
    verifyAdminSession,
    type KaggleEpisode,
    type KaggleLeaderboardEntry,
    type KaggleLeaderboardSnapshot,
    type KaggleStatus,
    type KaggleSubmission,
    type ReplaySummary,
  } from '../api/client';
  import { localReplayStore } from '../../state/localReplayStore';
  import { MAX_REPLAY_BYTES } from '../../state/replaySources';

  const defaultCompetition = 'pokemon-tcg-ai-battle';

  type Props = {
    activeReplayId: string;
    openStoredReplay: (id: string) => void | Promise<void>;
    openReplayData: (replayData: unknown) => void | Promise<void>;
  };

  let {
    activeReplayId,
    openStoredReplay,
    openReplayData,
  }: Props = $props();

  let searchQuery = $state('');
  let library = $state<ReplaySummary[]>([]);
  let libraryLoading = $state(false);
  let libraryError = $state('');
  let uploadDragActive = $state(false);
  let uploadInput = $state<HTMLInputElement>();
  let leaderboard = $state<KaggleLeaderboardSnapshot | null>(null);
  let leaderboardLoading = $state(false);
  let leaderboardError = $state('');
  let leaderboardReplayLoadingId = $state<number | null>(null);

  let adminPassword = $state('');
  let adminControlVisible = $state(false);
  let adminPromptOpen = $state(false);
  let adminUnlocked = $state(false);
  let adminError = $state('');
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

  let filteredSubmissions = $derived(filterSubmissions(submissions, searchQuery));
  let filteredLeaderboard = $derived(filterLeaderboard(leaderboard?.entries ?? [], searchQuery));
  let cacheStatus = $derived(formatCacheStatus(leaderboard));

  onMount(() => {
    void refreshLibrary();
    void refreshKaggleStatus();
    void refreshLeaderboard();
    const leaderboardTimer = setInterval(() => void refreshLeaderboard(), 60_000);
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.code === 'KeyK') {
        event.preventDefault();
        adminControlVisible = true;
        adminPromptOpen = !adminUnlocked;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      clearInterval(leaderboardTimer);
      window.removeEventListener('keydown', onKeyDown);
    };
  });

  async function refreshLibrary() {
    libraryLoading = true;
    libraryError = '';
    try {
      library = await localReplayStore.list(searchQuery);
    } catch (error) {
      libraryError = error instanceof Error ? error.message : String(error);
      library = [];
    } finally {
      libraryLoading = false;
    }
  }

  async function removeReplay(id: string) {
    try {
      await localReplayStore.remove(id);
      await refreshLibrary();
    } catch (error) {
      libraryError = error instanceof Error ? error.message : String(error);
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

  async function refreshLeaderboard() {
    leaderboardLoading = !leaderboard;
    leaderboardError = '';
    try {
      leaderboard = await getKaggleLeaderboard(competition.trim() || defaultCompetition);
    } catch (error) {
      leaderboardError = error instanceof Error ? error.message : String(error);
    } finally {
      leaderboardLoading = false;
    }
  }

  async function refreshLeaderboardAsAdmin() {
    kaggleLoading = true;
    kaggleError = '';
    try {
      leaderboard = await refreshKaggleLeaderboard(competition.trim() || defaultCompetition);
    } catch (error) {
      kaggleError = error instanceof Error ? error.message : String(error);
    } finally {
      kaggleLoading = false;
    }
  }

  async function unlockAdmin() {
    adminError = '';
    updateAdminToken(adminPassword);
    try {
      await verifyAdminSession();
      adminUnlocked = true;
      adminPromptOpen = false;
      adminPassword = '';
      await refreshKaggleStatus();
    } catch (error) {
      updateAdminToken('');
      adminUnlocked = false;
      adminError = error instanceof Error ? error.message : String(error);
    }
  }

  function lockAdmin() {
    updateAdminToken('');
    adminPassword = '';
    adminUnlocked = false;
    adminPromptOpen = false;
  }

  async function importFile(file: File | undefined) {
    uploadDragActive = false;
    if (!file) {
      return;
    }

    try {
      if (file.size > MAX_REPLAY_BYTES) {
        throw new Error('Replay payload is too large.');
      }
      const replayJson = JSON.parse(await file.text());
      try {
        const saved = await localReplayStore.save(replayJson, file.name);
        await refreshLibrary();
        await openStoredReplay(saved.id);
      } catch (error) {
        // Couldn't persist locally — still show the replay so the drop isn't lost.
        libraryError = error instanceof Error ? error.message : String(error);
        await openReplayData(replayJson);
      }
    } catch (error) {
      libraryError = error instanceof Error ? error.message : String(error);
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
      // The server proxies the Kaggle fetch (needs credentials); we then pull the
      // artifact and keep it in the local library so it lives here, not on a server.
      const fetched = await importKaggleEpisode(episodeId);
      const artifact = await getReplayArtifact(fetched.id);
      const saved = await localReplayStore.save(artifact, fetched.name);
      await refreshLibrary();
      await openStoredReplay(saved.id);
    } catch (error) {
      kaggleError = error instanceof Error ? error.message : String(error);
    } finally {
      kaggleLoading = false;
    }
  }

  async function openCachedLeaderboardEpisode(episodeId: number) {
    leaderboardReplayLoadingId = episodeId;
    leaderboardError = '';
    try {
      const fetched = await importCachedLeaderboardEpisode(leaderboard?.competition || competition.trim() || defaultCompetition, episodeId);
      const artifact = await getReplayArtifact(fetched.id);
      const saved = await localReplayStore.save(artifact, fetched.name);
      await refreshLibrary();
      await openStoredReplay(saved.id);
    } catch (error) {
      leaderboardError = error instanceof Error ? error.message : String(error);
    } finally {
      leaderboardReplayLoadingId = null;
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

  function filterLeaderboard(items: KaggleLeaderboardEntry[], query: string): KaggleLeaderboardEntry[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return items;
    }
    return items.filter((entry) => [
      entry.rank,
      entry.teamId,
      entry.teamName,
      entry.score,
      entry.submissionDate,
      ...(entry.submissions ?? []).flatMap((submission) => [
        submission.id,
        submission.teamId,
        submission.teamName,
        submission.submittedBy,
        submission.description,
        submission.status,
        submission.score,
        submission.date,
        ...(submission.episodes ?? []).flatMap((episode) => [
          episode.id,
          episode.submissionId,
          episode.competitionName,
          episode.reward,
          episode.status,
          episode.date,
          ...(episode.agents ?? []).flatMap((agent) => [
            agent.submissionId,
            agent.teamId,
            agent.teamName,
            agent.reward,
            agent.status,
          ]),
        ]),
      ]),
    ].some((value) => String(value ?? '').toLowerCase().includes(normalized)));
  }

  function entryReplayCount(entry: KaggleLeaderboardEntry): number {
    return (entry.submissions ?? []).reduce(
      (total, submission) => total + (submission.episodes?.length ?? 0),
      0,
    );
  }

  function formatEntryRuns(entry: KaggleLeaderboardEntry): string {
    const submissionCount = entry.submissions?.length ?? 0;
    const replayCount = entryReplayCount(entry);
    if (!submissionCount && !replayCount) {
      return '';
    }
    const submissionLabel = submissionCount === 1 ? 'submission' : 'submissions';
    const replayLabel = replayCount === 1 ? 'replay' : 'replays';
    return `${submissionCount} ${submissionLabel} - ${replayCount} ${replayLabel}`;
  }

  function isLeaderboardSubmission(entry: KaggleLeaderboardEntry, submission: KaggleSubmission): boolean {
    if (entry.submissionId !== undefined && entry.submissionId !== null) {
      return submission.id === entry.submissionId;
    }
    return Boolean(entry.submissionDate && submission.date === entry.submissionDate);
  }

  function formatSubmissionMeta(submission: KaggleSubmission, entry: KaggleLeaderboardEntry): string {
    return [
      isLeaderboardSubmission(entry, submission) ? 'Leaderboard run' : '',
      submission.score !== undefined && submission.score !== null ? `Score ${submission.score}` : '',
      formatDate(submission.date),
      submission.status,
    ].filter(Boolean).join(' - ');
  }

  function formatEpisodeMatchup(
    episode: KaggleEpisode,
    submission: KaggleSubmission,
    entry: KaggleLeaderboardEntry,
  ): string {
    const names = (episode.agents ?? [])
      .map((agent) => agent.teamName || (agent.teamId ? `Team ${agent.teamId}` : agent.submissionId ? `Submission #${agent.submissionId}` : ''))
      .filter(Boolean);
    if (names.length >= 2) {
      return names.slice(0, 2).join(' vs ');
    }
    if (names.length === 1) {
      return names[0];
    }
    return submission.teamName || entry.teamName || `Submission #${submission.id}`;
  }

  function formatEpisodeMeta(episode: KaggleEpisode, submission: KaggleSubmission): string {
    return [
      `Episode ${episode.id}`,
      episodeRewardValue(episode, submission) !== undefined ? `Reward ${episodeRewardValue(episode, submission)}` : '',
      episode.status,
      formatDate(episode.date),
    ].filter(Boolean).join(' - ');
  }

  function episodeRewardValue(episode: KaggleEpisode, submission: KaggleSubmission): number | string | undefined {
    const ownAgent = (episode.agents ?? []).find((agent) =>
      (submission.id !== undefined && agent.submissionId === submission.id)
      || (submission.teamId !== undefined && agent.teamId === submission.teamId));
    return ownAgent?.reward ?? episode.reward ?? undefined;
  }

  function episodeOutcomeKind(episode: KaggleEpisode, submission: KaggleSubmission): 'win' | 'loss' | 'draw' | 'unknown' {
    const reward = episodeRewardValue(episode, submission);
    const numericReward = Number(reward);
    if (!Number.isFinite(numericReward)) {
      return 'unknown';
    }
    if (numericReward > 0) {
      return 'win';
    }
    if (numericReward < 0) {
      return 'loss';
    }
    return 'draw';
  }

  function episodeOutcomeLabel(episode: KaggleEpisode, submission: KaggleSubmission): string {
    const kind = episodeOutcomeKind(episode, submission);
    if (kind === 'win') {
      return 'Win';
    }
    if (kind === 'loss') {
      return 'Loss';
    }
    if (kind === 'draw') {
      return 'Draw';
    }
    return 'Replay';
  }

  function formatEpisodePreview(episode: KaggleEpisode, submission: KaggleSubmission): string {
    return [
      episodeOutcomeLabel(episode, submission),
      formatEpisodeMeta(episode, submission),
    ].filter(Boolean).join(' - ');
  }

  function replayCountLabel(count: number): string {
    return `${count} ${count === 1 ? 'replay' : 'replays'}`;
  }

  function formatDate(value: string | undefined | null): string {
    if (!value) {
      return '';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  }

  function formatCacheStatus(snapshot: KaggleLeaderboardSnapshot | null): string {
    if (!snapshot?.refreshedAt) {
      return 'No cache yet';
    }
    const refreshed = formatDate(snapshot.refreshedAt);
    const next = snapshot.refreshInSeconds > 0 ? `${Math.ceil(snapshot.refreshInSeconds / 60)} min` : 'ready';
    return `${refreshed} - ${next}`;
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
    setAdminToken(value);
  }
</script>

<aside class="replay-sidebar" aria-label="Replay sources">
  <header>
    <div>
      <strong>CABT Replay Viewer</strong>
      <span>Kaggle episodes, downloaded JSON, and saved replays.</span>
    </div>
  </header>

  <label class="search-box">
    Search
    <input
      type="search"
      placeholder="team, score, player..."
      bind:value={searchQuery}
      oninput={() => void refreshLibrary()}
    />
  </label>

  <section class="source-panel leaderboard-panel">
    <div class="panel-heading">
      <strong>Leaderboard</strong>
      <button type="button" disabled={leaderboardLoading} onclick={refreshLeaderboard}>
        {leaderboardLoading ? 'Refreshing' : 'Refresh'}
      </button>
    </div>
    <div class="cache-line">
      <span>{leaderboard?.competition || competition}</span>
      <span class:stale={leaderboard?.stale}>{cacheStatus}</span>
    </div>
    {#if leaderboardError}
      <p class="panel-error">{leaderboardError}</p>
    {/if}
    {#if leaderboard?.message}
      <p>{leaderboard.message}</p>
    {/if}
    {#if filteredLeaderboard.length === 0}
      <p class="empty">Cached standings will appear here after the first Kaggle pull.</p>
    {:else}
      <div class="leaderboard-list">
        {#each filteredLeaderboard as entry}
          <article class="leaderboard-row">
            <div class="leaderboard-main">
              <span class="leaderboard-rank">{entry.rank}</span>
              <span class="leaderboard-team">
                <strong>{entry.teamName}</strong>
                <small>
                  {formatDate(entry.submissionDate) || (entry.teamId ? `Team ${entry.teamId}` : 'Team')}
                  {#if formatEntryRuns(entry)}
                    - {formatEntryRuns(entry)}
                  {/if}
                </small>
              </span>
              <strong class="leaderboard-score">{entry.score ?? 'No score'}</strong>
            </div>
            {#if entry.submissions?.length}
              <div class="leaderboard-submissions">
                {#each entry.submissions as submission}
                  <div class="leaderboard-submission">
                    <span class="submission-summary">
                      <strong>Submission #{submission.id}</strong>
                      <small>{formatSubmissionMeta(submission, entry)}</small>
                    </span>
                    {#if submission.episodes?.length}
                      {#if submission.episodes.length === 1}
                        <div class="leaderboard-episodes">
                          {#each submission.episodes as episode}
                            <button
                              type="button"
                              class="episode-pill"
                              disabled={leaderboardReplayLoadingId !== null}
                              onclick={() => openCachedLeaderboardEpisode(episode.id)}
                            >
                              <span class="episode-pill-main">
                                <span class="episode-matchup">{formatEpisodeMatchup(episode, submission, entry)}</span>
                                <span class="episode-result" data-outcome={episodeOutcomeKind(episode, submission)}>
                                  {episodeOutcomeLabel(episode, submission)}
                                </span>
                              </span>
                              <small>{leaderboardReplayLoadingId === episode.id ? 'Opening...' : formatEpisodeMeta(episode, submission)}</small>
                            </button>
                          {/each}
                        </div>
                      {:else}
                        <details class="episode-picker">
                          <summary>
                            <span class="episode-summary-copy">
                              <span class="episode-count">{replayCountLabel(submission.episodes.length)}</span>
                              <strong>{formatEpisodeMatchup(submission.episodes[0], submission, entry)}</strong>
                              <small>{formatEpisodePreview(submission.episodes[0], submission)}</small>
                            </span>
                            <span class="episode-chevron" aria-hidden="true"></span>
                          </summary>
                          <div class="leaderboard-episodes">
                            {#each submission.episodes as episode}
                              <button
                                type="button"
                                class="episode-pill"
                                disabled={leaderboardReplayLoadingId !== null}
                                onclick={() => openCachedLeaderboardEpisode(episode.id)}
                              >
                                <span class="episode-pill-main">
                                  <span class="episode-matchup">{formatEpisodeMatchup(episode, submission, entry)}</span>
                                  <span class="episode-result" data-outcome={episodeOutcomeKind(episode, submission)}>
                                    {episodeOutcomeLabel(episode, submission)}
                                  </span>
                                </span>
                                <small>{leaderboardReplayLoadingId === episode.id ? 'Opening...' : formatEpisodeMeta(episode, submission)}</small>
                              </button>
                            {/each}
                          </div>
                        </details>
                      {/if}
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          </article>
        {/each}
      </div>
    {/if}
  </section>

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
    {#if libraryError}
      <p class="panel-error">{libraryError}</p>
    {/if}
    {#if library.length === 0}
      <p class="empty">Saved in your browser. Drop a JSON or import a Kaggle episode to start.</p>
    {:else}
      <div class="replay-list">
        {#each library as item}
          <div class="replay-row" class:active={activeReplayId === item.id}>
            <button type="button" class="replay-open" onclick={() => openStoredReplay(item.id)}>
              <span>
                <strong>{item.name}</strong>
                <small>{item.players.join(' vs ') || item.source}</small>
              </span>
              <small>{item.actionCount} actions</small>
            </button>
            <button
              type="button"
              class="replay-delete"
              aria-label={`Delete ${item.name}`}
              title="Delete replay"
              onclick={() => removeReplay(item.id)}
            >&times;</button>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  {#if adminControlVisible && !adminPromptOpen && !adminUnlocked}
    <button type="button" class="admin-pill" onclick={() => (adminPromptOpen = true)}>Kaggle admin</button>
  {/if}

  {#if adminPromptOpen}
    <section class="source-panel admin-unlock">
      <div class="panel-heading">
        <strong>Kaggle admin</strong>
        <button type="button" onclick={() => (adminPromptOpen = false)}>Close</button>
      </div>
      <form class="admin-form" onsubmit={(event) => { event.preventDefault(); void unlockAdmin(); }}>
        <label>
          Password
          <input
            type="password"
            autocomplete="off"
            placeholder="CABT_ADMIN_TOKEN"
            bind:value={adminPassword}
          />
        </label>
        <button type="submit">Unlock</button>
      </form>
      {#if adminError}
        <p class="panel-error">{adminError}</p>
      {/if}
    </section>
  {/if}

  {#if adminUnlocked}
    <section class="source-panel kaggle-panel">
      <div class="panel-heading">
        <strong>Kaggle admin</strong>
        <span class:ready={kaggle.configured}>{kaggle.authMode}</span>
      </div>
      <p>{kaggle.message}</p>
      <label>
        Competition
        <input bind:value={competition} />
      </label>
      <div class="admin-actions">
        <button type="button" disabled={kaggleLoading} onclick={refreshLeaderboardAsAdmin}>
          {kaggleLoading ? 'Working...' : 'Refresh cache'}
        </button>
        <button type="button" disabled={kaggleLoading} onclick={fetchSubmissions}>
          {kaggleLoading ? 'Working...' : 'Load submissions'}
        </button>
        <button type="button" class="ghost" onclick={lockAdmin}>Lock</button>
      </div>
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
              <small>#{submission.id}{submission.score !== undefined ? ` - ${submission.score}` : ''}</small>
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
  {/if}
</aside>

<style>
  .replay-sidebar {
    position: relative;
    z-index: 20;
    display: grid;
    align-content: start;
    gap: 14px;
    /* Own the full grid-cell height and scroll internally so no control is ever
       clipped off-screen, however tall the Kaggle lists grow. */
    min-height: 0;
    height: 100%;
    padding: 18px;
    border-right: 1px solid var(--surface-toolbar-border);
    background: var(--surface-toolbar-bg);
    box-shadow: var(--surface-toolbar-shadow);
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .replay-sidebar header,
  .panel-heading,
  .drop-target,
  .replay-open,
  .submission-list button,
  .episode-list button,
  .leaderboard-main {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .replay-sidebar header div,
  .drop-target div,
  .replay-list span,
  .submission-summary {
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
  .kaggle-panel label,
  .admin-unlock label {
    display: grid;
    gap: 6px;
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 800;
  }

  input {
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

  .cache-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 750;
  }

  .cache-line .stale {
    color: var(--danger-strong);
  }

  .replay-list,
  .submission-list,
  .episode-list,
  .leaderboard-list {
    display: grid;
    gap: 8px;
  }

  .leaderboard-row {
    display: grid;
    gap: 8px;
    min-height: 54px;
    padding: 9px;
    border: 1px solid var(--surface-inset-border);
    border-radius: 8px;
    background: var(--surface-card-bg);
  }

  .leaderboard-rank {
    flex: 0 0 32px;
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border-radius: 999px;
    background: var(--accent-tint);
    color: var(--accent-strong);
    font-size: 12px;
    font-weight: 900;
  }

  .leaderboard-team {
    min-width: 0;
    flex: 1;
    display: grid;
    gap: 3px;
  }

  .leaderboard-team strong,
  .leaderboard-team small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .leaderboard-score {
    max-width: 86px;
    overflow: hidden;
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
  }

  .leaderboard-submissions {
    display: grid;
    gap: 6px;
    padding-left: 44px;
  }

  .leaderboard-submission {
    display: grid;
    gap: 6px;
    min-width: 0;
    padding-left: 9px;
    border-left: 2px solid var(--surface-inset-border);
  }

  .submission-summary strong,
  .submission-summary small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .leaderboard-episodes {
    display: grid;
    gap: 6px;
  }

  .episode-picker {
    min-width: 0;
    display: grid;
    gap: 7px;
  }

  .episode-picker summary {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 24px;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 8px;
    border: 1px solid var(--button-border);
    border-radius: 8px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.04), transparent),
      var(--button-bg);
    color: var(--button-text);
    cursor: pointer;
    list-style: none;
    transition:
      border-color var(--transition-fast),
      background var(--transition-fast),
      box-shadow var(--transition-fast);
  }

  .episode-picker summary:hover {
    border-color: var(--button-hover-border);
  }

  .episode-picker summary::-webkit-details-marker {
    display: none;
  }

  .episode-picker[open] summary {
    border-color: var(--accent-base);
    background: var(--accent-tint);
    box-shadow: inset 0 0 0 1px var(--accent-soft);
  }

  .episode-summary-copy {
    min-width: 0;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    column-gap: 9px;
    row-gap: 2px;
    align-items: center;
  }

  .episode-count {
    grid-row: 1 / span 2;
    align-self: stretch;
    min-width: 58px;
    display: grid;
    place-items: center;
    padding: 3px 8px;
    border: 1px solid var(--accent-soft);
    border-radius: 7px;
    background: var(--accent-tint);
    color: var(--accent-strong);
    font-size: 11px;
    font-weight: 900;
    line-height: 1.1;
    text-align: center;
  }

  .episode-summary-copy small {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .episode-summary-copy strong {
    min-width: 0;
    overflow: hidden;
    color: var(--text-primary);
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    font-size: 12px;
    font-weight: 900;
    line-height: 1.18;
  }

  .episode-summary-copy small {
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 750;
  }

  .episode-chevron {
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
    border: 1px solid var(--button-border);
    border-radius: 999px;
    background: var(--button-ghost-bg);
    color: var(--text-secondary);
    transition:
      transform var(--dur-fast) var(--ease-out),
      background var(--transition-fast),
      border-color var(--transition-fast),
      color var(--transition-fast);
  }

  .episode-chevron::before {
    content: "";
    width: 7px;
    height: 7px;
    border-right: 2px solid currentColor;
    border-bottom: 2px solid currentColor;
    transform: rotate(45deg) translate(-1px, -1px);
  }

  .episode-picker[open] .episode-chevron {
    border-color: var(--accent-soft);
    background: var(--button-bg);
    color: var(--accent-strong);
    transform: rotate(180deg);
  }

  .episode-pill {
    display: grid;
    gap: 5px;
    min-width: 0;
    width: 100%;
    min-height: 44px;
    padding: 8px;
    border: 1px solid var(--button-border);
    border-radius: 8px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.03), transparent),
      var(--surface-card-bg);
    color: var(--button-text);
    text-align: left;
    font-weight: 850;
    line-height: 1.2;
    transition:
      border-color var(--transition-fast),
      background var(--transition-fast),
      box-shadow var(--transition-fast),
      transform var(--dur-press) var(--ease-out);
  }

  .episode-pill:hover:not(:disabled) {
    border-color: var(--button-hover-border);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.08);
  }

  .episode-pill-main {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .episode-pill small {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .episode-matchup {
    min-width: 0;
    overflow: hidden;
    color: var(--text-primary);
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    font-size: 11.5px;
    font-weight: 900;
    line-height: 1.22;
  }

  .episode-pill small {
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 750;
  }

  .episode-result {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 22px;
    padding: 3px 7px;
    border: 1px solid var(--button-border);
    border-radius: 999px;
    background: var(--button-ghost-bg);
    color: var(--text-secondary);
    font-size: 10.5px;
    font-weight: 900;
    line-height: 1;
  }

  .episode-result[data-outcome="win"] {
    border-color: var(--accent-soft);
    background: var(--accent-tint);
    color: var(--accent-strong);
  }

  .episode-result[data-outcome="loss"] {
    border-color: var(--danger-border);
    background: var(--danger-bg);
    color: var(--danger-strong);
  }

  .episode-result[data-outcome="draw"] {
    border-color: var(--warning-base);
    background: var(--warning-soft);
    color: var(--warning-strong);
  }

  .replay-open,
  .submission-list button,
  .episode-list button {
    width: 100%;
    padding: 9px;
    text-align: left;
    background: var(--surface-card-bg);
  }

  .replay-row {
    display: flex;
    align-items: stretch;
    gap: 6px;
  }

  .replay-row .replay-open {
    flex: 1;
    min-width: 0;
  }

  .replay-delete {
    flex: 0 0 auto;
    width: 30px;
    display: grid;
    place-items: center;
    padding: 0;
    background: var(--surface-card-bg);
    color: var(--text-muted);
    font-size: 17px;
    line-height: 1;
  }

  .replay-delete:hover {
    border-color: var(--danger-border);
    color: var(--danger-strong);
  }

  .replay-row.active .replay-open,
  .submission-list button.active {
    outline: 2px solid var(--accent-base);
    outline-offset: 1px;
  }

  .admin-pill {
    width: 100%;
    padding: 10px;
  }

  .admin-form,
  .admin-actions {
    display: grid;
    gap: 8px;
  }

  .admin-actions {
    grid-template-columns: 1fr 1fr auto;
  }

  .admin-actions .ghost {
    color: var(--text-secondary);
  }

  @media (max-width: 920px) {
    .replay-sidebar {
      min-height: auto;
      border-right: 0;
      border-bottom: 1px solid var(--surface-toolbar-border);
    }
  }
</style>
