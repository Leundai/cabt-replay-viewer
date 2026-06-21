<script lang="ts">
  import BoardSlot from './BoardSlot.svelte';
  import type { PlayerView, PokemonSlotView } from '../game/types';

  type Props = {
    player: PlayerView;
    slots?: PokemonSlotView[];
    opponent?: boolean;
    showSlot: (player: PlayerView, slot: PokemonSlotView) => void;
  };

  let {
    player,
    slots = [],
    opponent = false,
    showSlot,
  }: Props = $props();
</script>

<div class="bench-zone" class:opponent class:empty={slots.length === 0} style={`--bench-slot-count: ${Math.max(slots.length, 1)};`}>
  <div class="bench-debug-surface" aria-hidden="true"></div>
  <div class="bench-row" class:opponent>
    {#each slots as slot}
      <BoardSlot {slot} onclick={() => showSlot(player, slot)} />
    {/each}
  </div>
</div>

<style>
  .bench-zone {
    position: relative;
    grid-area: bottom-bench;
    align-self: end;
    z-index: 1;
    transform-style: preserve-3d;
    display: grid;
    justify-content: center;
    align-content: center;
    width: min(100%, calc((var(--bench-card-w) * 6) + (var(--bench-gap) * 5) + (var(--board-card-w) * 0.3)));
    min-height: var(--bench-row-h);
    justify-self: center;
    padding: 0 calc(var(--board-card-w) * 0.15);
    border-radius: 7px;
    border: 1px solid transparent;
    background: transparent;
    box-shadow: none;
  }

  .bench-zone.opponent {
    grid-area: top-bench;
    align-self: end;
    align-content: center;
  }

  .bench-zone:not(.opponent) {
    align-content: center;
  }

  :global(.debug-zones) .bench-zone {
    border-color: rgba(16, 185, 129, 0.86);
    background: rgba(16, 185, 129, 0.08);
    box-shadow: inset 0 0 0 1px rgba(16, 185, 129, 0.46);
  }

  .bench-zone.empty {
    min-height: var(--bench-row-h);
  }

  .bench-debug-surface {
    position: absolute;
    inset: 0;
    z-index: 1;
    display: block;
    padding: 0;
    border-radius: 7px;
    border: 1px dashed transparent;
    background: transparent;
    transform: translateZ(12px);
    pointer-events: none;
  }

  :global(.debug-zones) .bench-debug-surface {
    border-color: rgba(5, 150, 105, 0.82);
    background: rgba(5, 150, 105, 0.08);
  }

  .bench-row {
    position: relative;
    z-index: 2;
    transform: translateZ(16px);
    display: flex;
    justify-content: center;
    align-items: center;
    gap: var(--bench-gap);
    width: 100%;
    min-height: var(--bench-row-h);
    height: 100%;
    pointer-events: none;
  }

  .bench-row :global(.board-slot) {
    width: var(--bench-card-w);
    min-width: 32px;
    max-width: var(--bench-card-w);
    flex: 0 1 var(--bench-card-w);
    pointer-events: auto;
  }

  .bench-row.opponent :global(.card-tile) {
    transform: rotate(180deg);
  }

  .bench-row.opponent :global(.energy-badges) {
    inset: calc(var(--slot-card-w) * -0.095) 0 auto auto;
    justify-content: flex-end;
    transform: rotate(180deg);
  }

  .bench-row.opponent :global(.tool-card-preview) {
    inset: auto auto var(--tool-preview-top) 0;
    transform: rotate(180deg);
  }

  .bench-row.opponent :global(.pokemon-status) {
    inset: auto auto 0 0;
    align-items: start;
    justify-items: start;
  }
</style>
