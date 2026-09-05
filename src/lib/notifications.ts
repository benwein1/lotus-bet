import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { isDemoMode } from './demo';
import { supabase } from './supabase';

// Show a banner even when the app is in the foreground — a bet resolving is
// worth interrupting for.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Ask for permission, get an Expo push token and store it on the user row so
 * the Edge Functions can reach this device.
 *
 * Returns null (quietly) on simulators, on web, or when the user says no —
 * push is a nice-to-have, never a blocker.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === 'web' || !Device.isDevice || isDemoMode()) return null;

  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Bets',
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#7C5CFF',
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;

    if (status !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      status = requested.status;
    }
    if (status !== 'granted') return null;

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
    if (!projectId) {
      console.warn('No EAS project id — skipping push token registration.');
      return null;
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await supabase.rpc('set_push_token', { p_token: token });

    return token;
  } catch (err) {
    console.warn('Push registration failed', err);
    return null;
  }
}

/** Called from the settings toggles when a user turns all notifications off. */
export async function clearPushToken(): Promise<void> {
  if (isDemoMode()) return;
  await supabase.rpc('set_push_token', { p_token: '' });
}

/**
 * Ask the server to announce a freshly created bet to the rest of the group.
 * Best-effort: a failed announcement must not fail bet creation.
 */
export async function announceNewBet(betId: string): Promise<void> {
  if (isDemoMode()) return;
  try {
    await supabase.functions.invoke('notify-new-bet', { body: { betId } });
  } catch (err) {
    console.warn('Could not announce new bet', err);
  }
}
