<script lang="ts">
  import { flip } from 'svelte/animate';
  import CardTile from './CardTile.svelte';
  import type { PlayerView } from '../game/types';
  import { easeSettle, flipReflowMs, handEnter } from '../motion';
  import { replayStore } from '../../state/replay.svelte';
  import { cardMotionStore } from '../../state/cardMotion.svelte';

  type Props = {
    player: PlayerView;
    disabled?: boolean;
    concealed?: boolean;
  };

  let {
    player,
    disabled = false,
    concealed = false,
  }: Props = $props();

  // The hand renders in NATURAL (snapshot/draw) order — no auto-sort. Sorting was
  // dropped deliberately: it reshuffled the hand every step (churn) and moved a
  // freshly-drawn card away from the trailing slot its flight clone targets, which
  // made the wrong card reveal. Natural order keeps the newest cards LAST, so the
  // draw/claim hand-off lands on exactly the right card.

  // Stable per-instance keys so the FLIP reflow tracks each card across a step.
  // CardView has no instance id (only a species id), so we disambiguate repeats
  // by occurrence order — unique within the hand, stable for the common case of
  // distinct cards (the gravity that matters when a middle card leaves).
  let handCards = $derived.by(() => {
    const seen = new Map<string, number>();
    const list = player.hand.map((card) => {
      const base = String(card.id ?? card.fullName ?? card.name ?? 'card');
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      return { card, key: `${base}#${n}` };
    });
    return list;
  });

  // One-continuous-card draw hand-off: while a deck→hand draw clone is in flight,
  // the store suppresses the freshly-drawn cards so the flight is their sole
  // entrance (mirrors prototype E). Drawn cards append to the end, so the newest
  // are the LAST N in DOM order — we mark exactly that many trailing cards
  // hidden + skip their handEnter. Only the face-up (non-concealed) hand hands off;
  // the opponent's facedown fan keeps the overlay's cardback ghost as before.
  let suppressedTail = $derived(concealed ? 0 : cardMotionStore.suppressedHandCount(player.index));
  let activeBudgetMs = $derived(cardMotionStore.activeBudgetMs);
  function isSuppressed(index: number): boolean {
    // Never hide more cards than are actually rendered: if the suppressed count
    // ever exceeds the hand (a prize-take count beyond the new face-up cards, or a
    // draw measured before the DOM grew), an unclamped threshold goes negative and
    // hides EVERY card. Clamp so only real trailing cards are ever suppressed.
    const tail = Math.min(suppressedTail, handCards.length);
    return tail > 0 && index >= handCards.length - tail;
  }

  let handElement = $state<HTMLDivElement>();
  let canScrollLeft = $state(false);
  let canScrollRight = $state(false);

  function updateScrollIndicators() {
    if (!handElement || concealed) {
      canScrollLeft = false;
      canScrollRight = false;
      return;
    }
    const maxScrollLeft = handElement.scrollWidth - handElement.clientWidth;
    canScrollLeft = handElement.scrollLeft > 1;
    canScrollRight = maxScrollLeft - handElement.scrollLeft > 1;
  }

  $effect(() => {
    player.hand.length;
    concealed;
    updateScrollIndicators();
  });

  $effect(() => {
    if (!handElement || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(updateScrollIndicators);
    observer.observe(handElement);
    return () => observer.disconnect();
  });
</script>

<div
  bind:this={handElement}
  class:disabled
  class:concealed
  class:can-scroll-left={canScrollLeft}
  class:can-scroll-right={canScrollRight}
  class="hand"
  data-testid={`hand-${player.index}`}
  data-card-count={player.hand.length}
  onscroll={updateScrollIndicators}
>
  {#if concealed}
    {#each handCards as item, index (item.key)}
      <CardTile
        card={item.card}
        compact
        disabled={disabled}
        faceDown
        testId={`hand-card-${player.index}-${index}`}
      />
    {/each}
  {:else}
    {#each handCards as item, index (item.key)}
      <div
        class="hand-card"
        style:visibility={isSuppressed(index) ? 'hidden' : null}
        in:handEnter={{
          speedId: replayStore.playbackSpeedId,
          budgetMs: activeBudgetMs,
          skip: isSuppressed(index),
        }}
        animate:flip={{
          duration: flipReflowMs(replayStore.playbackSpeedId, activeBudgetMs),
          easing: easeSettle,
        }}
      >
        <CardTile
          card={item.card}
          compact
          disabled={disabled}
          testId={`hand-card-${player.index}-${index}`}
        />
      </div>
    {/each}
  {/if}
</div>

<style>
  .hand {
    --hand-fade-size: calc(var(--card-w) * 0.68);
    --hand-scroll-mask: linear-gradient(90deg, #000 0%, #000 100%);
    position: relative;
    z-index: 1;
    min-width: 0;
    min-height: calc(var(--card-w) * 1.42);
    flex: 1;
    display: flex;
    justify-content: flex-start;
    align-items: center;
    gap: calc(var(--card-w) * 0.1);
    overflow-x: auto;
    overflow-y: hidden;
    padding: 10px 4px;
    pointer-events: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: thin;
    -webkit-mask-image: var(--hand-scroll-mask);
    mask-image: var(--hand-scroll-mask);
    -webkit-overflow-scrolling: touch;
  }

  .hand:not(.concealed).can-scroll-left {
    --hand-scroll-mask: linear-gradient(90deg, transparent 0, #000 var(--hand-fade-size), #000 100%);
  }

  .hand:not(.concealed).can-scroll-right {
    --hand-scroll-mask: linear-gradient(90deg, #000 0, #000 calc(100% - var(--hand-fade-size)), transparent 100%);
  }

  .hand:not(.concealed).can-scroll-left.can-scroll-right {
    --hand-scroll-mask: linear-gradient(
      90deg,
      transparent 0,
      #000 var(--hand-fade-size),
      #000 calc(100% - var(--hand-fade-size)),
      transparent 100%
    );
  }

  .hand:not(.concealed)::before,
  .hand:not(.concealed)::after {
    content: '';
    pointer-events: none;
    flex: 1 0 0;
  }

  /* The keyed wrapper is the flex item that the FLIP reflow animates; the card
     tile inside keeps its own hover-lift transform, so the two never fight. */
  .hand:not(.concealed) .hand-card {
    flex: 0 0 auto;
    display: block;
    will-change: transform;
  }

  .hand:not(.concealed) :global(.card-tile) {
    flex: 0 0 auto;
  }

  :global(.debug-zones) .hand {
    outline: 2px dashed rgba(236, 72, 153, 0.86);
    outline-offset: -4px;
    background: rgba(236, 72, 153, 0.08);
  }

  .hand.concealed {
    justify-content: center;
    min-height: calc(var(--card-w) * 1.42);
    overflow: visible;
    pointer-events: none;
    -webkit-mask-image: none;
    mask-image: none;
  }

  .hand.concealed :global(.card-tile) {
    width: calc(var(--card-w) * 0.78);
    margin-right: calc(var(--card-w) * -0.46);
    transform: translateY(calc(var(--card-w) * -0.52));
  }

  .hand.concealed :global(.card-tile.compact) {
    width: calc(var(--card-w) * 0.8);
  }

  .hand.concealed::after {
    content: attr(data-card-count);
    position: absolute;
    left: 50%;
    top: 50%;
    z-index: 4;
    min-width: 34px;
    min-height: 34px;
    display: grid;
    place-items: center;
    transform: translate(-50%, -50%);
    border-radius: var(--radius-pill);
    border: 1px solid var(--pile-count-border);
    background: var(--pile-count-bg);
    color: var(--pile-count-text);
    box-shadow: var(--surface-toolbar-shadow);
    font-size: 17px;
    font-weight: 900;
    pointer-events: none;
  }

  :global(.player-panel.top) .hand {
    height: 100%;
    min-height: 0;
    padding: 0 4px;
    align-items: end;
    overflow: visible;
  }

  :global(.player-panel.top) .hand.concealed :global(.card-tile) {
    width: var(--card-w);
    transform: none;
  }

  :global(.player-panel.top) .hand.concealed::after {
    top: calc(100% + 2px);
  }

  :global(.player-panel.bottom) .hand {
    min-height: 0;
    align-items: start;
    padding-top: var(--hand-hover-clearance);
    padding-bottom: var(--hand-shadow-clearance);
  }
</style>
