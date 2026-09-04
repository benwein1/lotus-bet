import { Tabs } from 'expo-router';
import { Text, type ColorValue } from 'react-native';
import { colors } from '@/theme';

/**
 * Three tabs, no more. Everything else (group detail, bet detail, settle up)
 * is pushed on top of them from the root stack.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.ink['950'] },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
        tabBarStyle: {
          backgroundColor: colors.ink['900'],
          borderTopColor: colors.ink['700'],
        },
        tabBarActiveTintColor: colors.lotus['400'],
        tabBarInactiveTintColor: colors.ink['600'],
        sceneStyle: { backgroundColor: colors.ink['950'] },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <TabGlyph glyph="🏠" color={color} />,
        }}
      />
      <Tabs.Screen
        name="groups"
        options={{
          title: 'Groups',
          tabBarIcon: ({ color }) => <TabGlyph glyph="👥" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <TabGlyph glyph="🪷" color={color} />,
        }}
      />
    </Tabs>
  );
}

// Emoji tab icons keep the MVP free of an icon-font dependency; swapping in
// SF Symbols later is a one-component change. Emoji ignore `color`, so the
// inactive tab is dimmed with opacity instead.
function TabGlyph({ glyph, color }: { glyph: string; color: ColorValue }) {
  const active = color === colors.lotus['400'];
  return <Text style={{ fontSize: 20, opacity: active ? 1 : 0.45 }}>{glyph}</Text>;
}
