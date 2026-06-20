<script lang="ts">
  import { onDestroy } from 'svelte';
  import { safeCardImageUrl } from '../game/cardImages';
  import { EASE_IN_OUT, EASE_OUT } from '../motion';
  import { cardMotionStore, type DrawIntent, type PlayIntent } from '../../state/cardMotion.svelte';

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
      track(node.animate([{ opacity: 0 }, { opacity: 0.85, offset: 0.5 }, { opacity: 0 }], { duration: 220, easing: EASE_OUT }), node);
      return;
    }

    const count = Math.min(intent.count, 4);
    const stagger = intent.count > 4 ? 35 : 45;
    const duration = Math.min(260, Math.max(180, Math.round(budgetMs * 0.4)));
    for (let i = 0; i < count; i += 1) {
      const t = count <= 1 ? 0.5 : i / (count - 1);
      const targetX = hand.x + hand.w * (0.2 + 0.6 * t);
      const tilt = -4 + 8 * t;
      const node = makeNode('motion-ghost', cardW, cardH);
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
      const hold = Math.min(budgetMs, 460);
      track(
        node.animate([{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: hold, easing: EASE_OUT }),
        node,
      );
      return;
    }

    const total = Math.min(budgetMs, 640);
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
    if (!batch || !overlayEl || batch.travels.length === 0) {
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
  .motion-overlay :global(.motion-reveal) {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: center;
    will-change: transform, opacity;
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
    box-shadow:
      0 24px 60px rgba(12, 15, 19, 0.42),
      0 0 0 1px rgba(255, 255, 255, 0.5);
  }

  .motion-overlay :global(.motion-reveal img) {
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
</style>
