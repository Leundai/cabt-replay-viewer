<script lang="ts">
  import { onDestroy } from 'svelte';
  import { safeCardImageUrl } from '../game/cardImages';
  import { EASE_ARC, EASE_IN_OUT, EASE_OUT } from '../motion';
  import { applyEffectVars, attackEffectKind, type AttackEffectKind } from '../motionEffects';
  import { motionDelay, motionDuration } from '../replayMotionTiming';
  import { cardMotionStore, type AttackIntent, type DrawIntent, type PlayIntent, type PrizeIntent } from '../../state/cardMotion.svelte';

  // A FLAT overlay that covers the board. It deliberately does NOT inherit the
  // board plane's 3D tilt — clones read crisp and we sidestep Safari's
  // preserve-3d compositing bugs. Ghosts/clones are built imperatively so the
  // FLIP-style geometry (measure real rects -> tween transforms) and the
  // interruption story stay fully in our hands. The board itself is untouched.

  // Weighted-flight easings ported from prototype E. WAAPI does not resolve CSS
  // custom properties in the `easing` field, so these are LITERAL bezier strings.

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
    // Cancelling fires each tracked anim's oncancel (see track()), which runs the
    // SAME release callback as onfinish — so a superseded clone always reveals (or
    // hands back) its card and never strands it invisible. The store's #publish
    // also clears + re-seeds suppression for the next batch, and the budget safety
    // timer is a final backstop, so a hidden card can never get stuck.
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

  function boxOfEl(el: Element, overlay: DOMRect): Box {
    return localBox(el.getBoundingClientRect(), overlay);
  }

  /** True when an element (or an ancestor) is rotated ~180deg — the opponent
   *  active's inner `.card-tile` is `rotate(180deg)`, so a clone must land at 180
   *  to match the revealed card's orientation instead of visibly flipping. */
  function isRotated180(el: Element | null): boolean {
    let node: Element | null = el;
    let guard = 0;
    while (node && guard < 6) {
      const t = getComputedStyle(node).transform;
      if (t && t !== 'none') {
        // matrix(-1, 0, 0, -1, …) is a 180deg rotation (and matrix3d variant).
        const m = t.match(/matrix\(([^)]+)\)/);
        if (m) {
          const parts = m[1].split(',').map((p) => parseFloat(p));
          if (parts[0] < -0.5 && parts[3] < -0.5) return true;
        }
      }
      node = node.parentElement;
      guard += 1;
    }
    return false;
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
    // Reveal-first, then remove the clone in the SAME task so there is never a
    // frame with neither the clone nor the real card painted (atomic hand-off).
    anim.onfinish = () => {
      onDone?.();
      node.remove();
      activeNodes = activeNodes.filter((n) => n !== node);
    };
    // On cancel (a superseding batch's clearMotionFx) we DON'T run onDone: the
    // store's #publish has already cleared + re-seeded suppression for the next
    // batch, so calling release here could delete a key the NEW batch just seeded
    // and strand its hidden card. Just drop the clone; the deliberate next action
    // owns the board (mirrors prototype E's abort()).
    anim.oncancel = () => {
      node.remove();
      activeNodes = activeNodes.filter((n) => n !== node);
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
          { opacity: 0.38, filter: 'blur(2px)', offset: 0.32 },
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

  type FlightPoint = { cx: number; cy: number; scale: number };

  /** Build prototype E's WEIGHTED ARC keyframes for a w*h flying node travelling
   *  from `from` to `to` (both centre/scale), and spawn a separate contact-shadow
   *  node beneath it that grows on lift and shrinks on landing (sells elevation).
   *  Returns the card keyframes; the shadow is animated + tracked internally so an
   *  interruption (clearMotionFx) never leaks it. `endOpacity` lets a slot-landing
   *  /draw-landing clone stay SOLID (1) while a fading reveal ends at 0.
   *
   *  Curve language ported from E's flyFromTo() / flightFrames (the weight the
   *  user loved): a real lift apex scaled by distance, banking toward the
   *  horizontal velocity vector that levels to 0, a small spring overshoot a hair
   *  past the destination, then rest exactly on it. The single EASE_ARC timing is
   *  applied at the animate() level by the CALLER (not per keyframe), so velocity
   *  stays continuous — no per-segment ease-out discontinuity (the "jagged" tell).
   *  We deliberately do NOT reintroduce the launch anticipation DIP for in-app
   *  flights (the user retracted it); the lift + bank + small overshoot carry the
   *  weight smoothly. `restRotation` lets a clone land matching a 180deg-rotated
   *  destination (the opponent active) so the reveal never visibly flips. */
  function weightedFlightCard(
    from: FlightPoint,
    to: FlightPoint,
    w: number,
    h: number,
    endOpacity: number,
    duration: number,
    delay: number,
    restRotation = 0,
  ): Keyframe[] {
    const dx = to.cx - from.cx;
    const dy = to.cy - from.cy;
    const dist = Math.hypot(dx, dy);
    const lift = Math.min(70, dist * 0.2) + 12; // E's upward bow at the apex
    const bank = clamp(-dx / 28, -12, 12); // lean into the travel direction
    const midScale = from.scale + (to.scale - from.scale) * 0.5;
    const ovx = -dx * 0.012; // overshoot a touch PAST identity, then settle back
    const ovy = -dy * 0.012;

    // Contact shadow on the ground plane — grows as the card lifts (peak ~1.5 at
    // the apex), shrinks on landing; opacity dips mid-flight then firms on contact
    // (E's shadowKeys). Driven by EASE_ARC at the animate level to match the card.
    const shW = w * 0.92;
    const shH = h * 0.34;
    const shadow = makeNode('motion-contact-shadow', shW, shH);
    const shFrame = (px: number, py: number, scale: number, op: number): Keyframe => ({
      transform: `translate(${(px - shW / 2).toFixed(2)}px, ${(py - shH / 2).toFixed(2)}px) scale(${scale.toFixed(3)})`,
      opacity: op,
    });
    const groundY = (t: number) => from.cy + dy * t + h * 0.42;
    track(
      shadow.animate(
        [
          { offset: 0, ...shFrame(from.cx, groundY(0), 0.72, 0.34) },
          { offset: 0.5, ...shFrame(from.cx + dx * 0.5, groundY(0.5), 1.5, 0.12) },
          { offset: 0.82, ...shFrame(from.cx + dx * 0.82, groundY(0.82), 0.95, 0.24) },
          { offset: 1, ...shFrame(to.cx, groundY(1), 0.66, endOpacity > 0 ? 0.22 : 0) },
        ],
        { duration, delay, easing: EASE_ARC, fill: 'backwards' },
      ),
      shadow,
    );

    const fr = (px: number, py: number, scale: number, r: number) => frame(px, py, w, h, scale, r);
    // E's 5-keyframe weighted arc (no launch dip): lift apex with full bank, a
    // leveling descent, a small spring overshoot, then rest exactly on target.
    // Opacity holds SOLID and only settles to endOpacity over the last sliver, so
    // a fading clone reads as a clean arrival, never a ghost. The clone lands at
    // `restRotation` (0 normally; 180 for the rotated opponent active).
    return [
      { offset: 0, transform: fr(from.cx, from.cy, from.scale, restRotation * 0.04 + bank * 0.2), opacity: 1 },
      { offset: 0.5, transform: fr(from.cx + dx * 0.5, from.cy + dy * 0.5 - lift, midScale, restRotation * 0.4 + bank), opacity: 1 },
      {
        offset: 0.82,
        transform: fr(
          from.cx + dx * 0.82,
          from.cy + dy * 0.82 - lift * 0.16,
          from.scale + (to.scale - from.scale) * 0.9,
          restRotation * 0.82 + bank * 0.3,
        ),
        opacity: 1,
      },
      { offset: 0.93, transform: fr(to.cx + ovx, to.cy + ovy - 1.5, to.scale * 1.012, restRotation * 0.93 + bank * 0.08), opacity: 1 },
      { offset: 1, transform: fr(to.cx, to.cy, to.scale, restRotation), opacity: endOpacity },
    ];
  }

  /** A FACE-UP clone of a card (its art) for a flight, so a card "shows up"
   *  face-up like the real one it becomes. Falls back to a cardback motion-ghost
   *  when the art can't be resolved (e.g. the synthetic test fixture). */
  function makeCardClone(card: CardView | null | undefined, faceUp: boolean, w: number, h: number): HTMLElement {
    const art = faceUp ? safeCardImageUrl(card?.imageUrl ?? card?.cardImage) : '';
    if (art) {
      const node = makeNode('motion-reveal', w, h);
      const img = document.createElement('img');
      img.src = art;
      img.alt = '';
      img.draggable = false;
      node.appendChild(img);
      return node;
    }
    return makeNode('motion-ghost', w, h);
  }

  function runDraw(intent: DrawIntent, overlay: DOMRect, budgetMs: number, reduced: boolean) {
    const owner = intent.ownerIndex;
    const deck = boxFor(`[data-testid="deck-pile-${owner}"]`, overlay);
    const handEl = document.querySelector(`[data-testid="hand-${owner}"]`);
    if (!deck || !handEl) {
      return;
    }
    const faceUpHand = !handEl.classList.contains('concealed');
    const count = Math.min(intent.count, 7);

    if (reduced) {
      // No flight, no clone (the two-representation problem reduced motion is
      // meant to avoid): un-suppress the real cards immediately and let their
      // reduced handEnter (a 150ms opacity fade) be the sole presence cue.
      for (let i = 0; i < count; i += 1) {
        cardMotionStore.releaseDrawHand(`hand-${owner}-${i}`);
      }
      return;
    }

    // The freshly-drawn cards are the LAST `count` in sorted DOM order (draws
    // append then the hand sorts) — the exact cards the store suppressed. Measure
    // their TRUE rendered rects so each clone flies to where the card actually is,
    // not a guessed X (the old targetX landed where the sorted card was NOT). The
    // face-up hand wraps cards in `.hand-card`; the concealed fan renders bare
    // CardTiles, so fall back to the per-card testids there.
    let handCardEls = Array.from(handEl.querySelectorAll('.hand-card'));
    if (handCardEls.length === 0) {
      handCardEls = Array.from(handEl.querySelectorAll('[data-testid^="hand-card-"]'));
    }
    const tail = handCardEls.slice(Math.max(0, handCardEls.length - count));

    // Each clone is sized to the deck pile (its source) and grows to the measured
    // hand-card size on landing — a believable deck→hand shrink-to-fit.
    const cardW = Math.max(40, deck.w);
    const cardH = Math.max(56, deck.h);

    // ONE BY ONE: a stagger so a multi-card draw fills sequentially, capped so the
    // last card's flight finishes inside the batch budget (lead + (count-1)*stagger
    // + duration < budgetMs) — a still-airborne clone must not be cancelled by the
    // next step. Stagger front-loaded so an N-card draw reads one-by-one but
    // finishes promptly instead of trickling to the budget edge.
    const duration = motionDuration(budgetMs, 0.4, 240, 720);
    const maxStagger = count > 1 ? Math.max(0, (budgetMs - 40 - duration) / (count - 1)) : 0;
    const stagger = Math.min(motionDuration(budgetMs, 0.055, 36, 90), maxStagger);

    // A card-sized fallback width when the sorted hand card isn't measurable yet —
    // derived from the rail height (a hand card is ~63:88), NEVER the rail width.
    const railBox = boxFor(`[data-testid="hand-${owner}"]`, overlay);
    const fallbackCardW = railBox
      ? clamp(railBox.h / (88 / 63), cardW * 0.8, cardW * 2.2)
      : cardW;

    for (let i = 0; i < count; i += 1) {
      const delay = i * stagger;
      const realCard = tail[i];
      const handKey = `hand-${owner}-${i}`;
      // Land on the real, already-rendered, SORTED hand-card rect when present;
      // otherwise fly to a CARD-SIZED box at the rail centre (never the rail width)
      // so a missing/late tail can never scale a clone to fill the screen.
      const dest = realCard
        ? boxOfEl(realCard, overlay)
        : railBox
          ? { ...railBox, w: fallbackCardW, h: fallbackCardW * (88 / 63) }
          : null;
      if (!dest) {
        cardMotionStore.releaseDrawHand(handKey);
        continue;
      }
      // FACE-UP clone of the drawn card with the glint/aura glimmer, so a card
      // "shows up" face-up and shimmering (the user's ask). The hand is no longer
      // sorted, so the trailing tail[i] IS intent.cards[i] — the face matches where
      // it lands. Falls back to a cardback when art is unresolved. The suppressed
      // real card (face-up hand) reveals on landing; the opponent's always-visible
      // fan gets a face-up clone that fades over it (endOpacity 0).
      const drawnCard = intent.cards?.[i] ?? null;
      const node = makeCardClone(drawnCard, true, cardW, cardH);
      decorateReveal(node, attackEffectKind(drawnCard?.cardType ?? drawnCard?.energyType), budgetMs, reduced);

      // Treasured draw-trail FX rides the flight, unchanged.
      runDrawTrail(deck, { cx: dest.cx, cy: dest.cy }, delay, duration);

      // ONE continuous object deck→the real card's rect; reveal the real hand card
      // the instant the clone lands (atomic, via track's onfinish). The concealed
      // top hand never hides, so its ghost fades out (endOpacity 0) over the
      // always-visible fan; the face-up hand's clone stays solid (endOpacity 1).
      const endScale = clamp(dest.w / cardW, 0.5, 3.0);
      const endOpacity = faceUpHand ? 1 : 0;
      const frames = weightedFlightCard(
        { cx: deck.cx, cy: deck.cy, scale: 0.92 },
        { cx: dest.cx, cy: dest.cy, scale: endScale },
        cardW,
        cardH,
        endOpacity,
        duration,
        delay,
      );
      frames[0] = { ...frames[0], opacity: 0 }; // fade in over the first sliver, no pop
      track(
        node.animate(frames, { duration, delay, easing: EASE_ARC, fill: 'backwards' }),
        node,
        () => cardMotionStore.releaseDrawHand(handKey),
      );
    }
  }

  /** Resolve the prize grid's 2x3 cell centres. Prefers the per-cell anchors
   *  (data-testid="prize-{owner}-{n}"); falls back to computing the cell centres
   *  from the grid box so the flight still lands sensibly if a cell isn't painted
   *  (e.g. the take case, where the claimed cell is already gone from the DOM). */
  function prizeCellBoxes(owner: number, overlay: DOMRect): Box[] {
    const grid = document.querySelector(`[data-testid="prize-stack-${owner}"] .prize-grid`);
    if (!grid) {
      return [];
    }
    const gridBox = localBox(grid.getBoundingClientRect(), overlay);
    const boxes: Box[] = [];
    for (let i = 0; i < 6; i += 1) {
      const cell = boxFor(`[data-testid="prize-card-${owner}-${i}"]`, overlay);
      if (cell) {
        boxes.push(cell);
        continue;
      }
      // Fallback: 2 columns x 3 rows laid out across the measured grid box.
      const col = i % 2;
      const row = Math.floor(i / 2);
      const cw = gridBox.w / 2;
      const ch = gridBox.h / 3;
      const x = gridBox.x + col * cw;
      const y = gridBox.y + row * ch;
      boxes.push({ x, y, w: cw, h: ch, cx: x + cw / 2, cy: y + ch / 2 });
    }
    return boxes;
  }

  function runPrize(intent: PrizeIntent, overlay: DOMRect, budgetMs: number, reduced: boolean) {
    const cells = prizeCellBoxes(intent.ownerIndex, overlay);
    const deck = boxFor(`[data-testid="deck-pile-${intent.ownerIndex}"]`, overlay);
    // Cell-sized cardback clones (the grid cells are smaller than deck/hand). On a
    // TAKE the claimed cells are already gone, so cells can be []; derive a sane
    // card size from the grid box (63:88 aspect) so the loop still runs and every
    // suppressed hand card gets released on landing.
    const gridBox = boxFor(`[data-testid="prize-stack-${intent.ownerIndex}"] .prize-grid`, overlay);
    const cellW = cells[0]?.w ?? (gridBox ? gridBox.w / 2 : 56);
    const cellH = cells[0]?.h ?? cellW * (88 / 63);
    const cardW = Math.max(28, cellW);
    const cardH = Math.max(40, cellH);
    const count = Math.min(intent.count, 6);

    if (intent.mode === 'setup') {
      // Setup needs the grid cells to deal ONTO; nothing to do if they aren't
      // painted. (TAKE does not need cells — it flies to the hand.)
      if (!deck || cells.length === 0) {
        return;
      }
      if (reduced) {
        // No flight — a single presence cue fading in over the grid.
        const node = makeNode('motion-ghost', cardW, cardH);
        const mid = cells[Math.min(count - 1, cells.length - 1)] ?? cells[0];
        node.style.transform = frame(mid.cx, mid.cy, cardW, cardH, 0.96);
        track(
          node.animate(
            [{ opacity: 0 }, { opacity: 0.85, offset: 0.5 }, { opacity: 0 }],
            { duration: motionDuration(budgetMs, 0.12, 160, 240), easing: EASE_OUT },
          ),
          node,
        );
        return;
      }
      // E's deal feel: each prize flies deck -> its grid cell on the weighted arc,
      // staggered, and STAYS (the painted cell already shows the cardback, so the
      // clone fades out exactly as it lands and the static cell reads as arrival).
      const stagger = motionDuration(budgetMs, count > 4 ? 0.034 : 0.046, 40, 70);
      const duration = motionDuration(budgetMs, 0.4, 240, 720);
      for (let i = 0; i < count && i < cells.length; i += 1) {
        const cell = cells[i];
        const node = makeNode('motion-ghost', cardW, cardH);
        const frames = weightedFlightCard(
          { cx: deck.cx, cy: deck.cy, scale: 1 },
          { cx: cell.cx, cy: cell.cy, scale: 1 },
          cardW,
          cardH,
          0,
          duration,
          i * stagger,
        );
        track(node.animate(frames, { duration, delay: i * stagger, easing: EASE_ARC, fill: 'backwards' }), node);
      }
      return;
    }

    // TAKE: a climactic beat — use the SAME one-continuous-card hand-off as a
    // draw. The claimed prize(s) lift from the grid and fly to the claiming
    // owner's real hand-card rect(s); the store suppressed those hand cards, so
    // the flight is their sole entrance and releaseDrawHand reveals each on
    // landing. The clone is a cardback ghost (prizes are facedown) that becomes
    // the now-face-up real hand card — consistent with the draw motion language.
    const owner = intent.ownerIndex;
    const handEl = document.querySelector(`[data-testid="hand-${owner}"]`);
    if (!handEl) {
      return;
    }
    if (reduced) {
      for (let i = 0; i < count; i += 1) {
        cardMotionStore.releaseDrawHand(`hand-${owner}-${i}`);
      }
      return;
    }
    // The concealed top hand never hides its cards (suppressedTail=0) and its
    // facedown fan is always visible, so a clone must FADE OUT at the rail centre
    // — never land solid on top of the already-visible fan (the BUG-3 double card).
    const concealed = handEl.classList.contains('concealed');
    const grid = gridBox ?? cells[0] ?? { x: 0, y: 0, w: cardW, h: cardH, cx: overlay.width / 2, cy: overlay.height / 2 };
    const origin = grid;
    const railBox = boxFor(`[data-testid="hand-${owner}"]`, overlay);
    // A card-sized destination width when the real sorted hand card isn't
    // measurable — derived from the rail height (a hand card is ~63:88), clamped
    // to a card range so the end scale stays near 1. NEVER the full rail width.
    const fallbackCardW = railBox
      ? clamp(railBox.h / (88 / 63), cardW * 0.8, cardW * 2.2)
      : cardW;
    // The claimed cards are the LAST `count` sorted hand cards (the store
    // suppressed exactly those) — measure their true rendered rects.
    const handCardEls = Array.from(handEl.querySelectorAll('.hand-card'));
    const tail = handCardEls.slice(Math.max(0, handCardEls.length - count));
    // A facedown cardback needs less air time than a hero reveal — keep it brisk
    // and front-load the stagger so a multi-card claim finishes inside ~half the
    // budget instead of trickling to the edge.
    const duration = motionDuration(budgetMs, 0.34, 220, 560);
    const maxStagger = count > 1 ? Math.max(0, (budgetMs - 40 - duration) / (count - 1)) : 0;
    const stagger = Math.min(motionDuration(budgetMs, 0.055, 36, 90), maxStagger);
    for (let i = 0; i < count; i += 1) {
      const delay = i * stagger;
      const realCard = tail[i];
      const handKey = `hand-${owner}-${i}`;
      // Land on the real sorted hand card when present; otherwise fly to a
      // CARD-SIZED box at the rail CENTRE (never the rail width) so the end scale
      // can never blow up to fill the screen.
      const dest = realCard
        ? boxOfEl(realCard, overlay)
        : railBox
          ? { ...railBox, w: fallbackCardW, h: fallbackCardW * (88 / 63) }
          : null;
      if (!dest) {
        cardMotionStore.releaseDrawHand(handKey);
        continue;
      }
      const node = makeNode('motion-ghost', cardW, cardH);
      // Defensive clamp: a mis-measured anchor can never scale a clone past 3x.
      const endScale = clamp(dest.w / cardW, 0.5, 3.0);
      // Concealed fan: the clone is a decorative ghost that dissolves (endOpacity 0)
      // over the always-visible fan. Face-up hand: the clone stays solid and the
      // suppressed real card reveals on landing (one continuous card).
      const endOpacity = concealed ? 0 : 1;
      const frames = weightedFlightCard(
        { cx: origin.cx, cy: origin.cy, scale: 1 },
        { cx: dest.cx, cy: dest.cy, scale: endScale },
        cardW,
        cardH,
        endOpacity,
        duration,
        delay,
      );
      frames[0] = { ...frames[0], opacity: 0 };
      track(
        node.animate(frames, { duration, delay, easing: EASE_ARC, fill: 'backwards' }),
        node,
        () => cardMotionStore.releaseDrawHand(handKey),
      );
    }
  }

  function runPlay(intent: PlayIntent, overlay: DOMRect, budgetMs: number, reduced: boolean) {
    const plane = document.querySelector('.game-board-plane');
    const center: Box = plane
      ? localBox(plane.getBoundingClientRect(), overlay)
      : { x: 0, y: 0, w: overlay.width, h: overlay.height, cx: overlay.width / 2, cy: overlay.height / 2 };
    // Measure the destination from the INNER `.slot-card` (the real card rect),
    // not the wrapper — the wrapper box includes overflowing badges / HP bubble
    // and the active slot's translateZ, so a clone centred on it settled a few
    // px / % off and snapped. Fall back to the wrapper only if the inner card
    // isn't painted yet (the slot card is suppressed but still laid out).
    // A real slot landing measures the INNER `.slot-card` (the true card rect) so
    // the clone lands EXACTLY on the card — the wrapper box includes overflowing
    // badges / HP bubble and the active slot's translateZ, which made the old clone
    // settle a few px / % off and snap. A trainer (discard-pile dest) has no inner
    // card; we keep the synthesized 63:88 box for the read-pose reveal there.
    const innerSlotEl = intent.destSelector?.startsWith('slot-')
      ? document.querySelector(`[data-testid="${intent.destSelector}"] .slot-card`)
      : null;
    const destEl = innerSlotEl ?? (intent.destSelector ? document.querySelector(`[data-testid="${intent.destSelector}"]`) : null);
    const dest = destEl ? boxOfEl(destEl, overlay) : null;
    // The opponent active's inner card is rotate(180deg); land the clone matching
    // that orientation so the reveal never visibly flips on landing.
    const destRotation = innerSlotEl && isRotated180(innerSlotEl) ? 180 : 0;
    const hand = boxFor(`[data-testid="hand-${intent.ownerIndex}"]`, overlay);

    // A play whose card lands in a slot is suppressed by the store; the clone's
    // onFinish (releaseDest) is the ONLY thing that reveals it. Compute the key up
    // front so EVERY early return below can hand the slot back instead of leaving
    // the real Pokemon hidden until the budget+220 safety timer.
    const releaseKey = intent.destSelector?.startsWith('slot-') ? intent.destSelector : null;

    // Guard against a zero-size measured anchor so heroScale can never blow up
    // to Infinity/NaN. When we measured a real inner slot card, use BOTH its
    // width and height (match the true card rect); otherwise synthesize a 63:88
    // box from width so a non-card-shaped pile box never distorts the reveal.
    const baseW = Math.max(1, dest ? dest.w : Math.min(124, overlay.width * 0.09));
    const baseH = innerSlotEl && dest ? Math.max(1, dest.h) : baseW * (88 / 63);
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
    // flashing a blank card or the literal word "Card". Release the suppressed
    // slot first so the real Pokemon is never stranded hidden.
    if (!art && !name) {
      if (releaseKey) {
        cardMotionStore.releaseDest(releaseKey);
      }
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

    // ONE continuous flight — no mid-screen hold, no chained phases. A snappier
    // envelope than the old two-phase (which froze ~230ms at centre): a single
    // weighted arc carries the card hand->slot or hand->discard. The arc already
    // scales UP mid-flight (midScale at offset 0.5) — that brief enlargement IS the
    // legibility beat, so no dead stop is needed.
    const total = motionDuration(budgetMs, 0.55, 320, 900);
    const origin: Box = hand ?? { x: 0, y: 0, w: baseW, h: baseH, cx: heroX, cy: overlay.height * 0.86 };

    // When the card lands in a real board slot, the clone stays solid all the way
    // down and the slot's hidden card is revealed the instant the clone is
    // removed — one continuous card, no pop. Reveals that fade at centre (no slot)
    // keep the fade-out. `releaseKey` (declared above) reveals the suppressed slot
    // on finish — also for the centre-fade fallback when the slot element wasn't
    // found at runtime, so a suppressed slot is never stranded.
    const landsInSlot = !!dest && !!releaseKey;
    const onFinish = releaseKey ? () => cardMotionStore.releaseDest(releaseKey) : undefined;

    // The clone is sized at `baseW` (slot width when there is a slot). A hand card
    // reads smaller than a slot, so launch at a hand-card scale and grow to 1 over
    // the flight ("scale from hand-card size to slot size"). Estimate the hand card
    // width from the hand rail, capped so a tiny/huge rail never distorts the start.
    const handCardW = hand ? clamp(hand.h / (88 / 63), baseW * 0.6, baseW * 1.1) : baseW * 0.92;
    const fromScale = clamp(handCardW / baseW, 0.55, 1);

    if (landsInSlot && dest) {
      // SLOT LANDING — one continuous card on E's weighted arc: lift scaled by
      // distance, banking toward velocity that levels out, a small spring
      // overshoot, then it STAYS (endOpacity 1) and releaseDest reveals the real
      // card as the clone is removed. The clone is measured against the inner
      // .slot-card box (baseW = dest.w, baseH = dest.h) so it lands EXACTLY on the
      // real card, and lands at destRotation (180 for the opponent active) so the
      // reveal never flips. Opacity fades in over the first sliver, no launch pop.
      const frames = weightedFlightCard(
        { cx: origin.cx, cy: origin.cy, scale: fromScale },
        { cx: dest.cx, cy: dest.cy, scale: 1 },
        baseW,
        baseH,
        1,
        total,
        0,
        destRotation,
      );
      frames[0] = { ...frames[0], opacity: 0 };
      track(node.animate(frames, { duration: total, easing: EASE_ARC, fill: 'backwards' }), node, onFinish);
      return;
    }

    // NO SLOT (trainers -> discard, or unresolved): ONE continuous weighted arc
    // hand -> discard, structurally identical to the slot landing but ending at the
    // discard pile and fading out — NO mid-screen read pose, NO dead stop, NO
    // chained phases (the source of the "two actions / stop for a second" feel).
    // The arc's mid-flight scale-up is the legibility beat. Glint/aura already ride
    // on the node from decorateReveal(); the contact shadow rides the arc.
    const discard = boxFor(`[data-testid="discard-pile-${intent.ownerIndex}"]`, overlay);
    if (discard) {
      // A trainer reads smaller in the discard than enlarged mid-flight; end near a
      // card size (clamped) so it tucks into the pile rather than shrinking to dust.
      const endScale = clamp(discard.w / baseW, 0.5, 1.0);
      const frames = weightedFlightCard(
        { cx: origin.cx, cy: origin.cy, scale: fromScale },
        { cx: discard.cx, cy: discard.cy, scale: endScale },
        baseW,
        baseH,
        0,
        total,
        0,
      );
      frames[0] = { ...frames[0], opacity: 0 };
      track(node.animate(frames, { duration: total, easing: EASE_ARC, fill: 'backwards' }), node, onFinish);
      return;
    }

    // No discard destination (unresolved card): a brief centre surface-and-fade in
    // ONE short animation — rise a touch, enlarge modestly for legibility, fade out.
    const surfaceScale = clamp(baseW * 1.4 / baseW, 1, heroScale);
    track(
      node.animate(
        [
          { offset: 0, transform: frame(origin.cx, origin.cy, baseW, baseH, fromScale), opacity: 0 },
          { offset: 0.28, transform: frame(heroX, heroY, baseW, baseH, surfaceScale), opacity: 1 },
          { offset: 0.72, transform: frame(heroX, heroY, baseW, baseH, surfaceScale), opacity: 1 },
          { offset: 1, transform: frame(heroX, heroY - 8, baseW, baseH, surfaceScale * 0.97), opacity: 0 },
        ],
        { duration: total, easing: EASE_OUT, fill: 'backwards' },
      ),
      node,
      onFinish,
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
        } else if (travel.kind === 'prize') {
          runPrize(travel, overlay, budgetMs, reduced);
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
  .motion-overlay :global(.motion-contact-shadow),
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

  /* Contact shadow ported from prototype E's .flyer-shadow — a soft, blurred dark
     ellipse on the ground plane beneath a flying clone. It grows as the card lifts
     and shrinks as it lands, selling the elevation underneath the FX. Sits below
     the clone (lower z-index) and is purely transform/opacity driven. */
  .motion-overlay :global(.motion-contact-shadow) {
    z-index: 1;
    border-radius: 50%;
    background: radial-gradient(ellipse, rgba(23, 30, 38, 0.34), rgba(23, 30, 38, 0) 70%);
    filter: blur(1px);
    opacity: 0;
  }

  .motion-overlay :global(.motion-ghost),
  .motion-overlay :global(.motion-reveal) {
    border-radius: 6px;
    /* sit above the contact shadow (z-index 1) that rides beneath the flight */
    z-index: 2;
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
