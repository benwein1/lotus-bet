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

/**
 * The ground a bet with no photo gets in the Profile grid.
 *
 * Six teals, all sampled off the app's own mark ramp. The ramp runs green
 * (`markFrom`) to blue (`markTo`), so every colour between the two ends *is*
 * a teal — the family was already in the brand and did not need inventing.
 * Each tile takes a different pair of positions along it, so a grid of
 * text-only bets reads as a set rather than as one colour repeated.
 *
 * Every pair sits in the middle stretch of the ramp, roughly 0.3 to 0.75.
 * Reaching either end gives a tile that is plainly the logo's green or the
 * logo's blue, and a grid with one of each in it is not a family — it is the
 * gradient, pulled apart.
 *
 * It replaces a flat `surface2` box, which was the same grey as the page and
 * made a bet without a picture look like a tile that had failed to load.
 *
 * Deterministic on the bet id for the same reason `betCover` is: the grid
 * re-renders on every refetch, and a tile that changed colour while you looked
 * at it would be worse than a grey one.
 */
export function tileCover(betId: string, colors: Palette): { colors: [string, string] } {
  const stops = TILE_STOPS[hash(`${betId}tile`) % TILE_STOPS.length] ?? TILE_STOPS[0]!;
  return {
    colors: [rampAt(colors, stops[0]), rampAt(colors, stops[1])],
  };
}

/**
 * Where along the ramp each tile's two stops sit, 0 = `markFrom`, 1 = `markTo`.
 *
 * None of them span the whole ramp: a 0→1 gradient is the logo, and a grid of
 * six logos is not a background. Each pair covers a short stretch, so a tile
 * is recognisably one colour with depth rather than a rainbow.
 */
const TILE_STOPS: ReadonlyArray<readonly [number, number]> = [
  [0.3, 0.5],
  [0.45, 0.66],
  [0.36, 0.58],
  [0.52, 0.74],
  [0.32, 0.55],
  [0.48, 0.7],
];

/** One point on the mark's green-to-blue ramp, as `#rrggbb`. */
function rampAt(colors: Palette, t: number): string {
  const from = rgb(colors.markFrom);
  const to = rgb(colors.markTo);
  if (!from || !to) return colors.markFrom;

  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  const channel = (value: number) => value.toString(16).padStart(2, '0');
  return `#${channel(mix(from[0], to[0]))}${channel(mix(from[1], to[1]))}${channel(
    mix(from[2], to[2])
  )}`;
}

function rgb(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return null;
  const value = parseInt(match[1]!, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
