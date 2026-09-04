import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '@/providers/auth-provider';
import { isSupabaseConfigured } from '@/lib/supabase';
import { colors } from '@/theme';

import '../global.css';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
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
    if (loading || !isSupabaseConfigured) return;

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

  if (!isSupabaseConfigured) return <SetupRequired />;
  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-ink-950">
        <ActivityIndicator color={colors.lotus['500']} />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.ink['950'] },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: colors.ink['950'] },
      }}
    >
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="group/create" options={{ title: 'New group', presentation: 'modal' }} />
      <Stack.Screen name="group/join" options={{ title: 'Join a group', presentation: 'modal' }} />
      <Stack.Screen name="group/[id]/index" options={{ title: '' }} />
      <Stack.Screen name="group/[id]/new-bet" options={{ title: 'New bet', presentation: 'modal' }} />
      <Stack.Screen name="group/[id]/settle" options={{ title: 'Settle up' }} />
      <Stack.Screen name="bet/[id]" options={{ title: '' }} />
    </Stack>
  );
}

/** Shown when EXPO_PUBLIC_SUPABASE_* are missing, instead of a cryptic crash. */
function SetupRequired() {
  return (
    <View className="flex-1 items-center justify-center gap-3 bg-ink-950 px-8">
      <Text className="text-4xl">🪷</Text>
      <Text className="text-center text-lg font-bold text-white">Almost there</Text>
      <Text className="text-center text-sm leading-5 text-ink-600">
        Copy <Text className="text-lotus-400">.env.example</Text> to{' '}
        <Text className="text-lotus-400">.env</Text>, fill in your Supabase URL and anon key, then
        restart the dev server.
      </Text>
    </View>
  );
}
