import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DemoEntry } from '@/components/demo-entry';
import { ChevronLeftIcon } from '@/components/icons';
import { Screen } from '@/components/screen';
import { PressableScale } from '@/components/ui';
import { isDemoMode } from '@/lib/demo';
import { isSupabaseConfigured } from '@/lib/supabase';
import { AuthProvider, useAuth } from '@/providers/auth-provider';
import { ThemeProvider, useColors, useScheme } from '@/providers/theme-provider';

import '../global.css';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  // No webfont to wait on: the app is set in the system face, which on iOS is
  // SF Pro. It already ships optical sizing, tracking tables and legibility
  // tuning that a downloaded face would throw away.
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <Chrome />
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Chrome() {
  const scheme = useScheme();
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <RootNavigator />
    </>
  );
}

function RootNavigator() {
  const { session, loading, needsProfileSetup } = useAuth();
  const colors = useColors();
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
      router.replace('/(auth)/sign-in');
    } else if (session && needsProfileSetup && path[1] !== 'profile-setup') {
      router.replace('/(auth)/profile-setup');
    } else if (session && !needsProfileSetup && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [session, loading, needsProfileSetup, segments, router]);

  if (!isSupabaseConfigured && !session) return <SetupRequired />;
  if (loading) {
    return (
      <Screen className="items-center justify-center">
        <ActivityIndicator color={colors.textTertiary} />
      </Screen>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.canvas },
        headerShadowVisible: false,
        headerTintColor: colors.accent,
        headerTitleStyle: { fontSize: 17, fontWeight: '600', color: colors.text },
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.canvas },
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
    <Screen className="items-center justify-center gap-4 px-10">
      <View className="h-16 w-16 items-center justify-center rounded-3xl bg-surface2">
        <Text className="text-2xl">🪷</Text>
      </View>
      <Text className="text-center text-xl font-bold text-primary">Almost there</Text>
      <Text className="text-center text-subhead leading-5 text-secondary">
        Copy <Text className="font-semibold text-accent">.env.example</Text> to{' '}
        <Text className="font-semibold text-accent">.env</Text>, fill in your Supabase URL and
        anon key, then restart the dev server.
      </Text>

      <View className="mt-4">
        <DemoEntry />
      </View>
    </Screen>
  );
}

/** Exported for screens that render their own back affordance. */
export function BackButton({ onPress }: { onPress: () => void }) {
  const colors = useColors();
  return (
    <PressableScale
      onPress={onPress}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Go back"
      className="h-10 w-10 items-center justify-center rounded-full bg-surface2"
    >
      <ChevronLeftIcon size={18} color={colors.text} />
    </PressableScale>
  );
}
