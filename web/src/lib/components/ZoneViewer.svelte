<script lang="ts">
  import CardTile from './CardTile.svelte';
  import type { CardView } from '../game/types';

  type Props = {
    title?: string;
    cards?: CardView[];
    faceDown?: boolean;
    open?: boolean;
    actionLabel?: string;
    actionDisabled?: boolean;
    actionTitle?: string;
    close: () => void;
    onAction?: () => void;
  };

  let {
    title = '',
    cards = [],
    faceDown = false,
    open = false,
    actionLabel = '',
    actionDisabled = false,
    actionTitle = '',
    close,
    onAction,
  }: Props = $props();
</script>

{#if open}
  <button type="button" class="zone-viewer-backdrop" aria-label="Close zone viewer" onclick={close}></button>
  <section class="zone-viewer" aria-label={title}>
    <div class="zone-viewer-header" class:has-action={!!actionLabel}>
      <strong>{title}</strong>
      <span>{cards.length} card{cards.length === 1 ? '' : 's'}</span>
      {#if actionLabel}
        <button type="button" disabled={actionDisabled} title={actionTitle} onclick={onAction}>{actionLabel}</button>
      {/if}
      <button type="button" onclick={close}>Close</button>
    </div>
    {#if cards.length}
      <div class="zone-card-grid">
        {#each cards as card, index}
          <CardTile {card} compact faceDown={faceDown} testId={`zone-card-${index}`} />
        {/each}
      </div>
    {:else}
      <p class="zone-empty">Empty</p>
    {/if}
  </section>
{/if}

<style>
  /* Centred in the viewport and bounded by it, so the modal is never clipped at
     the top/bottom regardless of board insets, the right-rail width, or how many
     cards it holds. Fixed positioning keeps it stable even if the table-shell is
     wider than the viewport and scrolled. */
  .zone-viewer {
    position: fixed;
    z-index: 31;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(1120px, calc(100vw - 32px));
    max-height: calc(100dvh - 32px);
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 14px;
    padding: 16px;
    overflow: hidden;
    border: 1px solid var(--surface-glass-border);
    border-radius: 6px;
    background: var(--surface-glass-bg);
    color: var(--text-secondary);
    box-shadow: var(--surface-glass-shadow);
    backdrop-filter: blur(var(--backdrop-blur));
  }

  .zone-viewer-backdrop {
    position: fixed;
    inset: 0;
    z-index: 30;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: var(--overlay-backdrop-bg);
    box-shadow: none;
    cursor: default;
  }

  .zone-viewer-backdrop:hover:not(:disabled) {
    border-color: transparent;
  }

  .zone-viewer-header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto auto;
    gap: 12px;
    align-items: center;
    color: var(--text-muted);
  }

  .zone-viewer-header:not(.has-action) {
    grid-template-columns: minmax(0, 1fr) auto auto;
  }

  .zone-viewer-header strong {
    min-width: 0;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .zone-card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(clamp(96px, 9vw, 142px), 1fr));
    gap: 12px;
    align-content: start;
    align-items: start;
    min-height: 0;
    /* Fills the modal's flexible row and scrolls internally — no fixed cap that
       could fight the modal's own viewport bound. */
    overflow: auto;
    padding: 2px 4px 8px 2px;
  }

  .zone-card-grid :global(.card-tile) {
    width: 100%;
  }

  .zone-empty {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
  }
</style>
