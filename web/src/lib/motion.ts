import { backOut, cubicOut } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';

/**
 * Shared motion primitives for the viewer, tuned to Emil Kowalski's rules:
 *  - entering/exiting uses ease-out (cubicOut), under 320ms;
 *  - nothing animates from scale(0) — entrances start from a visible scale;
 *  - "pops" use a gentle overshoot (backOut) to draw the eye to a change;
 *  - reduced-motion keeps opacity (comprehension) but drops movement.
 *
 * `pop` drives a `--motion-scale` custom property rather than `transform`
 * directly, so it composes with elements that are already positioned with
 * a transform (e.g. the damage counter's translate(-50%, -50%)).
 */

/** Strong custom easing curves shared by CSS transitions, Svelte transitions,
 *  and the WAAPI cinematics. Built-in CSS easings are too weak (Emil's rule),
 *  so these mirror the `--ease-*` custom properties in tokens.css. */
export const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
export const EASE_IN_OUT = 'cubic-bezier(0.77, 0, 0.175, 1)';
/** E's EASE_SETTLE — ease-out with follow-through (the settle / recoil curve). */
export const EASE_SETTLE = 'cubic-bezier(0.23, 1, 0.32, 1)';
/** E's EASE_ARC — the arcing in-out a cross-zone weighted flight rides. Driven at
 *  the WAAPI `animate()` level (one timing function for the whole flight) so the
 *  velocity stays continuous — no per-segment ease-out discontinuity. */
export const EASE_ARC = 'cubic-bezier(0.62, 0.01, 0.2, 1)';
/** E's EASE_ANTICIP — anticipation dip / spring. Used ONLY for the attack wind-up
 *  pull-back, never for in-app card flights (the user retracted the launch dip). */
export const EASE_ANTICIP = 'cubic-bezier(0.55, -0.2, 0.4, 1.15)';

// Cache the MediaQueryList (its `.matches` stays live) so we don't re-parse the
// query string on every call — prefersReducedMotion runs on the playback path.
let reducedMotionQuery: MediaQueryList | null | undefined;

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  reducedMotionQuery ??= window.matchMedia('(prefers-reduced-motion: reduce)');
  return reducedMotionQuery.matches;
}

type CardSwapOptions = { duration?: number; baseScale?: number; lift?: number };

/** A card arriving in / leaving a board slot. Starts at a visible scale,
 *  never from nothing, so it reads as a real object settling into place. */
export function cardSwap(
  _node: Element,
  { duration = 220, baseScale = 0.9, lift = 5 }: CardSwapOptions = {},
): TransitionConfig {
  if (prefersReducedMotion()) {
    return { duration: 140, css: (t) => `opacity: ${t}` };
  }
  return {
    duration,
    easing: cubicOut,
    css: (t, u) =>
      `opacity: ${t}; transform: translateY(${u * lift}px) scale(${baseScale + (1 - baseScale) * t});`,
  };
}

type PopOptions = { duration?: number; from?: number };

/** A landing pop with a soft overshoot — damage counters, attached energy.
 *  Emits `--motion-scale`; the target applies `scale(var(--motion-scale, 1))`
 *  inside its own transform so existing positioning is preserved. */
export function pop(
  _node: Element,
  { duration = 260, from = 0.5 }: PopOptions = {},
): TransitionConfig {
  if (prefersReducedMotion()) {
    return { duration: 120, css: (t) => `opacity: ${t}` };
  }
  return {
    duration,
    easing: backOut,
    // opacity reaches full faster than scale so the overshoot stays visible.
    css: (t) => `opacity: ${Math.min(1, t * 1.6)}; --motion-scale: ${from + (1 - from) * t};`,
  };
}

