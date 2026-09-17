/**
 * Signing in with Apple and Google — the half that needs a device.
 *
 * The pure string handling lives in `oauth-rules.ts`; this is the part that
 * talks to Apple's native sheet, the in-app browser and GoTrue.
 *
 * **Two providers, two genuinely different mechanisms.** Apple on iOS is a
 * native sheet that hands back a signed identity token, which goes straight to
 * `signInWithIdToken` — no browser, no redirect, no round trip through a web
 * page. Google has no native equivalent that does not pull in a config plugin
 * and a native build, so it goes the OAuth way: open the provider in a browser,
 * come back on a redirect, lift the tokens off it.
 *
 * Which is why this file does not try to make them look the same. A shared
 * wrapper over two flows with different failure modes would hide exactly the
 * parts worth reading.
 */

import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { linkTargets } from '@/lib/invites';
import { appleDisplayName, oauthTokens, type OAuthProvider } from '@/lib/oauth-rules';
import { supabase } from '@/lib/supabase';

// Required on the web so the popup/redirect can hand control back. A no-op on
// native, and safe to call at module scope.
WebBrowser.maybeCompleteAuthSession();

/**
 * Where a provider sends somebody back to.
 *
 * The same origin resolution the invite links use, so there is one answer to
 * "what is this app's address" rather than two that drift. Unlike an invite,
 * the custom scheme is a perfectly good fallback here: anybody completing a
 * sign-in already has the app open.
 */
function redirectTo(): string {
  const { webOrigin, scheme } = linkTargets();
  return webOrigin ? `${webOrigin}/` : `${scheme}://`;
}

/** Whether the native Apple sheet can be shown at all. iOS 13+, iOS only. */
export async function appleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

export interface OAuthResult {
  /**
   * The name Apple gave us, on the one authorisation it gives it on.
   *
   * Null for Google and for every Apple sign-in after the first. The caller
   * writes it to the profile immediately, because there is no way to ask
   * again — see `appleDisplayName`.
   */
  displayName: string | null;
  /** False when the person backed out of the sheet. Not an error. */
  completed: boolean;
}

/**
 * Sign in with Apple.
 *
 * The nonce is the part worth understanding. Apple signs the **hash** of a
 * nonce into its identity token; Supabase verifies that token against the
 * **raw** nonce we hand it separately. Sending the same string to both, or the
 * hash to both, fails verification — the two values are deliberately different
 * halves of one check, and it exists so a token captured in flight cannot be
 * replayed by somebody who did not originate the request.
 */
export async function signInWithApple(): Promise<OAuthResult> {
  const rawNonce = randomNonce();
  const hashedNonce = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawNonce
  );

  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
    nonce: hashedNonce,
  });

  if (!credential.identityToken) {
    throw new Error('Apple did not return an identity token.');
  }

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce: rawNonce,
  });
  if (error) throw error;

  return { displayName: appleDisplayName(credential.fullName), completed: true };
}

/**
 * Sign in with Google.
 *
 * On the web `signInWithOAuth` navigates the page itself and the session is
 * picked up by `detectSessionInUrl` when the browser comes back, so there is
 * nothing to await — the function returns and the page is already leaving.
 *
 * On a device the redirect lands in an in-app browser sheet that hands the
 * final URL back as a string. Nothing parses it automatically, so the tokens
 * are lifted off it and given to `setSession` by hand. That is the same shape
 * the password-reset deep link uses, and for the same reason.
 */
export async function signInWithGoogle(): Promise<OAuthResult> {
  const target = redirectTo();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: target,
      // On native we need the URL rather than a navigation, so we can open it
      // in a sheet we control and get the result back.
      skipBrowserRedirect: Platform.OS !== 'web',
    },
  });
  if (error) throw error;

  if (Platform.OS === 'web') {
    // The page is navigating. Anything after this never runs.
    return { displayName: null, completed: true };
  }

  if (!data?.url) throw new Error('Google did not return a sign-in URL.');

  const outcome = await WebBrowser.openAuthSessionAsync(data.url, target);

  // `cancel` is the sheet being dismissed and `dismiss` is the app being
  // backgrounded out of it. Neither is a failure worth showing a message for.
  if (outcome.type !== 'success') return { displayName: null, completed: false };

  const tokens = oauthTokens(outcome.url);
  if (!tokens) throw new Error('Google sent us back without a session.');

  const { error: sessionError } = await supabase.auth.setSession({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  });
  if (sessionError) throw sessionError;

  return { displayName: null, completed: true };
}

export async function signInWithProvider(provider: OAuthProvider): Promise<OAuthResult> {
  return provider === 'apple' ? signInWithApple() : signInWithGoogle();
}

/**
 * A random string for the Apple nonce.
 *
 * `getRandomBytes` rather than `Math.random`: this is the value the whole
 * replay protection rests on, and a predictable one makes the check
 * decorative.
 */
function randomNonce(): string {
  const bytes = Crypto.getRandomBytes(32);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
