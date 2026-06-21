<script lang="ts">
  import BoardSlot from './BoardSlot.svelte';
  import StadiumCard from './StadiumCard.svelte';
  import type { CardView, PlayerView, PokemonSlotView } from '../game/types';

  type ZoneName = 'discard' | 'lostZone' | 'stadium' | 'playZone';

  type Props = {
    topPlayer: PlayerView;
    bottomPlayer: PlayerView;
    topActiveSlot: PokemonSlotView;
    bottomActiveSlot: PokemonSlotView;
    currentStadium?: CardView;
    currentStadiumOwner?: PlayerView;
    showZone: (playerIndex: number, zone: ZoneName, title: string, faceDown?: boolean) => void;
    showSlot: (player: PlayerView, slot: PokemonSlotView) => void;
  };

  let {
    topPlayer,
    bottomPlayer,
    topActiveSlot,
    bottomActiveSlot,
    currentStadium,
    currentStadiumOwner,
    showZone,
    showSlot,
  }: Props = $props();
</script>

<div class="active-duel">
  <BoardSlot
    slot={topActiveSlot}
    active
    placement="top-active-slot"
    onclick={() => showSlot(topPlayer, topActiveSlot)}
  />

  {#if currentStadium && currentStadiumOwner?.index === topPlayer.index}
    <StadiumCard card={currentStadium} owner={topPlayer} placement="top" {showZone} />
  {/if}

  <BoardSlot
    slot={bottomActiveSlot}
    active
    placement="bottom-active-slot"
    onclick={() => showSlot(bottomPlayer, bottomActiveSlot)}
  />

  {#if currentStadium && currentStadiumOwner?.index === bottomPlayer.index}
    <StadiumCard card={currentStadium} owner={bottomPlayer} placement="bottom" {showZone} />
  {/if}
</div>

<style>
  .active-duel {
    position: relative;
    grid-area: battle;
    align-self: stretch;
    justify-self: stretch;
    z-index: 3;
    transform-style: preserve-3d;
    pointer-events: none;
    display: grid;
    grid-template-rows: var(--active-h) minmax(calc(var(--card-w) * 0.24), 1fr) var(--active-h);
    grid-template-columns: minmax(0, 1fr) var(--active-w) minmax(0, 1fr);
    align-items: center;
    justify-items: center;
    row-gap: 0;
    column-gap: 0;
    min-height: 0;
  }

  :global(.debug-zones) .active-duel {
    outline: 2px solid rgba(245, 158, 11, 0.86);
    outline-offset: 4px;
    background: rgba(245, 158, 11, 0.06);
  }

  .active-duel > :global(.board-slot.active:not(.empty)) {
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.7), 0 12px 26px rgba(23, 30, 38, 0.22);
  }

  .active-duel :global(.top-active-slot) {
    grid-row: 1;
    grid-column: 2;
  }

  .active-duel :global(.bottom-active-slot) {
    grid-row: 3;
    grid-column: 2;
  }

  .active-duel :global(.top-active-slot),
  .active-duel :global(.bottom-active-slot) {
    position: relative;
    z-index: 4;
    transform: translateZ(32px);
    pointer-events: auto;
  }

  .active-duel :global(.top-active-slot .card-tile) {
    transform: rotate(180deg);
  }

  .active-duel :global(.top-active-slot .energy-badges) {
    inset: calc(var(--slot-card-w) * -0.095) 0 auto auto;
    justify-content: flex-end;
    transform: rotate(180deg);
  }

  .active-duel :global(.top-active-slot .tool-card-preview) {
    inset: auto auto var(--tool-preview-top) 0;
    transform: rotate(180deg);
  }

  .active-duel :global(.top-active-slot .pokemon-status) {
    inset: auto auto 0 0;
    align-items: start;
    justify-items: start;
  }
</style>
