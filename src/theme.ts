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

/** Which of the two sides an option is, when there are exactly two. */
export type OptionTone = 'a' | 'b';

/**
 * The colour of the nth option on a bet.
 *
 * Two options keep the convention the whole app is built on: side A green,
 * side B red, the same pair the ledger uses for money owed to you and money
 * you owe. That reading is worth more than consistency with the many-option
 * case, so it is not disturbed.
 *
 * Past two there is no "for" and "against" left to encode — an option is just
 * one of several — so the sequence walks a hue ramp instead. It starts on the
 * same green and ends on the same red, with blues and ambers between, so a
 * three-option bet still reads as "the first one" through "the last one"
 * rather than as an unrelated palette.
 *
 * `onMedia` picks the brighter variants, which are the same in both schemes
 * because a scrim is dark either way.
 */
export function optionColor(
  index: number,
  count: number,
  scheme: ColorScheme,
  onMedia = false
): string {
  if (count <= 2) {
    // Over media the two sides take their brighter variants, which are the
    // same in both schemes; otherwise they follow the active one. A literal
    // value, not `var(--c-…)`: this is handed to a plain style, and NativeWind
    // only resolves custom properties inside a className.
    const palette = onMedia ? palettes.dark : palettes[scheme];
    if (index === 0) return onMedia ? palette.sideAOnMedia : palette.sideA;
    return onMedia ? palette.sideBOnMedia : palette.sideB;
  }

  const ramp = onMedia || scheme === 'dark' ? OPTION_RAMP_ON_MEDIA : OPTION_RAMP;
  return ramp[index % ramp.length] ?? ramp[0]!;
}

/**
 * The same option's *fill* — what a square is tinted with once it is the side
 * you are on.
 *
 * At two options it is the palette's own soft pair, so a picked side reads in
 * exactly the tone the ledger uses for the same colour elsewhere. Past two
 * there is no token to reach for, so it is the option's own ramp colour at a
 * low alpha: a tint of itself, which is what `sideASoft` is to `sideA`.
 */
export function optionSoftColor(index: number, count: number, scheme: ColorScheme): string {
  if (count <= 2) {
    const palette = palettes[scheme];
    return index === 0 ? palette.sideASoft : palette.sideBSoft;
  }
  const hex = optionColor(index, count, scheme);
  return hexWithAlpha(hex, scheme === 'dark' ? 0.22 : 0.12);
}

/** `#RRGGBB` plus an alpha, as `rgba()`. Unknown input is returned unchanged. */
function hexWithAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;
  const value = parseInt(match[1]!, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Fixed values rather than palette tokens: these are chart colours, and a
// stacked bar needs neighbours that stay apart from each other in both
// schemes rather than each one adapting on its own.
const OPTION_RAMP = [
  '#187E42', // the same green side A uses
  '#0F7A8C',
  '#086CD0',
  '#6B4FD8',
  '#B0439B',
  '#C7262C', // and the same red side B uses
  '#B26A0B',
  '#5C6470',
] as const;

const OPTION_RAMP_ON_MEDIA = [
  '#3DDC84',
  '#3FD0E0',
  '#5AB0FF',
  '#A48CFF',
  '#F07BD4',
  '#FF7076',
  '#FFC24D',
  '#B9C2CE',
] as const;

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
