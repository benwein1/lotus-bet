import { Tabs } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Platform, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from '@/components/animated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GroupsIcon, HomeIcon, ProfileIcon, type IconProps } from '@/components/icons';
import { colors, motion } from '@/theme';

/**
 * Three tabs, no more. Everything else (group detail, bet detail, settle up)
 * is pushed on top of them from the root stack.
 *
 * The bar is hand-built rather than the default: it gives us a floating
 * surface, a soft-lit active pill, real icons, and a press animation. The
 * default bar is the single most recognisable "unstyled RN app" tell.
 */
const TABS: {
  name: string;
  label: string;
  Icon: (props: IconProps) => React.ReactElement;
}[] = [
  { name: 'index', label: 'Home', Icon: HomeIcon },
  { name: 'groups', label: 'Groups', Icon: GroupsIcon },
  { name: 'profile', label: 'Profile', Icon: ProfileIcon },
];

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.ink['950'] },
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
      style={{ paddingBottom: Math.max(insets.bottom, 12) }}
      className="border-t border-ink-850 bg-ink-1000/95 px-4 pt-2"
    >
      <View className="flex-row items-center justify-around">
        {state.routes.map((route, index) => {
          const tab = TABS.find((t) => t.name === route.name);
          if (!tab) return null;

          const focused = state.index === index;

          return (
            <TabButton
              key={route.key}
              label={tab.label}
              Icon={tab.Icon}
              focused={focused}
              onPress={() => {
                if (!focused) {
                  if (Platform.OS !== 'web') {
                    void Haptics.selectionAsync();
                  }
                  navigation.navigate(route.name);
                }
              }}
            />
          );
        })}
      </View>
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
  const press = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));

  return (
    <Animated.View style={animated} className="flex-1">
      <View
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={label}
        onStartShouldSetResponder={() => true}
        onResponderGrant={() => {
          press.value = withSpring(0.9, motion.press);
        }}
        onResponderRelease={() => {
          press.value = withSpring(1, motion.press);
          onPress();
        }}
        onResponderTerminate={() => {
          press.value = withSpring(1, motion.press);
        }}
        className="items-center gap-1 py-1.5"
      >
        {/* The lit pill behind the active icon does the work a colour change
            alone cannot — it reads instantly in peripheral vision. */}
        <View
          className={`h-8 w-14 items-center justify-center rounded-full ${
            focused ? 'bg-lotus-900' : 'bg-transparent'
          }`}
        >
          <Icon
            size={21}
            active={focused}
            color={focused ? colors.lotus['300'] : colors.ink['600']}
          />
        </View>
        <Text
          className={`text-2xs tracking-normal ${
            focused ? 'font-display text-lotus-300' : 'text-ink-600'
          }`}
        >
          {label}
        </Text>
      </View>
    </Animated.View>
  );
}
