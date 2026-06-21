<script lang="ts">
  type Props = {
    matchupLabel?: string;
    phaseLabel: string;
    turn: number;
    activePlayerName?: string;
    resultLabel?: string;
    gameFinished?: boolean;
  };

  let { matchupLabel = '', phaseLabel, turn, activePlayerName = '', resultLabel = '', gameFinished = false }: Props = $props();
</script>

<div class="game-status" data-testid="game-status">
  <strong class:matchup={matchupLabel}>{matchupLabel || resultLabel || phaseLabel}</strong>
  {#if matchupLabel}
    <span>{resultLabel || phaseLabel}</span>
  {/if}
  <span>Turn {turn}</span>
  {#if !gameFinished}
    <span>{activePlayerName}</span>
  {/if}
</div>

<style>
  /* Cinema HUD: a compact chip centred at the top edge, clear of the settings
     gear (top-right) so the two never share an anchor. */
  .game-status {
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 9;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: nowrap;
    max-width: calc(100vw - 128px);
    white-space: nowrap;
    pointer-events: auto;
    padding: 5px 12px;
    border-radius: 999px;
    border: 1px solid var(--surface-toolbar-border);
    background: var(--surface-toolbar-bg);
    color: var(--text-secondary);
    box-shadow: var(--surface-toolbar-shadow);
    backdrop-filter: blur(var(--backdrop-blur));
    font-size: 11px;
    transition: opacity var(--dur-base, 220ms) var(--ease-out, ease);
  }

  .game-status span:not(:first-child)::before {
    content: "·";
    margin-right: 8px;
    color: var(--text-muted);
  }

  .game-status strong {
    min-width: 0;
    color: var(--accent-strong);
  }

  .game-status strong.matchup {
    max-width: min(44vw, 460px);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @media (max-width: 760px) {
    .game-status strong.matchup {
      max-width: 38vw;
    }
  }
</style>
