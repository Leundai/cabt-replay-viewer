<script lang="ts">
  import { onDestroy } from 'svelte';
  import { safeCardImageUrl } from '../game/cardImages';
  import { EASE_IN_OUT, EASE_OUT } from '../motion';
  import { applyEffectVars, attackEffectKind, type AttackEffectKind } from '../motionEffects';
  import { motionDelay, motionDuration } from '../replayMotionTiming';
  import { cardMotionStore, type AttackIntent, type DrawIntent, type PlayIntent } from '../../state/cardMotion.svelte';

  // A FLAT overlay that covers the board. It deliberately does NOT inherit the
  // board plane's 3D tilt — clones read crisp and we sidestep Safari's
  // preserve-3d compositing bugs. Ghosts/clones are built imperatively so the
  // FLIP-style geometry (measure real rects -> tween transforms) and the
  // interruption story stay fully in our hands. The board itself is untouched.

  let overlayEl = $state<HTMLDivElement>();
  // Seed from the live batch so a remount doesn't replay an in-flight batch.
  let appliedBatchId = cardMotionStore.batch?.batchId ?? 0;
  let activeAnims: Animation[] = [];
  let activeNodes: HTMLElement[] = [];
  let pendingRaf = 0;

  type Box = { x: number; y: number; w: number; h: number; cx: number; cy: number };

  function clearMotionFx() {
    if (pendingRaf) {
      cancelAnimationFrame(pendingRaf);
      pendingRaf = 0;
    }
    activeAnims.forEach((anim) => anim.cancel());
    activeAnims = [];
    activeNodes.forEach((node) => node.remove());
    activeNodes = [];
  }

  function localBox(rect: DOMRect, overlay: DOMRect): Box {
    const x = rect.left - overlay.left;
    const y = rect.top - overlay.top;
    return { x, y, w: rect.width, h: rect.height, cx: x + rect.width / 2, cy: y + rect.height / 2 };
  }

  function boxFor(selector: string, overlay: DOMRect): Box | null {
    const el = document.querySelector(selector);
    return el ? localBox(el.getBoundingClientRect(), overlay) : null;
  }

  /** Transform that places a w*h node (origin top-left) so its CENTRE sits at
   *  (px,py), scaled `s` and rotated `r` about its own centre. */
  function frame(px: number, py: number, w: number, h: number, s: number, r = 0): string {
    return `translate(${(px - w / 2).toFixed(2)}px, ${(py - h / 2).toFixed(2)}px) scale(${s.toFixed(3)}) rotate(${r.toFixed(2)}deg)`;
  }

  function makeNode(className: string, w: number, h: number): HTMLElement {
    const node = document.createElement('div');
    node.className = className;
    node.style.width = `${w}px`;
    node.style.height = `${h}px`;
    overlayEl!.appendChild(node);
    activeNodes.push(node);
    return node;
  }

  function track(anim: Animation, node: HTMLElement, onDone?: () => void) {
    activeAnims.push(anim);
    anim.onfinish = () => {
      node.remove();
      activeNodes = activeNodes.filter((n) => n !== node);
      onDone?.();
    };
  }

  function trackChild(anim: Animation) {
    activeAnims.push(anim);
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  function lineFrame(start: Box, end: { cx: number; cy: number }, h: number, scaleX: number): string {
    const angle = Math.atan2(end.cy - start.cy, end.cx - start.cx) * (180 / Math.PI);
    return `translate(${start.cx.toFixed(2)}px, ${(start.cy - h / 2).toFixed(2)}px) rotate(${angle.toFixed(2)}deg) scaleX(${scaleX.toFixed(3)})`;
  }

  function lineLength(start: Box, end: { cx: number; cy: number }): number {
    return Math.hypot(end.cx - start.cx, end.cy - start.cy);
  }

  function decorateReveal(node: HTMLElement, kind: AttackEffectKind, budgetMs: number, reduced: boolean) {
    applyEffectVars(node, kind);
    if (reduced) {
      return;
    }

    const glint = document.createElement('div');
    glint.className = 'fx-card-glint';
    node.appendChild(glint);
    trackChild(
      glint.animate(
        [
          { transform: 'translateX(-150%) rotate(18deg)', opacity: 0 },
          { opacity: 0.82, offset: 0.38 },
          { transform: 'translateX(150%) rotate(18deg)', opacity: 0 },
        ],
        {
          duration: motionDuration(budgetMs, 0.5, 260, 900),
          delay: motionDelay(budgetMs, 0.08, 140),
          easing: EASE_OUT,
          fill: 'both',
        },
      ),
    );

    const aura = document.createElement('div');
    aura.className = 'fx-reveal-aura';
    node.appendChild(aura);
    trackChild(
      aura.animate(
        [
          { transform: 'scale(0.84)', opacity: 0 },
          { opacity: 0.72, offset: 0.3 },
          { transform: 'scale(1.18)', opacity: 0 },
        ],
        { duration: motionDuration(budgetMs, 0.62, 340, 1100), easing: EASE_OUT, fill: 'both' },
      ),
    );
  }

  function runDrawTrail(start: Box, end: { cx: number; cy: number }, delay: number, duration: number) {
    const length = lineLength(start, end);
    const h = clamp(start.h * 0.16, 7, 22);
    const trail = makeNode('fx-draw-trail', length, h);
    trail.style.transformOrigin = '0 50%';
    applyEffectVars(trail, 'colorless');
    track(
      trail.animate(
        [
          { transform: lineFrame(start, end, h, 0.05), opacity: 0, filter: 'blur(5px)' },
          { opacity: 0.62, filter: 'blur(1px)', offset: 0.28 },
          { transform: lineFrame(start, end, h, 1), opacity: 0, filter: 'blur(8px)' },
        ],
        { duration: Math.max(160, duration - 20), delay, easing: EASE_OUT, fill: 'backwards' },
      ),
      trail,
    );
  }

  function runAttackFx(intent: AttackIntent, overlay: DOMRect, budgetMs: number, reduced: boolean) {
    const attacker = boxFor(`[data-testid="${intent.attackerKey}"] .slot-card`, overlay);
    const defender = boxFor(`[data-testid="${intent.defenderKey}"] .slot-card`, overlay);
    if (!attacker || !defender) {
      return;
    }

    const length = lineLength(attacker, defender);
    const beamH = clamp(Math.min(attacker.w, defender.w) * 0.18, 12, 34);
    const projectileSize = clamp(Math.min(attacker.w, defender.w) * 0.28, 20, 48);
    const total = reduced
      ? motionDuration(budgetMs, 0.16, 160, 220)
      : motionDuration(budgetMs, 0.62, 320, 900);

    if (!reduced) {
      const beam = makeNode('fx-attack-beam', length, beamH);
      beam.style.transformOrigin = '0 50%';
      applyEffectVars(beam, intent.effectKind);
      track(
        beam.animate(
          [
            { transform: lineFrame(attacker, defender, beamH, 0.08), opacity: 0, filter: 'blur(7px)' },
            { opacity: 0.88, filter: 'blur(0.5px)', offset: 0.25 },
            { transform: lineFrame(attacker, defender, beamH, 1), opacity: 0.2, filter: 'blur(1px)', offset: 0.72 },
            { transform: lineFrame(attacker, defender, beamH, 1), opacity: 0, filter: 'blur(8px)' },
          ],
          { duration: total, easing: EASE_OUT, fill: 'backwards' },
        ),
        beam,
      );

      const projectile = makeNode('fx-projectile', projectileSize, projectileSize);
      applyEffectVars(projectile, intent.effectKind);
      track(
        projectile.animate(
          [
            { transform: frame(attacker.cx, attacker.cy, projectileSize, projectileSize, 0.72), opacity: 0, filter: 'blur(4px)' },
            { opacity: 1, filter: 'blur(0px)', offset: 0.16 },
            { transform: frame(defender.cx, defender.cy, projectileSize, projectileSize, 1.08), opacity: 0.94, filter: 'blur(0px)', offset: 0.76 },
            { transform: frame(defender.cx, defender.cy, projectileSize, projectileSize, 1.35), opacity: 0, filter: 'blur(6px)' },
          ],
          { duration: total, easing: EASE_IN_OUT, fill: 'backwards' },
        ),
        projectile,
      );

      const sparkCount = 9;
      for (let i = 0; i < sparkCount; i += 1) {
        const sparkSize = clamp(projectileSize * (0.13 + (i % 3) * 0.035), 4, 10);
        const spark = makeNode('fx-spark', sparkSize, sparkSize);
        applyEffectVars(spark, intent.effectKind);
        const angle = -Math.PI * 0.86 + i * (Math.PI * 1.72) / (sparkCount - 1);
        const distance = projectileSize * (0.58 + (i % 4) * 0.18);
        const sx = defender.cx + Math.cos(angle) * distance;
        const sy = defender.cy + Math.sin(angle) * distance;
        track(
          spark.animate(
            [
              { transform: frame(defender.cx, defender.cy, sparkSize, sparkSize, 0.9), opacity: 0 },
              { opacity: 0.96, offset: 0.22 },
              { transform: frame(sx, sy, sparkSize, sparkSize, 1.15), opacity: 0 },
            ],
            {
              duration: motionDuration(budgetMs, 0.24, 180, 420),
              delay: motionDelay(budgetMs, 0.36, 520),
              easing: EASE_OUT,
              fill: 'backwards',
            },
          ),
          spark,
        );
      }
    }

    const ringSize = clamp(Math.min(attacker.w, defender.w) * (reduced ? 0.92 : 1.12), 46, 150);
    const ring = makeNode('fx-shockwave', ringSize, ringSize);
    applyEffectVars(ring, intent.effectKind);
    track(
      ring.animate(
        reduced
          ? [
              { transform: frame(defender.cx, defender.cy, ringSize, ringSize, 1), opacity: 0 },
              { transform: frame(defender.cx, defender.cy, ringSize, ringSize, 1), opacity: 0.5, offset: 0.4 },
              { transform: frame(defender.cx, defender.cy, ringSize, ringSize, 1), opacity: 0 },
            ]
          : [
              { transform: frame(defender.cx, defender.cy, ringSize, ringSize, 0.58), opacity: 0 },
              { opacity: 0.78, offset: 0.24 },
              { transform: frame(defender.cx, defender.cy, ringSize, ringSize, 1.55), opacity: 0 },
            ],
        {
          duration: reduced ? motionDuration(budgetMs, 0.14, 150, 220) : motionDuration(budgetMs, 0.28, 220, 520),
          delay: reduced ? 0 : motionDelay(budgetMs, 0.34, 620),
          easing: EASE_OUT,
          fill: 'backwards',
        },
      ),
      ring,
    );
  }

  function runDraw(intent: DrawIntent, overlay: DOMRect, budgetMs: number, reduced: boolean) {
    const deck = boxFor(`[data-testid="deck-pile-${intent.ownerIndex}"]`, overlay);
    const hand = boxFor(`[data-testid="hand-${intent.ownerIndex}"]`, overlay);
    if (!deck || !hand) {
      return;
    }
    const cardW = Math.max(40, deck.w);
    const cardH = Math.max(56, deck.h);

    if (reduced) {
      // No flight — a single presence cue fading in at the hand.
      const node = makeNode('motion-ghost', cardW, cardH);
      node.style.transform = frame(hand.cx, hand.cy, cardW, cardH, 0.96);
      track(
        node.animate(
          [{ opacity: 0 }, { opacity: 0.85, offset: 0.5 }, { opacity: 0 }],
          { duration: motionDuration(budgetMs, 0.12, 160, 240), easing: EASE_OUT },
        ),
        node,
      );
      return;
    }

    const count = Math.min(intent.count, 4);
    const stagger = motionDuration(budgetMs, intent.count > 4 ? 0.025 : 0.034, 35, 70);
    const duration = motionDuration(budgetMs, 0.38, 220, 720);
    for (let i = 0; i < count; i += 1) {
      const t = count <= 1 ? 0.5 : i / (count - 1);
      const targetX = hand.x + hand.w * (0.2 + 0.6 * t);
      const tilt = -4 + 8 * t;
      const node = makeNode('motion-ghost', cardW, cardH);
      runDrawTrail(deck, { cx: targetX, cy: hand.cy }, i * stagger, duration);
      track(
        node.animate(
          [
            { transform: frame(deck.cx, deck.cy, cardW, cardH, 0.9, tilt * 0.5), opacity: 0, filter: 'blur(2px)', offset: 0 },
            { opacity: 1, filter: 'blur(0px)', offset: 0.25 },
            { opacity: 1, offset: 0.8 },
            { transform: frame(targetX, hand.cy, cardW, cardH, 0.96, 0), opacity: 0, offset: 1 },
          ],
          { duration, delay: i * stagger, easing: EASE_OUT, fill: 'backwards' },
        ),
        node,
      );
    }
  }

  function runPlay(intent: PlayIntent, overlay: DOMRect, budgetMs: number, reduced: boolean) {
    const plane = document.querySelector('.game-board-plane');
    const center: Box = plane
      ? localBox(plane.getBoundingClientRect(), overlay)
      : { x: 0, y: 0, w: overlay.width, h: overlay.height, cx: overlay.width / 2, cy: overlay.height / 2 };
    const dest = intent.destSelector ? boxFor(`[data-testid="${intent.destSelector}"]`, overlay) : null;
    const hand = boxFor(`[data-testid="hand-${intent.ownerIndex}"]`, overlay);

    // Guard against a zero-size measured anchor so heroScale can never blow up
    // to Infinity/NaN (which would emit an invalid scale() transform). Height is
    // always derived from width at the true card ratio (63:88) — never the raw
    // measured destination height, which can be non-card-shaped and made the
    // surfaced reveal stretch or clip its bottom edge.
    const baseW = Math.max(1, dest ? dest.w : Math.min(124, overlay.width * 0.09));
    const baseH = baseW * (88 / 63);
    // Enlarge to a prominent hero size, but always capped to fit the board so
    // the surfaced card is never cut off, then clamp its centre to stay fully
    // on-screen regardless of where the board's geometric centre falls.
    const margin = 18;
    const desiredHeroW = Math.min(overlay.width * 0.24, 280);
    const fitScale = Math.min((overlay.width - margin * 2) / baseW, (overlay.height - margin * 2) / baseH);
    const heroScale = Math.max(1, Math.min(Math.max(1.5, desiredHeroW / baseW), fitScale));
    const halfW = (baseW * heroScale) / 2;
    const halfH = (baseH * heroScale) / 2;
    const heroX = Math.min(Math.max(center.cx, halfW + margin), overlay.width - halfW - margin);
    const heroY = Math.min(Math.max(center.cy, halfH + margin), overlay.height - halfH - margin);

    const art = safeCardImageUrl(intent.card?.imageUrl ?? intent.card?.cardImage);
    const name = intent.card?.name;
    // Nothing meaningful to surface — skip the reveal entirely rather than
    // flashing a blank card or the literal word "Card".
    if (!art && !name) {
      return;
    }

    const node = makeNode('motion-reveal', baseW, baseH);
    const revealKind = attackEffectKind(intent.card?.cardType ?? intent.card?.energyType);
    decorateReveal(node, revealKind, budgetMs, reduced);
    if (art) {
      const img = document.createElement('img');
      img.src = art;
      img.alt = '';
      img.draggable = false;
      node.appendChild(img);
    } else {
      // No resolvable art: render a real card face (name + set) like the
      // inspector's fallback, never a bare label floating on white.
      node.classList.add('is-fallback');
      const face = document.createElement('div');
      face.className = 'reveal-fallback';
      const nameEl = document.createElement('strong');
      nameEl.textContent = name ?? '';
      face.appendChild(nameEl);
      const setText = [intent.card?.set, intent.card?.setNumber].filter(Boolean).join(' ');
      if (setText) {
        const setEl = document.createElement('span');
        setEl.textContent = setText;
        face.appendChild(setEl);
      }
      node.appendChild(face);
    }

    if (reduced) {
      // Surface big at centre, hold, fade — information without the flight.
      node.style.transform = frame(heroX, heroY, baseW, baseH, heroScale);
      const hold = motionDuration(budgetMs, 0.24, 240, 460);
      track(
        node.animate([{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: hold, easing: EASE_OUT }),
        node,
      );
      return;
    }

    const total = motionDuration(budgetMs, 0.72, 420, 1280);
    const rise = Math.round(total * 0.3);
    const hold = Math.round(total * 0.26);
    const r1 = rise / total;
    const r2 = (rise + hold) / total;
    const origin: Box = hand ?? { x: 0, y: 0, w: baseW, h: baseH, cx: heroX, cy: overlay.height * 0.86 };
    const settle = dest ? frame(dest.cx, dest.cy, baseW, baseH, 1) : frame(heroX, heroY, baseW, baseH, heroScale * 0.92);

    // When the card lands in a real board slot, the clone stays solid all the way
    // down and the slot's hidden card is revealed the instant the clone is
    // removed — one continuous card, no pop. Reveals that fade at centre (no slot)
    // keep the fade-out. `releaseKey` reveals the suppressed slot on finish (also
    // for the centre-fade fallback when the slot element wasn't found at runtime).
    const releaseKey = intent.destSelector?.startsWith('slot-') ? intent.destSelector : null;
    const landsInSlot = !!dest && !!releaseKey;
    const endOpacity = landsInSlot ? 1 : 0;

    track(
      node.animate(
        [
          { offset: 0, transform: frame(origin.cx, origin.cy, baseW, baseH, 0.92), opacity: 0, easing: EASE_OUT },
          { offset: Math.min(0.12, r1 * 0.5), opacity: 1, easing: EASE_OUT },
          { offset: r1, transform: frame(heroX, heroY, baseW, baseH, heroScale), opacity: 1, easing: 'linear' },
          { offset: r2, transform: frame(heroX, heroY, baseW, baseH, heroScale), opacity: 1, easing: EASE_IN_OUT },
          { offset: 0.9, transform: settle, opacity: 1, easing: 'linear' },
          { offset: 1, transform: settle, opacity: endOpacity },
        ],
        { duration: total, fill: 'backwards' },
      ),
      node,
      releaseKey ? () => cardMotionStore.releaseDest(releaseKey) : undefined,
    );
  }

  $effect(() => {
    const batch = cardMotionStore.batch;
    const id = batch?.batchId ?? 0;
    if (id === appliedBatchId) {
      return;
    }
    appliedBatchId = id;
    clearMotionFx(); // a new batch (or a clear) interrupts in-flight ghosts
    if (!batch || !overlayEl || (!batch.attack && batch.travels.length === 0)) {
      return;
    }
    const budgetMs = batch.budgetMs;
    const reduced = batch.reduced;
    // One rAF so rects are read after the post-step layout settles. Keep the
    // handle so a superseding batch's clearMotionFx() can cancel it before it
    // fires (otherwise two rAFs would spawn overlapping ghosts/clones).
    pendingRaf = requestAnimationFrame(() => {
      pendingRaf = 0;
      if (!overlayEl) {
        return;
      }
      const overlay = overlayEl.getBoundingClientRect();
      if (batch.attack) {
        runAttackFx(batch.attack, overlay, budgetMs, reduced);
      }
      for (const travel of batch.travels) {
        if (travel.kind === 'draw') {
          runDraw(travel, overlay, budgetMs, reduced);
        } else {
          runPlay(travel, overlay, budgetMs, reduced);
        }
      }
    });
  });

  onDestroy(clearMotionFx);
</script>

<div bind:this={overlayEl} class="motion-overlay" aria-hidden="true" data-testid="motion-overlay"></div>

<style>
  .motion-overlay {
    position: absolute;
    inset: 0;
    z-index: 40;
    /* No overflow clipping: the surfaced reveal is enlarged and may extend past
       the board frame; clones are transient and pointer-events:none so spilling
       slightly past the board is harmless and never "cuts off" the card. */
    pointer-events: none;
    /* a flat plane over the tilted board — clones are crisp, not unprojected */
    transform-style: flat;
  }

  .motion-overlay :global(.motion-ghost),
  .motion-overlay :global(.motion-reveal),
  .motion-overlay :global(.fx-draw-trail),
  .motion-overlay :global(.fx-attack-beam),
  .motion-overlay :global(.fx-projectile),
  .motion-overlay :global(.fx-shockwave),
  .motion-overlay :global(.fx-spark) {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: center;
    will-change: transform, opacity;
    pointer-events: none;
  }

  .motion-overlay :global(.motion-ghost),
  .motion-overlay :global(.motion-reveal) {
    border-radius: 6px;
  }

  .motion-overlay :global(.motion-ghost) {
    background:
      var(--cardback-shade),
      url('/assets/cardback.png') center / cover no-repeat;
    box-shadow: 0 8px 20px rgba(23, 30, 38, 0.34);
  }

  .motion-overlay :global(.motion-reveal) {
    display: grid;
    place-items: center;
    overflow: hidden;
    background: #f7f8fa;
    isolation: isolate;
    box-shadow:
      0 24px 60px rgba(12, 15, 19, 0.42),
      0 0 28px var(--fx-glow, rgba(235, 184, 82, 0.34)),
      0 0 0 1px rgba(255, 255, 255, 0.5);
  }

  .motion-overlay :global(.motion-reveal img) {
    position: relative;
    z-index: 1;
    width: 100%;
    height: 100%;
    object-fit: fill;
    display: block;
    -webkit-user-drag: none;
  }

  /* Fallback card face (no resolvable art) — mirrors the inspector's fallback so
     a surfaced card always reads as a card, never a stray word on white. */
  .motion-overlay :global(.motion-reveal.is-fallback) {
    background: linear-gradient(180deg, #fbfcfe, #d9dee6);
  }

  .motion-overlay :global(.reveal-fallback) {
    position: relative;
    z-index: 1;
    width: 100%;
    height: 100%;
    display: grid;
    align-content: center;
    justify-items: center;
    gap: 6px;
    padding: 10% 12%;
    text-align: center;
  }

  /* Fixed sizes — the reveal node is transform-scaled to hero size, so the type
     enlarges with it. */
  .motion-overlay :global(.reveal-fallback strong) {
    color: #1d232b;
    font-size: 12px;
    font-weight: 900;
    line-height: 1.08;
  }

  .motion-overlay :global(.reveal-fallback span) {
    color: #66707c;
    font-size: 9px;
    font-weight: 800;
  }

  .motion-overlay :global(.fx-card-glint),
  .motion-overlay :global(.fx-reveal-aura) {
    position: absolute;
    pointer-events: none;
  }

  .motion-overlay :global(.fx-card-glint) {
    z-index: 3;
    left: -28%;
    top: -26%;
    width: 36%;
    height: 152%;
    background:
      var(--fx-sprite-streak) center / 100% 100% no-repeat,
      linear-gradient(
        90deg,
        transparent 0%,
        rgba(255, 255, 255, 0.16) 24%,
        color-mix(in srgb, var(--fx-core, #fff7c8) 70%, white) 48%,
        rgba(255, 255, 255, 0.18) 68%,
        transparent 100%
      );
    background-blend-mode: screen;
    filter: blur(0.4px);
    mix-blend-mode: screen;
    opacity: 0;
  }

  .motion-overlay :global(.fx-reveal-aura) {
    z-index: 2;
    inset: -18%;
    border-radius: 8px;
    background:
      var(--fx-sprite-impact) center / contain no-repeat,
      radial-gradient(circle at 50% 52%, transparent 34%, var(--fx-haze, rgba(156, 119, 58, 0.18)) 58%, transparent 76%),
      linear-gradient(125deg, transparent 20%, var(--fx-glow, rgba(235, 184, 82, 0.34)), transparent 68%);
    background-blend-mode: screen;
    mix-blend-mode: screen;
    opacity: 0;
  }

  .motion-overlay :global(.fx-draw-trail),
  .motion-overlay :global(.fx-attack-beam) {
    border-radius: 999px;
    transform-origin: 0 50%;
    mix-blend-mode: screen;
  }

  .motion-overlay :global(.fx-draw-trail) {
    background:
      var(--fx-sprite-streak) center / 100% 100% no-repeat,
      linear-gradient(90deg, transparent 0%, var(--fx-haze, rgba(156, 119, 58, 0.18)) 18%, var(--fx-core, #fff7c8) 54%, transparent 100%);
    background-blend-mode: screen;
    box-shadow:
      0 0 12px var(--fx-glow, rgba(235, 184, 82, 0.34)),
      0 0 24px var(--fx-haze, rgba(156, 119, 58, 0.18));
  }

  .motion-overlay :global(.fx-attack-beam) {
    background:
      var(--fx-sprite-streak) center / 100% 100% no-repeat,
      linear-gradient(
        90deg,
        transparent 0%,
        var(--fx-haze, rgba(156, 119, 58, 0.18)) 15%,
        color-mix(in srgb, var(--fx-core, #fff7c8) 88%, white) 48%,
        var(--fx-edge, #d8a645) 72%,
        transparent 100%
      );
    background-blend-mode: screen;
    box-shadow:
      0 0 14px var(--fx-glow, rgba(235, 184, 82, 0.34)),
      0 0 36px var(--fx-haze, rgba(156, 119, 58, 0.18));
  }

  .motion-overlay :global(.fx-projectile) {
    border-radius: 50%;
    background:
      var(--fx-sprite-orb) center / contain no-repeat,
      radial-gradient(circle at 38% 32%, rgba(255, 255, 255, 0.96) 0 12%, var(--fx-core, #fff7c8) 26%, var(--fx-edge, #d8a645) 58%, transparent 72%),
      radial-gradient(circle, var(--fx-glow, rgba(235, 184, 82, 0.34)), transparent 68%);
    background-blend-mode: screen;
    box-shadow:
      0 0 16px var(--fx-glow, rgba(235, 184, 82, 0.34)),
      0 0 42px var(--fx-haze, rgba(156, 119, 58, 0.18));
    mix-blend-mode: screen;
  }

  .motion-overlay :global(.fx-shockwave) {
    border-radius: 50%;
    border: 2px solid color-mix(in srgb, var(--fx-core, #fff7c8) 80%, white);
    background:
      var(--fx-sprite-impact) center / contain no-repeat,
      radial-gradient(circle, transparent 48%, var(--fx-haze, rgba(156, 119, 58, 0.18)) 52%, transparent 70%);
    background-blend-mode: screen;
    box-shadow:
      0 0 16px var(--fx-glow, rgba(235, 184, 82, 0.34)),
      inset 0 0 14px var(--fx-haze, rgba(156, 119, 58, 0.18));
    mix-blend-mode: screen;
  }

  .motion-overlay :global(.fx-spark) {
    border-radius: 50%;
    background:
      var(--fx-sprite-orb) center / contain no-repeat,
      color-mix(in srgb, var(--fx-core, #fff7c8) 85%, white);
    background-blend-mode: screen;
    box-shadow:
      0 0 8px var(--fx-glow, rgba(235, 184, 82, 0.34)),
      0 0 18px var(--fx-edge, #d8a645);
    mix-blend-mode: screen;
  }
</style>
