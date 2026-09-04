import palette from '../theme-colors.json';

/**
 * The same palette Tailwind is built from.
 *
 * Use the `className` prop wherever possible; reach for these constants only
 * where NativeWind cannot apply a class — React Navigation options,
 * `placeholderTextColor`, `RefreshControl`, `Switch`, gradients, SVG, and
 * animated styles on components NativeWind does not wrap (`Animated.View`).
 */
export const colors = palette;

export type Palette = typeof palette;

/**
 * Motion tokens. Every animation in the app pulls its timing from here, so
 * the whole product moves with one personality: quick, springy, never bouncy
 * enough to feel like a toy.
 */
export const motion = {
  /** Snappy spring for anything that follows a finger. */
  press: { damping: 18, stiffness: 320, mass: 0.6 },
  /** Settling spring for layout and width changes (odds bars, sheets). */
  settle: { damping: 20, stiffness: 160, mass: 0.9 },
  /** A little overshoot, reserved for moments worth celebrating. */
  celebrate: { damping: 11, stiffness: 180, mass: 0.8 },
  duration: {
    fast: 140,
    base: 240,
    slow: 420,
  },
  /** Stagger between items in an entering list. */
  stagger: 45,
} as const;

/** Shadow presets. RN needs these as objects, not classes. */
export const elevation = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  raised: {
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 14 },
    elevation: 12,
  },
  glow: (color: string) => ({
    shadowColor: color,
    shadowOpacity: 0.45,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  }),
} as const;

/**
 * Deterministic accent per user, so the same person is the same colour
 * everywhere — avatars, rosters, settle-up rows. Identity you can scan.
 */
const AVATAR_HUES = [
  { bg: '#2B1F4E', fg: '#C9B4FF' },
  { bg: '#12333A', fg: '#66E0D2' },
  { bg: '#3A2416', fg: '#FFA96B' },
  { bg: '#123324', fg: '#5BE894' },
  { bg: '#3A1822', fg: '#FF9DAE' },
  { bg: '#1E2A4D', fg: '#8FB4FF' },
  { bg: '#341E3F', fg: '#E39BFF' },
  { bg: '#2E2A14', fg: '#F0D169' },
] as const;

export function avatarColors(seed: string): { bg: string; fg: string } {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return AVATAR_HUES[hash % AVATAR_HUES.length]!;
}
