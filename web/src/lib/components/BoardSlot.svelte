<script lang="ts">
  import { onDestroy } from 'svelte';
  import CardTile from './CardTile.svelte';
  import { safeCardImageUrl } from '../game/cardImages';
  import { energyIconSrc, pokemonTypeIconSrc, pokemonTypeLabelFor } from '../game/energyIcons';
  import type { PokemonSlotView } from '../game/types';
  import { cardSwap, pop, EASE_ANTICIP, EASE_ARC, EASE_OUT } from '../motion';
  import { applyEffectVars } from '../motionEffects';
  import { motionDelay, motionDuration } from '../replayMotionTiming';
  import { cardMotionStore, type AttackIntent } from '../../state/cardMotion.svelte';

  type Props = {
    slot: PokemonSlotView;
    active?: boolean;
    placement?: '' | 'top-active-slot' | 'bottom-active-slot';
    onclick?: (event: MouseEvent) => void;
  };

  let {
    slot,
    active = false,
    placement = '',
    onclick,
  }: Props = $props();

  let stackedEnergy = $derived(slot.energy.length > 4);
  let displayHp = $derived(slot.hp || pokemonHp(slot.pokemon));
  let printedHp = $derived(pokemonHp(slot.pokemon));
  let hpModified = $derived(!!displayHp && !!printedHp && displayHp !== printedHp);
  let hpIncreased = $derived(hpModified && displayHp > printedHp);
  let hpDecreased = $derived(hpModified && displayHp < printedHp);
  let pokemonTypeIcon = $derived(pokemonTypeIconSrc(slot.pokemon?.cardType));
  let pokemonTypeLabel = $derived(pokemonTypeLabelFor(slot.pokemon?.cardType));
  let toolPreview = $derived(slot.tools[0]);
  let toolPreviewImageUrl = $derived(safeCardImageUrl(toolPreview?.imageUrl ?? toolPreview?.cardImage));
  let toolNames = $derived(slot.tools.map((tool) => tool.fullName || tool.name).join(', '));
  let failedToolImageUrl = $state('');
  let lastToolImageUrl = $state<string | undefined>();
  let showToolImage = $derived(!!toolPreviewImageUrl && failedToolImageUrl !== toolPreviewImageUrl);

  $effect(() => {
    if (toolPreviewImageUrl !== lastToolImageUrl) {
      failedToolImageUrl = '';
      lastToolImageUrl = toolPreviewImageUrl;
    }
  });

  function energyStackStyle(index: number) {
    if (!stackedEnergy) {
      return '';
    }
    const progress = slot.energy.length <= 1 ? 0 : index / (slot.energy.length - 1);
    const offsetPercent = progress * 75;
    const offsetPixels = progress * 1.5;
    return `--energy-offset: calc(${offsetPercent}% + ${offsetPixels}px); --energy-z: ${index + 1};`;
  }

  function hasPendingAttach(card: { pendingAttach?: unknown }) {
    return card.pendingAttach === true;
  }

  function pokemonHp(card: { hp?: unknown } | undefined) {
    return typeof card?.hp === 'number' && Number.isFinite(card.hp) ? card.hp : 0;
  }

  function activateFromKeyboard(event: KeyboardEvent) {
    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) {
      return;
    }
    event.preventDefault();
    onclick?.(event as unknown as MouseEvent);
  }

  // --- Attack cinematic: a real-element lunge/recoil driven by the motion store.
  // We animate the inner `.slot-card` (resting transform is `none`), never the
  // wrapper (translateZ) or `.card-tile` (the top player's 180deg rotation), so
  // WAAPI cancel always leaves the node clean.
  let slotRoot = $state<HTMLDivElement>();
  let slotKeyValue = $derived(`slot-${slot.ownerIndex}-${slot.slot}-${slot.index}`);
  // While a play-clone is flying toward this slot, hide the real card so it does
  // not pop into place before the cinematic lands. The store seeds this in the
  // same flush as the snapshot, so there is never a one-frame flash.
  let incoming = $derived(cardMotionStore.isSuppressed(slotKeyValue));
  // Seed from the live batch so a remount doesn't replay an in-flight batch.
  let appliedBatchId = cardMotionStore.batch?.batchId ?? 0;
  let activeAnims: Animation[] = [];
  let activeSpark: HTMLElement | null = null;
  let pendingRaf = 0;

  function clearAttackFx() {
    if (pendingRaf) {
      cancelAnimationFrame(pendingRaf);
      pendingRaf = 0;
    }
    activeAnims.forEach((anim) => anim.cancel());
    activeAnims = [];
    activeSpark?.remove();
    activeSpark = null;
  }

  function centerOf(el: Element) {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, w: rect.width, h: rect.height };
  }

  function spawnImpact(
    atk: AttackIntent,
    defCenter: { x: number; y: number; w: number; h: number },
    ux: number,
    uy: number,
    budgetMs: number,
    reduced: boolean,
  ) {
    if (!slotRoot) {
      return;
    }
    const slotRect = slotRoot.getBoundingClientRect();
    // Bias the burst toward the attacker-facing edge of the defender card.
    const contactX = defCenter.x - ux * defCenter.w * 0.3 - slotRect.left;
    const contactY = defCenter.y - uy * defCenter.h * 0.3 - slotRect.top;
    const spark = document.createElement('div');
    spark.className = 'fx-impact';
    spark.style.left = `${contactX.toFixed(1)}px`;
    spark.style.top = `${contactY.toFixed(1)}px`;
    applyEffectVars(spark, atk.effectKind);
    slotRoot.appendChild(spark);
    activeSpark = spark;
    const fromScale = reduced ? 1 : 0.9;
    const toScale = reduced ? 1 : 1.3;
    const anim = spark.animate(
      [
        { transform: `translate(-50%, -50%) scale(${fromScale})`, opacity: 0 },
        { opacity: 0.92, offset: 0.3 },
        { transform: `translate(-50%, -50%) scale(${toScale})`, opacity: 0 },
      ],
      {
        duration: reduced
          ? motionDuration(budgetMs, 0.12, 140, 220)
          : motionDuration(budgetMs, 0.22, 220, 460),
        easing: EASE_OUT,
      },
    );
    anim.onfinish = () => {
      spark.remove();
      if (activeSpark === spark) {
        activeSpark = null;
      }
    };
    activeAnims.push(anim);
  }

  function runAttack(atk: AttackIntent, isAttacker: boolean, skipDefenderMove: boolean, budgetMs: number, reduced: boolean) {
    const atkEl = document.querySelector<HTMLElement>(`[data-testid="${atk.attackerKey}"] .slot-card`);
    const defEl = document.querySelector<HTMLElement>(`[data-testid="${atk.defenderKey}"] .slot-card`);
    if (!atkEl || !defEl) {
      return;
    }
    const isDefender = !isAttacker;
    const a = centerOf(atkEl);
    const d = centerOf(defEl);
    const len = Math.hypot(d.x - a.x, d.y - a.y) || 1;
    const ux = (d.x - a.x) / len;
    const uy = (d.y - a.y) / len;
    const mag = Math.min(64, Math.max(28, len * 0.22));
    const dx = ux * mag;
    const dy = uy * mag;

    if (isDefender) {
      spawnImpact(atk, d, ux, uy, budgetMs, reduced);
    }

    if (reduced) {
      if (isAttacker || !skipDefenderMove) {
        const el = isAttacker ? atkEl : defEl;
        activeAnims.push(
          el.animate(
            [{ opacity: 1 }, { opacity: 0.72, offset: 0.4 }, { opacity: 1 }],
            { duration: motionDuration(budgetMs, 0.12, 140, 220), easing: EASE_OUT },
          ),
        );
      }
      return;
    }

    if (isAttacker) {
      const duration = motionDuration(budgetMs, 0.42, 260, 680);
      // Per-phase easing for a real STRIKE (E's lunge), not a symmetric ease-in-out
      // that softens the start and kills the snap: the wind-up pull-back anticipates
      // (EASE_ANTICIP), the drive-in snaps (EASE_ARC), the recoil settles with weight
      // (EASE_OUT/settle). Same keyframes, magnitudes and contact timing as before —
      // only the curve between them changes. FX classes untouched.
      activeAnims.push(
        atkEl.animate(
          [
            { transform: 'translate(0px, 0px) scale(1)', offset: 0, easing: EASE_ANTICIP },
            { transform: `translate(${(-dx * 0.16).toFixed(2)}px, ${(-dy * 0.16).toFixed(2)}px) scale(1)`, offset: 0.2, easing: EASE_ARC },
            { transform: `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) scale(1.05)`, offset: 0.46, easing: EASE_OUT },
            { transform: 'translate(0px, 0px) scale(1)', offset: 1 },
          ],
          { duration },
        ),
      );
    }

    if (isDefender && !skipDefenderMove) {
      const duration = motionDuration(budgetMs, 0.34, 220, 560);
      const delay = motionDelay(budgetMs, 0.18, 320);
      activeAnims.push(
        defEl.animate(
          [
            { transform: 'translate(0px, 0px) scale(1)', filter: 'blur(0px)', offset: 0 },
            { transform: `translate(${(dx * 0.16).toFixed(2)}px, ${(dy * 0.16).toFixed(2)}px) scale(0.97)`, filter: 'blur(1.4px)', offset: 0.3 },
            { transform: `translate(${(dx * 0.05).toFixed(2)}px, ${(dy * 0.05).toFixed(2)}px) scale(1)`, filter: 'blur(0px)', offset: 0.6 },
            { transform: 'translate(0px, 0px) scale(1)', filter: 'blur(0px)', offset: 1 },
          ],
          { duration, delay, easing: EASE_OUT, fill: 'backwards' },
        ),
      );
    }
  }

  $effect(() => {
    const batch = cardMotionStore.batch;
    const id = batch?.batchId ?? 0;
    if (id === appliedBatchId) {
      return;
    }
    appliedBatchId = id;
    clearAttackFx(); // a new batch (or a clear) interrupts any in-flight lunge
    const atk = batch?.attack;
    if (!atk) {
      return;
    }
    const isAttacker = slotKeyValue === atk.attackerKey;
    const isDefender = slotKeyValue === atk.defenderKey;
    if (!isAttacker && !isDefender) {
      return;
    }
    if (isAttacker && atk.attackerReplaced) {
      return; // the lunge target just remounted; let cardSwap own it
    }
    const skipDefenderMove = isDefender && atk.defenderReplaced;
    const budgetMs = batch.budgetMs;
    const reduced = batch.reduced;
    // One rAF so we read rects after the post-step layout has settled. Keep the
    // handle so a superseding batch's clearAttackFx() can cancel it before it
    // fires (otherwise two rAFs would run runAttack on the same card).
    pendingRaf = requestAnimationFrame(() => {
      pendingRaf = 0;
      runAttack(atk, isAttacker, skipDefenderMove, budgetMs, reduced);
    });
  });

  onDestroy(clearAttackFx);
