/**
 * The cover a bet gets when nobody attached a photo.
 *
 * ---------------------------------------------------------------------------
 * Generated, not shipped
 * ---------------------------------------------------------------------------
 * Six image files would be six assets in the bundle, six things to re-export
 * when the palette moves, and six pictures that are recognisably The Stock
 * Photos by the third scroll. These are built from the app's own tokens at
 * render time instead: a two-stop gradient and a large, faint lotus petal
 * drawn from the same path as the mark.
 *
 * That gives the feed variety for free, keeps every cover inside the brand,
 * and means a palette change carries automatically.
 *
 * ---------------------------------------------------------------------------
 * The choice is deterministic, and that matters
 * ---------------------------------------------------------------------------
 * `Math.random()` would give a bet a different face on every render — and the
 * feed re-renders on every like, refetch and realtime event, so a card would
 * visibly change colour while you looked at it. Hashing the bet id means a bet
 * has *its* cover, permanently, on every device.
 *
 * The hash is FNV-1a: a few lines, no dependency, and well spread over short
 * ASCII keys like a UUID — which is all that is asked of it here. Nothing
 * security-related depends on it.
 */

import type { Palette } from '@/theme';

/** How many distinct covers exist. Six is enough that a screenful rarely repeats. */
export const COVER_COUNT = 6;

export interface BetCover {
  /** Gradient stops, top-left to bottom-right. */
  colors: [string, string];
  /** Rotation of the decorative petal, in degrees. Keeps identical hues apart. */
  rotation: number;
  /** Which corner the petal sits in, so the composition is not always the same. */
  anchor: 'top-right' | 'bottom-left';
}

function hash(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    // The FNV prime, via shifts so it stays in 32-bit range without overflowing
    // into a float.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic index in `[0, COVER_COUNT)` for a bet. */
export function coverIndex(betId: string): number {
  return hash(betId) % COVER_COUNT;
}

/**
 * The six recipes, in tokens rather than hexes.
 *
 * Blue leads — it is the primary and these are the app's own face — with the
 * new brand green appearing in two of the six so the feed carries the
 * secondary colour without the ledger's green ever being implied. `surface2`
 * and `sunken` give two quieter covers, because six saturated gradients in a
 * row is a paint chart rather than a feed.
 */
const RECIPES: ReadonlyArray<(c: Palette) => BetCover> = [
  (c) => ({ colors: [c.accent, c.accentStrong], rotation: -18, anchor: 'top-right' }),
  (c) => ({ colors: [c.accentStrong, c.brand], rotation: 12, anchor: 'bottom-left' }),
  (c) => ({ colors: [c.brand, c.brandStrong], rotation: -32, anchor: 'top-right' }),
  (c) => ({ colors: [c.accent, c.surface3], rotation: 24, anchor: 'bottom-left' }),
  (c) => ({ colors: [c.surface2, c.accentSoft], rotation: -8, anchor: 'top-right' }),
  (c) => ({ colors: [c.sunken, c.accentStrong], rotation: 34, anchor: 'bottom-left' }),
];

export function betCover(betId: string, colors: Palette): BetCover {
  const recipe = RECIPES[coverIndex(betId)];
  // `noUncheckedIndexedAccess` is on, and the modulo above cannot go out of
  // range — but the compiler does not know that, and the fallback costs
  // nothing.
  return (recipe ?? RECIPES[0]!)(colors);
}

/**
 * One petal from `assets/logo/mark.svg`, for the decorative shape.
 *
 * Copied rather than imported because this draws it at a size and opacity the
 * mark never uses, and `AnimatedMark` owns the animated copy. All three trace
 * back to the same source file.
 */
export const COVER_PETAL =
  'M256 366 C 206 292, 200 208, 256 122 C 312 208, 306 292, 256 366 Z';
