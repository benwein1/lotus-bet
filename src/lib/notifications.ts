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
 * Ask the server to tell the people who should hear about something.
 *
 * Every call here is best-effort and deliberately swallows its failure. Push
 * needs a deployed Edge Function and Expo's API; the user's action — posting
 * a bet, joining a group, calling a result — has already succeeded by the time
 * this runs, and must not be reported as failed because a notification did
 * not go out. When the function is not deployed this is simply a no-op.
 */
async function announce(kind: string, payload: Record<string, unknown>): Promise<void> {
  if (isDemoMode()) return;
  try {
    await supabase.functions.invoke('notify', { body: { kind, ...payload } });
  } catch (err) {
    console.warn(`Could not send the "${kind}" notification`, err);
  }
}

/** A new bet is up in a group you are in. */
export async function announceNewBet(betId: string): Promise<void> {
  return announce('bet_created', { betId });
}

/** Somebody joined a group you are in. */
export async function announceGroupJoin(groupId: string): Promise<void> {
  return announce('member_joined', { groupId });
}

/** A bet you took a side on has been called. */
export async function announceBetResolved(betId: string): Promise<void> {
  return announce('bet_resolved', { betId });
}
