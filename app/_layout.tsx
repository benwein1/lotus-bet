import {
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
  useFonts,
} from '@expo-google-fonts/space-grotesk';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DemoEntry } from '@/components/demo-entry';
import { ChevronLeftIcon } from '@/components/icons';
import { PressableScale } from '@/components/ui';
import { isDemoMode } from '@/lib/demo';
import { isSupabaseConfigured } from '@/lib/supabase';
import { AuthProvider, useAuth } from '@/providers/auth-provider';
import { colors } from '@/theme';

import '../global.css';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  // Space Grotesk carries every heading, number and label. Body copy stays on
  // the system face — it reads better small and keeps the app feeling native.
  const [fontsLoaded, fontError] = useFonts({
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
  });

  const onReady = useCallback(() => {
    // A missing font should never block the app — it falls back to system.
    if (fontsLoaded || fontError) void SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    onReady();
  }, [onReady]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.ink['950'] }}>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar style="light" />
          <RootNavigator />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator() {
  const { session, loading, needsProfileSetup } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  // Single redirect gate: signed out -> (auth), signed in without a name ->
  // profile setup, otherwise -> tabs.
  useEffect(() => {
    if (loading || (!isSupabaseConfigured && !isDemoMode())) return;

    // `segments` is a typed tuple under typedRoutes; compare it as plain strings.
    const path = segments as readonly string[];
    const inAuthGroup = path[0] === '(auth)';

    if (!session && !inAuthGroup) {
      router.replace('/(auth)/phone');
    } else if (session && needsProfileSetup && path[1] !== 'profile-setup') {
      router.replace('/(auth)/profile-setup');
    } else if (session && !needsProfileSetup && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [session, loading, needsProfileSetup, segments, router]);

  if (!isSupabaseConfigured && !session) return <SetupRequired />;
  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-ink-950">
        <ActivityIndicator color={colors.brass['400']} />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.ink['950'] },
        headerShadowVisible: false,
        headerTintColor: colors.ink['50'],
        headerTitleStyle: { fontFamily: 'SpaceGrotesk_600SemiBold', fontSize: 17 },
        headerBackButtonDisplayMode: 'minimal',
        headerLeft: undefined,
        contentStyle: { backgroundColor: colors.ink['950'] },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="group/create"
        options={{ title: 'New group', presentation: 'modal', animation: 'slide_from_bottom' }}
      />
      <Stack.Screen
        name="group/join"
        options={{ title: 'Join a group', presentation: 'modal', animation: 'slide_from_bottom' }}
      />
      <Stack.Screen name="group/[id]/index" options={{ title: '' }} />
      <Stack.Screen
        name="group/[id]/new-bet"
        options={{ title: 'New bet', presentation: 'modal', animation: 'slide_from_bottom' }}
      />
      <Stack.Screen name="group/[id]/settle" options={{ title: 'Settle up' }} />
      <Stack.Screen name="bet/[id]" options={{ title: '' }} />
    </Stack>
  );
}

/** Shown when EXPO_PUBLIC_SUPABASE_* are missing, instead of a cryptic crash. */
function SetupRequired() {
  return (
    <View className="flex-1 items-center justify-center gap-4 bg-ink-950 px-10">
      <View className="h-16 w-16 items-center justify-center rounded-3xl border border-ink-750 bg-ink-850">
        <Text className="text-3xl">🪷</Text>
      </View>
      <Text className="text-center font-display-bold text-xl text-ink-50">Almost there</Text>
      <Text className="text-center text-sm leading-6 text-ink-600">
        Copy <Text className="font-display text-brass-300">.env.example</Text> to{' '}
        <Text className="font-display text-brass-300">.env</Text>, fill in your Supabase URL and
        anon key, then restart the dev server.
      </Text>

      <View className="mt-4">
        <DemoEntry />
      </View>
    </View>
  );
}

/** Exported for screens that render their own back affordance. */
export function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <PressableScale
      onPress={onPress}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Go back"
      className="h-10 w-10 items-center justify-center rounded-full border border-ink-750 bg-ink-850"
    >
      <ChevronLeftIcon size={18} color={colors.ink['500']} />
    </PressableScale>
  );
}