</script>

<div
  bind:this={slotRoot}
  role="button"
  tabindex="0"
  class:active
  class:empty={slot.empty}
  class:motion-incoming={incoming}
  class={`board-slot ${placement}`}
  data-testid={`slot-${slot.ownerIndex}-${slot.slot}-${slot.index}`}
  data-owner-index={slot.ownerIndex}
  data-slot-kind={slot.slot}
  data-slot-index={slot.index}
  title={slot.pokemon?.fullName ?? (slot.slot === 'active' ? 'Active' : `Bench ${slot.index + 1}`)}
  {onclick}
  onkeydown={activateFromKeyboard}
>
  {#if slot.pokemon}
    {#key slot.pokemon.fullName}
      <div class="slot-card" in:cardSwap out:cardSwap>
        <CardTile card={slot.pokemon} />
      </div>
    {/key}
    {#if slot.damage > 0}
      {#key slot.damage}
        <span class="damage-counter" class:triple-digit={slot.damage >= 100} title={`${slot.damage} damage`} in:pop>
          <span class="damage-counter-value">{slot.damage}</span>
        </span>
      {/key}
    {/if}
    {#if displayHp || pokemonTypeIcon}
      <div class="pokemon-status">
        <span
          class="pokemon-hp-bubble"
          class:hp-increased={hpIncreased}
          class:hp-decreased={hpDecreased}
          title={`${displayHp ? `${displayHp} HP${hpModified ? ` (printed ${printedHp})` : ''}` : 'Pokemon'}${pokemonTypeIcon ? ` · ${pokemonTypeLabel}` : ''}`}
        >
          {#if displayHp}
            <span>{displayHp}</span>
          {/if}
          {#if pokemonTypeIcon}
            <img src={pokemonTypeIcon} alt={pokemonTypeLabel} />
          {/if}
        </span>
      </div>
    {/if}
    {#if slot.energy.length}
      <div class="energy-badges" class:stacked-energy={stackedEnergy} title={`${slot.energy.length} attached energy`}>
        {#each slot.energy as energy, energyIndex}
          <img
            src={energyIconSrc(energy)}
            alt={energy.name || 'Energy'}
            class:pending-energy={hasPendingAttach(energy)}
            style={energyStackStyle(energyIndex)}
            in:pop|local={{ from: 0.2, duration: 300 }}
          />
        {/each}
      </div>
    {/if}
    {#if slot.tools.length}
      <div class="tool-card-preview" title={toolNames}>
        {#if showToolImage}
          <img
            src={toolPreviewImageUrl}
            alt={toolPreview?.name || 'Pokemon Tool'}
            loading="lazy"
            decoding="async"
            draggable="false"
            onerror={() => (failedToolImageUrl = toolPreviewImageUrl ?? '')}
          />
        {:else}
          <span>{slot.tools.length > 1 ? `${slot.tools.length} Tools` : 'Tool'}</span>
        {/if}
        {#if slot.tools.length > 1}
          <span class="tool-count" aria-label={`${slot.tools.length} attached tools`}>{slot.tools.length}</span>
        {/if}
      </div>
    {/if}
    <div class="slot-badges" title={displayHp ? `${Math.max(0, displayHp - slot.damage)}/${displayHp} HP remaining` : undefined}>
      {#if slot.specialConditions.length}
        <span>{slot.specialConditions.length} S</span>
      {/if}
    </div>
  {:else}
    <div class="empty-zone"></div>
  {/if}
</div>

<style>
  .board-slot {
    --slot-card-w: var(--card-w);
    position: relative;
    width: var(--card-w);
    min-width: 0;
    aspect-ratio: 63 / 88;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    box-shadow: none;
    display: block;
    transition:
      background var(--transition-fast),
      box-shadow var(--transition-fast),
      filter var(--transition-fast);
  }

  :global(.debug-zones) .board-slot {
    outline: 2px solid rgba(34, 197, 94, 0.78);
    outline-offset: 4px;
    background: rgba(34, 197, 94, 0.06);
  }

  .board-slot.active {
    --slot-card-w: var(--active-w);
    width: var(--active-w);
  }

  .board-slot.empty {
    border: 1px dashed var(--slot-empty-border);
    background: var(--slot-empty-bg);
  }

  /* Card + its badges stay laid out (so the clone has a target box) but are
     invisible until the flying clone lands and the store releases this slot.
     visibility (not opacity) so an in-flight cardSwap transition can't reveal it. */
  .board-slot.motion-incoming > * {
    visibility: hidden;
  }

  /* Damage counter lives at the slot level (not inside the card art) so it always
     reads ABOVE the HP bubble, energy, tool and condition badges — the status was
     occluding it before. Upright for both players; no per-side rotation needed. */
  .damage-counter {
    position: absolute;
    top: 32%;
    left: 50%;
    z-index: 8;
    display: inline-grid;
    place-items: center;
    width: clamp(34px, calc(var(--slot-card-w, var(--card-w, 88px)) * 0.38), 66px);
    height: clamp(34px, calc(var(--slot-card-w, var(--card-w, 88px)) * 0.38), 66px);
    padding: 0;
    border-radius: 999px;
    border: 1px solid rgba(128, 76, 18, 0.46);
    background:
      radial-gradient(circle at 34% 24%, rgba(255, 232, 121, 0.9), transparent 34%),
      linear-gradient(180deg, #ffb03d 0%, #f39023 54%, #c97018 100%);
    box-shadow:
      0 3px 8px rgba(95, 48, 13, 0.28),
      inset 0 2px 2px rgba(255, 236, 155, 0.7),
      inset 0 -2px 3px rgba(128, 60, 10, 0.34);
    color: #fff8df;
    font-size: clamp(15px, calc(var(--slot-card-w, var(--card-w, 88px)) * 0.19), 30px);
    font-weight: 950;
    line-height: 1;
    -webkit-text-stroke: 1.3px #1f1f1f;
    paint-order: stroke fill;
    transform: translate(-50%, -50%) scale(var(--motion-scale, 1));
    transform-origin: center;
    pointer-events: none;
    text-shadow: none;
  }

  .damage-counter-value {
    display: inline-block;
  }

  .damage-counter.triple-digit {
    font-size: clamp(13px, calc(var(--slot-card-w, var(--card-w, 88px)) * 0.165), 26px);
  }

  .slot-card {
    position: absolute;
    inset: 0;
    transform-origin: center;
  }

  /* Attack impact burst — appended imperatively to the defender slot, centred on
     the contact point. Screen blend lets it read as light over the card art. */
  .board-slot :global(.fx-impact) {
    position: absolute;
    z-index: 9;
    width: clamp(36px, calc(var(--slot-card-w) * 0.62), 96px);
    height: clamp(36px, calc(var(--slot-card-w) * 0.62), 96px);
    border-radius: 50%;
    background:
      var(--fx-sprite-impact) center / contain no-repeat,
      radial-gradient(
        circle at 50% 50%,
        rgba(255, 255, 255, 0.95) 0%,
        color-mix(in srgb, var(--fx-core, #ffe06a) 82%, white) 26%,
        color-mix(in srgb, var(--fx-edge, #ff8c28) 72%, transparent) 48%,
        rgba(255, 140, 40, 0) 72%
      );
    background-blend-mode: screen;
    box-shadow:
      0 0 20px var(--fx-glow, rgba(255, 176, 61, 0.5)),
      0 0 42px var(--fx-haze, rgba(196, 48, 24, 0.24));
    mix-blend-mode: screen;
    transform: translate(-50%, -50%) scale(0.9);
    opacity: 0;
    pointer-events: none;
    will-change: transform, opacity;
  }

  .board-slot > .slot-card > :global(.card-tile),
  .board-slot > :global(.card-tile) {
    width: 100%;
    height: 100%;
  }

  .empty-zone {
    width: 100%;
    height: 100%;
  }

  .slot-badges {
    position: absolute;
    inset: auto -9px -9px auto;
    z-index: 4;
    display: flex;
    gap: 3px;
    flex-wrap: wrap;
    justify-content: flex-end;
    max-width: 120%;
    pointer-events: none;
  }

  .slot-badges span {
    display: inline-grid;
    place-items: center;
    min-width: 19px;
    min-height: 19px;
    padding: 1px 5px;
    border-radius: var(--radius-pill);
    background: var(--slot-badge-bg);
    box-shadow: var(--slot-badge-shadow);
    color: var(--text-primary);
    font-size: 9px;
    font-weight: 800;
  }

  .pokemon-status {
    position: absolute;
    top: 0;
    right: 0;
    z-index: 6;
    display: grid;
    justify-items: end;
    gap: clamp(2px, calc(var(--slot-card-w) * 0.025), 5px);
    max-width: 100%;
    pointer-events: none;
  }

  .pokemon-hp-bubble {
    display: inline-flex;
    align-items: center;
    gap: clamp(2px, calc(var(--slot-card-w) * 0.03), 5px);
    min-height: clamp(18px, calc(var(--slot-card-w) * 0.16), 26px);
    padding: clamp(1px, calc(var(--slot-card-w) * 0.018), 3px) clamp(3px, calc(var(--slot-card-w) * 0.04), 6px) clamp(1px, calc(var(--slot-card-w) * 0.018), 3px) clamp(6px, calc(var(--slot-card-w) * 0.055), 10px);
    border-radius: 5px;
    border: 1px solid var(--slot-status-border);
    background: var(--slot-status-bg);
    box-shadow: var(--slot-status-shadow);
    color: var(--slot-status-text);
    font-size: clamp(11px, calc(var(--slot-card-w) * 0.105), 16px);
    font-weight: 950;
    line-height: 1;
    white-space: nowrap;
    letter-spacing: 0;
  }

  .pokemon-hp-bubble.hp-increased {
    color: #15803d;
  }

  .pokemon-hp-bubble.hp-decreased {
    color: #b91c1c;
  }

  .pokemon-hp-bubble img {
    width: clamp(13px, calc(var(--slot-card-w) * 0.12), 19px);
    height: clamp(13px, calc(var(--slot-card-w) * 0.12), 19px);
    object-fit: contain;
    filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.28));
  }

  .energy-badges {
    --energy-gap: clamp(2px, calc(var(--slot-card-w) * 0.018), 3px);
    --energy-icon-size: calc((var(--slot-card-w) - (var(--energy-gap) * 3)) / 4);
    position: absolute;
    left: 0;
    bottom: calc(var(--slot-card-w) * -0.095);
    z-index: 5;
    width: 100%;
    min-height: var(--energy-icon-size);
    display: flex;
    align-items: center;
    gap: var(--energy-gap);
    pointer-events: none;
  }

  .energy-badges img {
    flex: 0 0 var(--energy-icon-size);
    width: var(--energy-icon-size);
    height: var(--energy-icon-size);
    border-radius: 999px;
    object-fit: contain;
    filter: drop-shadow(0 3px 4px rgba(23, 30, 38, 0.38));
    transform: scale(var(--motion-scale, 1));
    transform-origin: center;
  }

  .energy-badges img.pending-energy {
    opacity: 0.5;
  }

  .energy-badges.stacked-energy {
    display: block;
  }

  .energy-badges.stacked-energy img {
    position: absolute;
    left: var(--energy-offset);
    bottom: 0;
    z-index: var(--energy-z);
  }

  .tool-card-preview {
    --tool-preview-top: calc(var(--slot-card-w) * 0.38);
    --tool-preview-width: calc(var(--slot-card-w) * 0.5);
    --tool-art-crop-width: 118%;
    --tool-art-crop-height: 260%;
    --tool-art-crop-left: -9%;
    --tool-art-crop-top: -36.3%;
    position: absolute;
    right: 0;
    top: var(--tool-preview-top);
    z-index: 6;
    width: var(--tool-preview-width);
    aspect-ratio: 1.58;
    overflow: hidden;
    display: grid;
    place-items: center;
    border-radius: clamp(3px, calc(var(--slot-card-w) * 0.035), 6px);
    border: 1px solid rgba(255, 255, 255, 0.72);
    background:
      linear-gradient(180deg, rgba(250, 252, 255, 0.92), rgba(210, 218, 227, 0.9));
    box-shadow:
      0 5px 10px rgba(23, 30, 38, 0.34),
      inset 0 0 0 1px rgba(26, 31, 39, 0.18);
    pointer-events: none;
  }

  .tool-card-preview img {
    position: absolute;
    width: var(--tool-art-crop-width);
    height: var(--tool-art-crop-height);
    left: var(--tool-art-crop-left);
    top: var(--tool-art-crop-top);
    display: block;
    object-fit: fill;
    pointer-events: none;
    -webkit-user-drag: none;
  }

  .tool-card-preview > span:not(.tool-count) {
    padding: 0 5px;
    color: #2f3742;
    font-size: clamp(8px, calc(var(--slot-card-w) * 0.07), 11px);
    font-weight: 900;
    line-height: 1;
    white-space: nowrap;
  }

  .tool-count {
    position: absolute;
    right: -1px;
    bottom: -1px;
    min-width: clamp(13px, calc(var(--slot-card-w) * 0.12), 18px);
    min-height: clamp(13px, calc(var(--slot-card-w) * 0.12), 18px);
    display: grid;
    place-items: center;
    border-radius: 999px 0 0 0;
    background: rgba(20, 25, 32, 0.82);
    color: #fff;
    font-size: clamp(8px, calc(var(--slot-card-w) * 0.07), 11px);
    font-weight: 900;
    line-height: 1;
  }
</style>
