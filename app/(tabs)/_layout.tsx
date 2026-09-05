import { Tabs } from 'expo-router';
import { Platform, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from '@/components/animated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GroupsIcon, HomeIcon, ProfileIcon, type IconProps } from '@/components/icons';
import { Glass } from '@/components/screen';
import { selectionTap } from '@/components/ui';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { TAB_BAR_HEIGHT } from '@/hooks/use-tab-bar-inset';
import { useColors } from '@/providers/theme-provider';
import { elevation, motion } from '@/theme';

/**
 * Three tabs, no more. Everything else — group detail, bet detail, settle up —
 * is pushed on top of them from the root stack.
 *
 * The bar floats: a rounded, translucent pill sitting above the home indicator
 * with content scrolling underneath it, rather than an opaque strip that eats
 * the bottom of every screen. Screens leave room for it with `useTabBarInset`.
 */
const TABS: {
  name: string;
  label: string;
  Icon: (props: IconProps) => React.ReactElement;
}[] = [
  { name: 'index', label: 'Feed', Icon: HomeIcon },
  { name: 'groups', label: 'Groups', Icon: GroupsIcon },
  { name: 'profile', label: 'You', Icon: ProfileIcon },
];

export default function TabsLayout() {
  const colors = useColors();

  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.canvas },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.label }} />
      ))}
    </Tabs>
  );
}

/**
 * The slice of the navigator's tab-bar props this bar actually uses. Typed
 * structurally rather than imported: expo-router vendors react-navigation's
 * bottom tabs inside its own build output, so there is no stable public
 * package path to import `BottomTabBarProps` from.
 */
interface TabBarProps {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: { navigate: (name: string) => void };
}

function FloatingTabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      pointerEvents="box-none"
      style={{ paddingBottom: Math.max(insets.bottom, 14) }}
      className="absolute inset-x-0 bottom-0 items-center px-gutter"
    >
      <Glass
        intensity={Platform.OS === 'web' ? 24 : 60}
        style={[elevation.floating, { height: TAB_BAR_HEIGHT }]}
        className="flex-row items-center rounded-full px-2"
      >
        {state.routes.map((route, index) => {
          const tab = TABS.find((t) => t.name === route.name);
          if (!tab) return null;

          return (
            <TabButton
              key={route.key}
              label={tab.label}
              Icon={tab.Icon}
              focused={state.index === index}
              onPress={() => {
                if (state.index === index) return;
                selectionTap();
                navigation.navigate(route.name);
              }}
            />
          );
        })}
      </Glass>
    </View>
  );
}

function TabButton({
  label,
  Icon,
  focused,
  onPress,
}: {
  label: string;
  Icon: (props: IconProps) => React.ReactElement;
  focused: boolean;
  onPress: () => void;
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
        accessibilityLabel={label}
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
        className={`h-11 min-w-[84px] flex-row items-center justify-center gap-1.5 rounded-full px-4 ${
          focused ? 'bg-accent-soft' : ''
        }`}
      >
        <Icon
          size={21}
          active={focused}
          color={focused ? colors.accent : colors.textSecondary}
        />
        <Text
          className={`text-sm ${focused ? 'font-semibold text-accent' : 'text-secondary'}`}
        >
          {label}
        </Text>
      </View>
    </Animated.View>
  );
}
