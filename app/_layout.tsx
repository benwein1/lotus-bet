import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AnimatedSplash } from '@/components/animated-splash';
import { DemoEntry } from '@/components/demo-entry';
import { AppMark } from '@/components/app-mark';
import { ChevronLeftIcon } from '@/components/icons';
import { Screen } from '@/components/screen';
import { PressableScale } from '@/components/ui';
import { isDemoMode } from '@/lib/demo';
import { takePendingInvite } from '@/lib/invites';
import { isSupabaseConfigured } from '@/lib/supabase';
import { AuthProvider, useAuth } from '@/providers/auth-provider';
import { ThemeProvider, useColors, useScheme } from '@/providers/theme-provider';

import '../global.css';

void SplashScreen.preventAutoHideAsync();

/**
 * Whatever route the app opens on — a push notification straight to a bet, a
 * shared link to a group — the tabs are underneath it. Without this a deep
 * link lands on a stack of one and there is no way back out of it.
 */
export const unstable_settings = { initialRouteName: '(tabs)' };

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
      {/* Inside ThemeProvider, so the overlay's ground is the resolved scheme's
          canvas and matches the native splash it is taking over from. */}
      <AnimatedSplash>
        <RootNavigator />
      </AnimatedSplash>
    </>
  );
}

function RootNavigator() {
  const { session, loading, needsProfileSetup, recovering } = useAuth();
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
    // The terms and the privacy policy are linked from the sign-up screen, so
    // they have to be readable by somebody who does not have an account yet —
    // which is everybody the checkbox is asking. Without this exemption the
    // gate bounces them straight back to sign-in and the agreement links at
    // nothing, which is the state this whole file used to be in.
    const inLegalGroup = path[0] === 'legal';

    // A recovery session is a real session, so every branch below would happily
    // wave it through to the tabs — and the whole point of the link was to set
    // a password. Hold it on the reset screen until `updatePassword` clears the
    // flag. This has to come first for the same reason.
    if (recovering) {
      if (path[1] !== 'reset-password') router.replace('/(auth)/reset-password');
      return;
    }

    if (!session && !inAuthGroup && !inLegalGroup) {
      router.replace('/(auth)/sign-in');
    } else if (session && needsProfileSetup && path[1] !== 'profile-setup') {
      router.replace('/(auth)/profile-setup');
    } else if (session && !needsProfileSetup && inAuthGroup) {
      // Somebody who arrived on an invite link and had to make an account
      // first goes back to the link, not to an empty Groups tab. `take` clears
      // it, so a stale token can never redirect a later sign-in.
      void takePendingInvite().then((token) => {
        if (token) router.replace({ pathname: '/join/[token]', params: { token } });
        else router.replace('/(tabs)');
      });
    }
  }, [session, loading, needsProfileSetup, recovering, segments, router]);

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
      {/* No swipe-back out of auth: deep-linking while signed out leaves the
          tabs underneath, and the gate would only bounce you straight back. */}
      <Stack.Screen name="(auth)" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      {/* The three modals get an explicit Cancel. A sheet has no back chevron
          of its own on every platform, and dismissing by dragging is not
          discoverable — there is always a visible way out. */}
      <Stack.Screen name="group/create" options={modalOptions('New group')} />
      <Stack.Screen name="group/join" options={modalOptions('Join a group')} />
      <Stack.Screen name="challenge" options={modalOptions('Challenge someone')} />
      <Stack.Screen name="group/[id]/index" options={{ title: '' }} />
      {/* No header: it resolves and moves on, and a "Join a group" title on a
          screen that has already joined you is a caption for the wrong moment. */}
      <Stack.Screen name="join/[token]" options={{ headerShown: false }} />
      <Stack.Screen name="group/[id]/new-bet" options={modalOptions('New bet')} />
      <Stack.Screen name="group/[id]/settle" options={{ title: 'Settle up' }} />
      <Stack.Screen name="bet/[id]" options={{ title: '' }} />
      {/* Pushed rather than presented as a sheet: it is a decision with a lot
          to read, and a sheet invites dismissing it by reflex. */}
      <Stack.Screen name="delete-account" options={{ title: 'Delete account' }} />
      {/* Guideline 1.2 wants the rules and a contact published, and 5.1.1 wants
          the privacy policy reachable from inside the app. These render text
          bundled with the build, so they work before any domain exists and
          before there is a network. */}
      <Stack.Screen name="legal/terms" options={{ title: 'Terms of Service' }} />
      <Stack.Screen name="legal/privacy" options={{ title: 'Privacy Policy' }} />
      <Stack.Screen name="legal/support" options={{ title: 'Support' }} />
    </Stack>
  );
}

/**
 * A sheet, with an explicit way out.
 *
 * A modally presented screen on iOS shows no back chevron — the platform
 * expects you to swipe it down — and a swipe is not a thing you can see. Every
 * one of these is a form, so the escape hatch has to be visible or the screen
 * is a place you can get stuck.
 */
function modalOptions(title: string) {
  return {
    title,
    presentation: 'modal' as const,
    animation: 'slide_from_bottom' as const,
    headerLeft: () => <ModalCancel />,
  };
}

/**
 * The way out of a modal. Falls back to the tabs rather than calling `back()`
 * blind: opened from a deep link there may be nothing behind it.
 */
function ModalCancel() {
  const router = useRouter();
  return (
    <PressableScale
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Cancel"
      className="py-1 pl-2 pr-4"
    >
      <Text className="text-base text-accent">Cancel</Text>
    </PressableScale>
  );
}

/** Shown when EXPO_PUBLIC_SUPABASE_* are missing, instead of a cryptic crash. */
function SetupRequired() {
  return (
    <Screen className="items-center justify-center gap-4 px-10">
      <AppMark size={72} />
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
