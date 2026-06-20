<script lang="ts">
  import type { CardView } from '../game/types';
  import { cardInspectorStore } from '../../state/cardInspector.svelte';

  type Props = {
    card?: CardView;
    compact?: boolean;
    selected?: boolean;
    draggable?: boolean;
    disabled?: boolean;
    interactive?: boolean;
    faceDown?: boolean;
    playable?: boolean;
    testId?: string;
    onclick?: (event: MouseEvent) => void;
    ondragstart?: (event: DragEvent) => void;
    ondragend?: (event: DragEvent) => void;
  };

  let {
    card,
    compact = false,
    selected = false,
    draggable = false,
    disabled = false,
    interactive = false,
    faceDown = false,
    playable = false,
    testId = '',
    onclick,
    ondragstart,
    ondragend,
  }: Props = $props();

  let failedImageUrl = $state('');

  let imageUrl = $derived(faceDown ? '/assets/cardback.png' : (card?.imageUrl ?? card?.cardImage));
  let lastImageUrl = $state<string | undefined>();
  let showImage = $derived(!!imageUrl && failedImageUrl !== imageUrl);
  let label = $derived(faceDown ? 'Card' : (card?.name ?? 'Empty'));
  let typeClass = $derived(faceDown
    ? 'back'
    : card?.energyType !== undefined || card?.name?.includes('Energy')
      ? 'energy'
      : card?.trainerType !== undefined
        ? 'trainer'
        : card
          ? 'pokemon'
          : 'empty');
  let canInspect = $derived(!!card && !faceDown);
  // When the card has no play action of its own (the replay-mode default), the
  // whole face becomes the inspect target — clicking anywhere opens the preview
  // instead of hunting for a tiny hover-only magnifier.
  let inspectSurface = $derived(canInspect && !interactive);

  $effect(() => {
    if (imageUrl !== lastImageUrl) {
      failedImageUrl = '';
      lastImageUrl = imageUrl;
    }
  });

  function preventSelection(event: Event) {
    event.preventDefault();
  }

  function inspectCard(event?: MouseEvent) {
    event?.preventDefault();
    event?.stopPropagation();
    cardInspectorStore.show(card, faceDown);
  }
</script>

<div
  class:selected
  class:compact
  class:playable
  class:interactive
  class:inspectable={inspectSurface}
  class:disabled
  class={`card-tile ${typeClass}`}
  data-testid={testId || undefined}
  title={card?.fullName ?? label}
  role={interactive ? 'group' : 'img'}
  aria-label={card?.fullName ?? label}
