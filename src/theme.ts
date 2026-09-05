import palette from '../theme-colors.json';

export type ColorScheme = 'light' | 'dark';
export type Palette = typeof palette.light;

/**
 * The two palettes Tailwind is built from.
 *
 * Use `className` wherever possible — the semantic colour classes already
 * adapt to the scheme. Reach for these only where NativeWind cannot apply a
 * class: React Navigation options, `placeholderTextColor`, `RefreshControl`,
 * SVG, gradients, and animated styles. Prefer the `useColors()` hook so the
 * value follows the active scheme; `palette` itself is for module scope.
 */
export const palettes = palette;

export function colorsFor(scheme: ColorScheme): Palette {
  return palette[scheme];
}

/**
 * Motion, in Apple's two parameters rather than the physics triplet.
 *
 * `duration` here is Apple's *response* — roughly how long the value takes to
 * reach the target — and `dampingRatio` controls overshoot. 1.0 is critically
 * damped and settles without a bounce; anything below overshoots, which is
 * only right when the gesture itself carried momentum.
 */
export const motion = {
  /** Everything that follows a finger. Critically damped, quick. */
  press: { duration: 250, dampingRatio: 1 },
  /** Layout settling: sheets, bars, values that change under you. */
  settle: { duration: 400, dampingRatio: 1 },
  /** After a flick or a throw — the one place overshoot is earned. */
  momentum: { duration: 400, dampingRatio: 0.8 },
  /** A moment worth celebrating. Used once, on resolution. */
  celebrate: { duration: 500, dampingRatio: 0.62 },
  duration: {
    fast: 150,
    base: 250,
    slow: 400,
  },
  /** Stagger between items in an entering list. */
  stagger: 45,
} as const;

/**
 * Shadows. RN needs objects, not classes.
 *
 * Bigger surfaces read as thicker: a floating bar carries more blur and more
 * offset than a chip does. Shadows stay soft and low-opacity — a hard drop
 * shadow is the fastest way to make a light theme look like a 2014 dashboard.
 */
export const elevation = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  floating: {
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
    elevation: 14,
  },
  sheet: {
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: -8 },
    elevation: 18,
  },
} as const;

/**
 * Deterministic accent per person, so the same face is the same colour on
 * every screen. Two variants because a tint that reads on white disappears on
 * black, and vice versa.
 */
const AVATAR_HUES = [
  { light: { bg: '#E7EEFF', fg: '#2C5BD6' }, dark: { bg: '#152139', fg: '#8FB4FF' } },
  { light: { bg: '#E2F5F0', fg: '#137A64' }, dark: { bg: '#0E2A26', fg: '#5FD9C0' } },
  { light: { bg: '#FDECE2', fg: '#B75A1E' }, dark: { bg: '#2E1C11', fg: '#FFA96B' } },
  { light: { bg: '#E8F3E4', fg: '#3C7A2E' }, dark: { bg: '#152614', fg: '#7FD46A' } },
  { light: { bg: '#FCE8EE', fg: '#B93A5C' }, dark: { bg: '#2C141C', fg: '#FF9DBA' } },
  { light: { bg: '#EDE9FC', fg: '#5B45C4' }, dark: { bg: '#1D1730', fg: '#B9A6FF' } },
  { light: { bg: '#E4F1FA', fg: '#20698F' }, dark: { bg: '#0F2430', fg: '#78C7EE' } },
  { light: { bg: '#F6EDDC', fg: '#8A6516' }, dark: { bg: '#26200F', fg: '#E2C36B' } },
] as const;

export function avatarColors(seed: string, scheme: ColorScheme): { bg: string; fg: string } {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return AVATAR_HUES[hash % AVATAR_HUES.length]![scheme];
}

/**
 * Lining, fixed-width figures. Money is the most-read content in the app and
 * proportional digits visibly shift as a balance changes. Figures only, never
 * prose.
 */
export const tabular = { fontVariant: ['tabular-nums' as const] };
