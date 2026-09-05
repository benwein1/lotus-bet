import { Text, View } from 'react-native';

import { PressableScale } from '@/components/ui';
import { DEMO_AVAILABLE } from '@/lib/demo';
import { useAuth } from '@/providers/auth-provider';

/**
 * TEMPORARY: the way into offline demo mode.
 *
 * Renders nothing outside development, so it cannot reach a production build.
 * Delete this file along with `src/lib/demo.ts` when the backend is set up.
 */
export function DemoEntry({ className = '' }: { className?: string }) {
  const { enterDemo } = useAuth();

  if (!DEMO_AVAILABLE) return null;

  return (
    <PressableScale
      onPress={enterDemo}
      scaleTo={0.96}
      accessibilityRole="button"
      accessibilityLabel="Open the app with demo data, without signing in"
      className={`flex-row items-center justify-center gap-2 self-center rounded-full border border-dashed border-hairline-strong px-4 py-2.5 ${className}`}
    >
      <View className="h-1.5 w-1.5 rounded-full bg-accent" />
      <Text className="text-sm text-secondary">Skip sign-in, use demo data</Text>
    </PressableScale>
  );
}

/** A standing reminder that nothing on screen is real. */
export function DemoBadge() {
  const { demo } = useAuth();
  if (!demo) return null;

  return (
    <View className="flex-row items-center gap-1.5 self-start rounded-full bg-accent-soft px-2.5 py-1">
      <View className="h-1.5 w-1.5 rounded-full bg-accent" />
      <Text className="text-xs font-semibold text-accent">Demo data</Text>
    </View>
  );
}
