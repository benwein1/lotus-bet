/**
 * The device half of invite links: where the app is deployed, opening the
 * share sheet, and remembering an invite across a sign-in.
 *
 * The pure half — building the URL, writing the message, phrasing the expiry —
 * is in `invite-links.ts`, which is what the tests hold. Same split as
 * `reminders.ts` / `reminder-rules.ts`, for the same reason: everything worth
 * asserting about a link is a string transformation, and none of it should
 * need a simulator to check.
 */
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, Share } from 'react-native';

import { inviteShareText, type LinkTargets } from './invite-links';

export { INVITE_PATH, inviteExpiry, inviteMessage, inviteUrl } from './invite-links';

/** The app's own URL scheme, kept in step with `app.json`. */
const SCHEME = (Constants.expoConfig?.scheme as string | undefined) ?? 'betta';

/**
 * Where the web build lives.
 *
 * On the web the browser already knows, and reading it there means a preview
 * deployment shares preview links rather than production ones. On a device
 * there is nothing to read, so it has to be configured — and when it is not,
 * `inviteUrl` falls back to the `betta://` scheme rather than inventing a
 * domain that would 404 for whoever you sent it to.
 */
export function linkTargets(): LinkTargets {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return { webOrigin: window.location.origin, scheme: SCHEME };
  }
  const configured = process.env.EXPO_PUBLIC_WEB_ORIGIN?.trim();
  return { webOrigin: configured ? configured : null, scheme: SCHEME };
}

/**
 * Where Supabase should send somebody after they click a password-reset link.
 *
 * Reuses `linkTargets` on purpose: a reset link has exactly the same problem an
 * invite link does — it has to open something that exists, on whichever
 * platform the person is on. On the web that is this origin; on a device it is
 * the app's own scheme, which works here where it does not work for invites
 * because the person clicking a reset link *already has the app*.
 */
export function passwordResetRedirectTo(): string {
  const { webOrigin, scheme } = linkTargets();
  return webOrigin ? `${webOrigin}/reset-password` : `${scheme}://reset-password`;
}

export interface ShareResult {
  /** False when the user backed out of the sheet without picking anything. */
  shared: boolean;
}

/**
 * Hands the link to the OS share sheet.
 *
 * Deliberately *not* a WhatsApp button. Every messaging app the person already
 * uses is in that sheet, along with Messages, Mail, AirDrop and the clipboard —
 * and which one a group actually lives in is not something this app gets to
 * guess. A hardcoded `whatsapp://` link is also a dead end on any phone
 * without it installed, with no way to find that out beforehand.
 *
 * iOS takes `message` and `url` separately and renders the link preview
 * itself; Android has only one string, so the two are joined there.
 */
export async function shareInvite(
  groupName: string,
  url: string,
  inviterName?: string | null
): Promise<ShareResult> {
  const text = inviteShareText(groupName, url, inviterName);

  if (Platform.OS === 'web') {
    // `navigator.share` is the same sheet on a phone browser. Where it does
    // not exist — most desktops — fall back to the clipboard, which is what
    // the person was going to do with the link anyway.
    const nav = typeof navigator === 'undefined' ? undefined : navigator;
    if (nav?.share) {
      try {
        await nav.share({ title: groupName, text, url });
        return { shared: true };
      } catch {
        return { shared: false }; // dismissed
      }
    }
    if (nav?.clipboard) {
      await nav.clipboard.writeText(url);
      return { shared: true };
    }
    return { shared: false };
  }

  const result = await Share.share(
    Platform.OS === 'ios' ? { message: text, url } : { message: `${text}\n\n${url}` },
    { subject: `Join ${groupName} on Betta`, dialogTitle: `Invite to ${groupName}` }
  );

  return { shared: result.action === Share.sharedAction };
}

// --- Surviving the sign-in gate ---------------------------------------------

/**
 * An invite link opened by somebody who is not signed in — which is the whole
 * point of sending one — hits the redirect gate in `app/_layout.tsx` and is
 * bounced to sign-in. Without somewhere to put it, the token is gone by the
 * time they have an account and they land on an empty Groups tab wondering
 * what happened.
 *
 * So the join screen parks it here on the way past, and the gate picks it up
 * once there is a session. AsyncStorage rather than memory because signing up
 * can mean leaving the app entirely to confirm an email.
 */
const PENDING_KEY = 'betta.pendingInvite';

export async function rememberInvite(token: string): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDING_KEY, token);
  } catch {
    // A remembered invite is a convenience. Losing it costs one paste.
  }
}

/** Reads and clears in one go, so a stale token can never fire twice. */
export async function takePendingInvite(): Promise<string | null> {
  try {
    const token = await AsyncStorage.getItem(PENDING_KEY);
    if (token) await AsyncStorage.removeItem(PENDING_KEY);
    return token;
  } catch {
    return null;
  }
}

export async function forgetPendingInvite(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_KEY);
  } catch {
    // Nothing to do: the next read clears it anyway.
  }
}
