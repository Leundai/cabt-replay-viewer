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
