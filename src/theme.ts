import palette from '../theme-colors.json';

/**
 * The same palette Tailwind is built from.
 *
 * Use the `className` prop wherever possible; reach for these constants only
 * where NativeWind cannot apply a class — React Navigation options, and
 * animated styles on components NativeWind does not wrap (`Animated.View`).
 */
export const colors = palette;

export type Palette = typeof palette;