>
  {#if showImage}
    <img src={imageUrl} alt="" loading="lazy" decoding="async" draggable="false" onerror={() => (failedImageUrl = imageUrl ?? '')} />
  {:else}
    <span class="fallback-name">{label}</span>
    {#if card?.set}
      <span class="fallback-set">{card.set} {card.setNumber}</span>
    {/if}
  {/if}
  {#if interactive}
    <button
      type="button"
      class="card-primary-action"
      draggable={draggable && !disabled}
      {disabled}
      aria-label={card?.fullName ?? label}
      {onclick}
      {ondragstart}
      {ondragend}
      onselectstart={preventSelection}
    ></button>
    {#if canInspect}
      <button
        type="button"
        class="card-inspect-action"
        aria-label={`Open ${card?.name ?? 'card'} preview`}
        title="Open card preview"
        onclick={inspectCard}
      ></button>
    {/if}
  {:else if inspectSurface}
    <button
      type="button"
      class="card-inspect-surface"
      aria-label={`Open ${card?.name ?? 'card'} preview`}
      title="Open card preview"
      onclick={inspectCard}
    ></button>
  {/if}
</div>

<style>
  .card-tile {
    position: relative;
    z-index: 0;
    width: var(--card-w, clamp(58px, 5.3vw, 88px));
    aspect-ratio: 63 / 88;
    display: grid;
    place-items: center;
    padding: 0;
    overflow: hidden;
    border: 0;
    border-radius: 5px;
    background: #f7f8fa;
    box-shadow: 0 3px 8px rgba(23, 30, 38, 0.28);
    transition:
      transform var(--dur-press) var(--ease-out),
      box-shadow var(--dur-press) var(--ease-out),
      outline-color var(--dur-press) var(--ease-out),
      filter var(--dur-press) var(--ease-out);
  }

  /* Hover lift only on real pointers — touch fires hover on tap. */
  @media (hover: hover) and (pointer: fine) {
    .card-tile.interactive:hover:not(.disabled),
    .card-tile.inspectable:hover {
      z-index: 4;
      transform: translateY(-6px);
      box-shadow: var(--glow-hover-shadow);
      filter: saturate(1.05);
    }

    /* Press feedback: the card scales toward the cursor, confirming the click. */
    .card-tile.interactive:active:not(.disabled),
    .card-tile.inspectable:active {
      transform: translateY(-6px) scale(0.97);
    }
  }

  /* Reduced motion keeps the glow (it aids comprehension) but drops the lift. */
  @media (prefers-reduced-motion: reduce) {
    .card-tile.interactive:hover:not(.disabled),
    .card-tile.interactive:active:not(.disabled),
    .card-tile.inspectable:hover,
    .card-tile.inspectable:active {
      transform: none;
    }
  }

  .card-tile.compact {
    width: var(--card-w, clamp(62px, 5.7vw, 92px));
  }

  .card-tile.selected {
    z-index: 3;
    transform: translateY(-6px);
    outline: 0;
    box-shadow: var(--glow-selected-shadow);
  }

  .card-tile.selected.interactive:hover:not(.disabled) {
    box-shadow: var(--glow-selected-shadow);
  }

  .card-tile.playable {
    outline: 0;
    box-shadow: var(--glow-playable-shadow);
  }

  .card-tile.selected.disabled {
    opacity: 1;
  }

  .card-primary-action {
    position: absolute;
    inset: 0;
    z-index: 12;
    display: block;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    border-radius: inherit;
    background: transparent;
    box-shadow: none;
    cursor: pointer;
  }

  .card-primary-action:disabled {
    cursor: default;
  }

  .card-primary-action:focus-visible {
    outline: 2px solid var(--selection-border-strong);
    outline-offset: 2px;
  }

  /* Full-face inspect target for replay/non-interactive cards: click anywhere on
     the card to open the preview. Transparent, fills the tile, sits above the art
     but below transient overlays like the damage counter. */
  .card-inspect-surface {
    position: absolute;
    inset: 0;
    z-index: 8;
    display: block;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: inherit;
    background: transparent;
    box-shadow: none;
    cursor: zoom-in;
    -webkit-appearance: none;
    appearance: none;
  }

  .card-inspect-surface:focus-visible {
    outline: 2px solid var(--selection-border-strong);
    outline-offset: 2px;
  }

  .card-inspect-action {
    position: absolute;
    right: 4px;
    top: 4px;
    z-index: 14;
    width: clamp(18px, calc(var(--card-w, 88px) * 0.24), 28px);
    height: clamp(18px, calc(var(--card-w, 88px) * 0.24), 28px);
    display: grid;
    place-items: center;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.82);
    border-radius: 999px;
    background: rgba(18, 23, 31, 0.76);
    color: #fff;
    box-shadow: 0 5px 14px rgba(12, 15, 19, 0.34);
    opacity: 0;
    transform: translateY(-2px) scale(0.96);
    transition:
      opacity 140ms var(--ease-out),
      transform 140ms var(--ease-out),
      background 140ms var(--ease-out);
  }

  .card-inspect-action::before {
    content: "";
    width: 38%;
    aspect-ratio: 1;
    border: 2px solid currentColor;
    border-radius: 999px;
    transform: translate(-1px, -1px);
  }

  .card-inspect-action::after {
    content: "";
    position: absolute;
    width: 32%;
    height: 2px;
    border-radius: 999px;
    background: currentColor;
    transform: translate(28%, 36%) rotate(45deg);
    transform-origin: center;
  }

  .card-tile:hover .card-inspect-action,
  .card-inspect-action:focus-visible {
    opacity: 1;
    transform: translateY(0) scale(1);
  }

  @media (hover: none) {
    .card-inspect-action {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .card-inspect-action:hover,
  .card-inspect-action:focus-visible {
    background: rgba(18, 23, 31, 0.92);
  }

  .card-inspect-action:active {
    transform: translateY(0) scale(0.94);
  }

  .card-tile img {
    width: 100%;
    height: 100%;
    object-fit: fill;
    display: block;
    pointer-events: none;
    -webkit-user-drag: none;
  }

  .fallback-name,
  .fallback-set {
    padding: 0 7px;
    text-align: center;
    line-height: 1.08;
  }

  .fallback-name {
    align-self: end;
    font-size: 11px;
    font-weight: 900;
  }

  .fallback-set {
    align-self: start;
    color: #66707c;
    font-size: 9px;
  }

  .card-tile.energy {
    background: linear-gradient(#fff7cc, #e7c95b);
  }

  .card-tile.trainer {
    background: linear-gradient(#fafafa, #d8dde4);
  }
</style>
