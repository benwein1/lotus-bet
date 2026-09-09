import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** The floating pill itself. Screens add the safe-area inset on top of this. */
export const TAB_BAR_HEIGHT = 60;

/**
 * Bottom padding a scrolling screen needs so its last row clears the floating
 * tab bar. The bar is translucent and content passes under it, so this is
 * about the last item staying reachable, not about hiding anything.
 *
 * Lives outside `app/(tabs)/_layout.tsx` because route files should only
 * export their screen.
 */
export function useTabBarInset(): number {
  const insets = useSafeAreaInsets();
  return TAB_BAR_HEIGHT + Math.max(insets.bottom, 14) + 14;
}
