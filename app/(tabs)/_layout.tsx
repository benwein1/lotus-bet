import { TopTabs } from 'expo-router/js-top-tabs';

import { FloatingTabBar, TABS, type TabName } from '@/components/tab-bar';
import { useColors } from '@/providers/theme-provider';

/**
 * Three tabs, no more. Everything else — group detail, bet detail, settle up —
 * is pushed on top of them from the root stack.
 *
 * The navigator is expo-router's *top* tabs rather than its bottom tabs, for
 * one reason: it is a pager, so a horizontal drag carries the screen with the
 * finger and can be caught mid-flight. Bottom tabs cut between screens with no
 * gesture at all. Its own tab bar is replaced with the floating pill below and
 * positioned at the bottom, which also puts the bar after the pager in paint
 * order so it sits above the content it floats over.
 *
 * The bar itself lives in `src/components/tab-bar.tsx`, because the pushed
 * screens draw it too — see `FloatingTabBar`.
 */
export default function TabsLayout() {
  const colors = useColors();

  return (
    <TopTabs
      tabBarPosition="bottom"
      tabBar={(props: TabBarProps) => (
        <FloatingTabBar
          active={(props.state.routes[props.state.index]?.name ?? 'index') as TabName}
          onSelect={(tab) => props.navigation.navigate(tab.name)}
        />
      )}
      screenOptions={{
        swipeEnabled: true,
        animationEnabled: true,
        sceneStyle: { backgroundColor: colors.canvas },
      }}
    >
      {TABS.map((tab) => (
        <TopTabs.Screen key={tab.name} name={tab.name} options={{ title: tab.label }} />
      ))}
    </TopTabs>
  );
}

/**
 * The slice of the navigator's tab-bar props this bar actually uses. Typed
 * structurally rather than imported: expo-router vendors react-navigation
 * inside its own build output, so there is no stable public package path to
 * import `MaterialTopTabBarProps` from.
 */
interface TabBarProps {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: { navigate: (name: string) => void };
}
