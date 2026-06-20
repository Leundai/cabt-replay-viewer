<script lang="ts">
  import { onMount } from 'svelte';
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
  } from '../api/client';

  const defaultCompetition = 'pokemon-tcg-ai-battle';

  type Props = {
    activeReplayId: string;
    loadDemoReplay: () => void | Promise<void>;
    openStoredReplay: (id: string) => void | Promise<void>;
    openReplayData: (replayData: unknown) => void | Promise<void>;
  };

  let {
    activeReplayId,
    loadDemoReplay,
    openStoredReplay,
    openReplayData,
  }: Props = $props();

  let searchQuery = $state('');
  let library = $state<ReplaySummary[]>([]);
  let libraryLoading = $state(false);
  let libraryError = $state('');
  let uploadDragActive = $state(false);
  let uploadInput = $state<HTMLInputElement>();

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

  let filteredSubmissions = $derived(filterSubmissions(submissions, searchQuery));

  onMount(() => {
    void refreshLibrary();
    void refreshKaggleStatus();
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

  async function importFile(file: File | undefined) {
    uploadDragActive = false;
    if (!file) {
      return;
    }

    try {
      const replayJson = JSON.parse(await file.text());
      await openReplayData(replayJson);
      try {
        const saved = await importReplayJson(replayJson, file.name);
        await openStoredReplay(saved.id);
        await refreshLibrary();
      } catch (error) {
        libraryError = error instanceof Error ? error.message : String(error);
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
      const saved = await importKaggleEpisode(episodeId);
      await openStoredReplay(saved.id);
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
</script>

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
    {#if libraryError}
      <p class="panel-error">{libraryError}</p>
    {/if}
    {#if library.length === 0}
      <p class="empty">Imported Kaggle episodes and JSON files will appear here.</p>
    {:else}
      <div class="replay-list">
        {#each library as item}
          <button
            type="button"
            class:active={activeReplayId === item.id}
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

  @media (max-width: 920px) {
    .replay-sidebar {
      min-height: auto;
      border-right: 0;
      border-bottom: 1px solid var(--surface-toolbar-border);
    }
  }
</style>