/**
 * cubic-bezier(x1,y1,x2,y2) as a JS easing function (Newton–Raphson, the same
 * math the browser uses for CSS), so Svelte transitions/animations match the
 * exact bezier curves the WAAPI cinematics use. Lets us mirror prototype E's
 * easings precisely instead of approximating with a built-in.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  const solveX = (x: number) => {
    let t = x;
    for (let i = 0; i < 6; i += 1) {
      const dx = sampleX(t) - x;
      if (Math.abs(dx) < 1e-4) return t;
      const d = slopeX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= dx / d;
    }
    return t;
  };
  return (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : sampleY(solveX(x)));
}

/** E's EASE_SETTLE — ease-out with follow-through. The hand-reflow / settle curve. */
export const easeSettle = cubicBezier(0.23, 1, 0.32, 1);
/** E's EASE_ARC — the arcing in-out used by cross-zone weighted flights. */
export const easeArc = cubicBezier(0.62, 0.01, 0.2, 1);

/** Playback-speed → duration divisor (E's dur(ms) = ms / speedMultiplier):
 *  higher speed ⇒ shorter animation. */
function speedMultiplier(speedId: string): number {
  switch (speedId) {
    case 'slow':
      return 0.5;
    case 'fast':
      return 2;
    case 'turbo':
      return 4;
    default:
      return 1;
  }
}

/**
 * E's in-layout FLIP reflow duration (hand gravity / sort) — the calm weighted
 * *slide* profile. When an active motion `budgetMs` is supplied (a draw step in
 * flight), the reflow is a FRACTION of that same budget the overlay plans the
 * draw flight against, so the hand visibly *expands with weight as the card
 * arrives* rather than pre-filling on its own clock (E's reflow:280 / flight:470
 * ratio ≈ 0.22 of the flight). Falls back to the speed-scaled base otherwise.
 * Instant under reduced motion. Paired with `easeSettle`.
 */
export function flipReflowMs(speedId: string, budgetMs?: number): number {
  if (prefersReducedMotion()) {
    return 0;
  }
  if (typeof budgetMs === 'number' && budgetMs > 0) {
    // ~0.22 of the budget, floored near the original heft, capped so a long
    // budget never makes the slide drag.
    return Math.round(Math.min(420, Math.max(220, budgetMs * 0.22)));
  }
  // 320ms base (a touch weightier than 280) so the hand visibly *expands* with
  // some heft as cards arrive, rather than snapping.
  return Math.max(40, Math.round(320 / speedMultiplier(speedId)));
}

/** A drawn/added hand card's entrance — a smooth EASED fade with a small rise
 *  (no scale pop), so the card settles in cleanly rather than popping. Drawn
 *  cards are suppressed in Hand and skip this entirely (the deck→hand flight is
 *  their sole entrance, like E); this only governs non-drawn adds. When an active
 *  draw `budgetMs` is supplied it shares the same clock as the flight + reflow. */
export function handEnter(
  _node: Element,
  { speedId = 'normal', budgetMs, skip = false }: { speedId?: string; budgetMs?: number; skip?: boolean } = {},
): TransitionConfig {
  // A drawn card hands off to its deck→hand flight (it is rendered visibility:hidden
  // until the clone lands), so it must NOT also run an opacity/translate entrance —
  // that would be the "two representations" tell. A zero-duration no-op leaves the
  // card untouched; the overlay's releaseDrawHand reveals it.
  if (skip) {
    return { duration: 0, css: () => '' };
  }
  if (prefersReducedMotion()) {
    return { duration: 150, css: (t) => `opacity: ${t}` };
  }
  const duration =
    typeof budgetMs === 'number' && budgetMs > 0
      ? Math.round(Math.min(420, Math.max(220, budgetMs * 0.22)))
      : Math.max(40, Math.round(320 / speedMultiplier(speedId)));
  return {
    duration,
    easing: easeSettle,
    css: (t, u) => `opacity: ${t}; transform: translateY(${u * 6}px);`,
  };
}

type LabelSwapOptions = { duration?: number; y?: number; blur?: number };

/** Swap of an in-place text label. Blur bridges the two strings so the eye
 *  reads one morph instead of two overlapping captions. */
export function labelSwap(
  _node: Element,
  { duration = 220, y = 5, blur = 4 }: LabelSwapOptions = {},
): TransitionConfig {
  if (prefersReducedMotion()) {
    return { duration: 150, css: (t) => `opacity: ${t}` };
  }
  return {
    duration,
    easing: cubicOut,
    css: (t, u) => `opacity: ${t}; transform: translateY(${u * y}px); filter: blur(${u * blur}px);`,
  };
}
