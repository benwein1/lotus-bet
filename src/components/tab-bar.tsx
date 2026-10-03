import { LinearGradient } from 'expo-linear-gradient';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Animated, { useAnimatedStyle, useSharedValue, withSpring } from '@/components/animated';
import { GroupsIcon, HomeIcon, ProfileIcon, type IconProps } from '@/components/icons';
import { Glass } from '@/components/screen';
import { selectionTap } from '@/components/ui';
import { useAttentionCount } from '@/lib/attention-store';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { TAB_BAR_HEIGHT } from '@/hooks/use-tab-bar-inset';
import { useColors } from '@/providers/theme-provider';
import { elevation, motion } from '@/theme';

/** The three destinations, in bar order. Route names, as the navigator has them. */
export type TabName = 'index' | 'groups' | 'profile';

export const TABS: {
  name: TabName;
  label: string;
  /** Where `router.navigate` has to go to reach it from outside the navigator. */
  href: '/' | '/groups' | '/profile';
  Icon: (props: IconProps) => React.ReactElement;
}[] = [
  { name: 'index', label: 'Feed', href: '/', Icon: HomeIcon },
  { name: 'groups', label: 'Groups', href: '/groups', Icon: GroupsIcon },
  { name: 'profile', label: 'You', href: '/profile', Icon: ProfileIcon },
];

/**
 * The floating pill, on its own.
 *
 * It is a component rather than part of the tabs layout because the approved
 * design keeps it on the pushed screens too — a bet and a group both draw it,
 * with the tab you came from still lit. That is the platform's own behaviour
 * (a pushed view controller keeps its tab bar) and it means the bar has two
 * callers, so it cannot live inside the navigator that happens to be one of
 * them.
 */
export function FloatingTabBar({
  active,
  onSelect,
}: {
  active: TabName;
  onSelect: (tab: (typeof TABS)[number]) => void;
}) {
  const insets = useSafeAreaInsets();
  const waiting = useAttentionCount();

  return (
    <View
      pointerEvents="box-none"
      style={{ paddingBottom: Math.max(insets.bottom, 14) }}
      className="absolute inset-x-0 bottom-0 items-center px-gutter"
    >
      {/* The fade belongs to the bar, not to the screen.
          It used to be a separate export that each screen mounted for itself,
          and only the two pushed screens ever did — so on the three tabs the
          last row of a list simply ended underneath the blur. Drawing it here
          means every screen that has the bar has the fade, and none of them
          has to remember. */}
      <TabBarScrim />

      <Glass
        intensity={Platform.OS === 'web' ? 24 : 60}
        style={[elevation.floating, { height: TAB_BAR_HEIGHT }]}
        className="flex-row items-center gap-1 rounded-full p-[7px]"
      >
        {TABS.map((tab) => (
          <TabButton
            key={tab.name}
            label={tab.label}
            Icon={tab.Icon}
            focused={tab.name === active}
            // Only the feed carries one, and only while you are elsewhere: a
            // badge on the tab you are looking at counts things already on
            // screen, which reads as the app talking to itself.
            badge={tab.name === 'index' && tab.name !== active ? waiting : 0}
            onPress={() => {
              if (tab.name === active) return;
              selectionTap();
              onSelect(tab);
            }}
          />
        ))}
      </Glass>
    </View>
  );
}

/**
 * The fade the two detail screens put behind the bar.
 *
 * Content scrolls under floating chrome rather than stopping short of it, and
 * without this the last line of a bet ends up half-legible behind the blur.
 * `rgba()` stops rather than an eight-digit hex, which does not reliably reach
 * zero and leaves a seam.
 */
function TabBarScrim() {
  const colors = useColors();

  return (
    <LinearGradient
      colors={['rgba(0,0,0,0)', colors.canvas]}
      locations={[0, 0.72]}
      pointerEvents="none"
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 110 }}
    />
  );
}

/**
 * Icon only — no caption. Three destinations whose glyphs are already
 * unambiguous do not need labels, and dropping them lets the bar shrink to
 * something closer to a control than a strip. The label survives as the
 * accessibility name, which is the only place it was doing real work.
 *
 * The selected tab is filled with the mark's own green-to-blue ramp rather
 * than with `accent-soft`. It is the one place the logo's colour appears in
 * the chrome, and it says "you are here" without spending the accent, which
 * every other control in the app needs to mean "press this".
 *
 * `markInk` rather than a scheme colour on the glyph: the ramp is the same
 * drawing in both schemes, so what reads on it does not follow the scheme
 * either — white would fail against the blue end in either one.
 */
function TabButton({
  label,
  Icon,
  focused,
  onPress,
  badge = 0,
}: {
  label: string;
  Icon: (props: IconProps) => React.ReactElement;
  focused: boolean;
  onPress: () => void;
  /** How many things are waiting behind this tab. 0 draws nothing. */
  badge?: number;
}) {
  const colors = useColors();
  const reduced = useReducedMotion();
  const press = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));

  return (
    <Animated.View style={animated}>
      <View
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        // react-native-web maps `accessibilityState` for most roles but does
        // not emit `aria-selected` for a plain View, so a screen reader on the
        // web could not tell which tab was current. The ARIA prop is
        // understood on all three platforms.
        aria-selected={focused}
        accessibilityLabel={
          badge > 0 ? `${label}, ${badge} waiting on you` : label
        }
        // Responder handlers rather than a Pressable: the highlight has to
        // land on touch-down, before the navigation on release.
        onStartShouldSetResponder={() => true}
        onResponderGrant={() => {
          press.value = reduced ? 1 : withSpring(0.9, motion.press);
        }}
        onResponderRelease={() => {
          press.value = withSpring(1, motion.press);
          onPress();
        }}
        onResponderTerminate={() => {
          press.value = withSpring(1, motion.press);
        }}
        className="h-[42px] w-[58px] items-center justify-center overflow-hidden rounded-full"
      >
        {focused && (
          <LinearGradient
            colors={[colors.markFrom, colors.markTo]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        )}
        {/* The glyph needs its own `zIndex`, and this is not belt-and-braces.
            On the web the gradient is an absolutely positioned div and the
            icon's svg is static content, and CSS paints positioned boxes above
            static ones whatever the DOM order — so the fill covered the glyph
            completely and the selected tab was a blank green pill. React
            Native paints in child order and never showed it. */}
        <View style={{ zIndex: 1 }}>
          <Icon
            size={24}
            active={focused}
            color={focused ? colors.markInk : colors.textSecondary}
          />
          {/* A dot, not a number. The count is already a sentence at the top
              of the feed; here it only has to say "there is something". A
              numeral at this size is a two-character label on a 24pt glyph,
              which is unreadable and makes the bar look like a dashboard.

              Positioned over the glyph's own box rather than the button's, so
              it sits on the icon at any tab width. `zIndex` for the same
              reason the glyph needs one — see the note above. */}
          {badge > 0 && (
            <View
              pointerEvents="none"
              // `brand`, not `accent`. Spring Mint is what this app paints
              // status and selection with — the live dot, the open badge — and
              // blue is what it paints actions with. "There is something
              // waiting behind this tab" is status; the tab itself is the
              // action, and it is already the thing you press.
              className="absolute -right-1 -top-0.5 h-2.5 w-2.5 rounded-full border border-chrome bg-brand"
            />
          )}
        </View>
      </View>
    </Animated.View>
  );
}
