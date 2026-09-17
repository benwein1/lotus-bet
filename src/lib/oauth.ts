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
 * **The platform decides this, not configuration**, and that is the opposite of
 * how invite links and password resets work — both of those prefer
 * `EXPO_PUBLIC_WEB_ORIGIN` when it is set, because both are opened from
 * somewhere else (a chat, an inbox) and have to land on something a browser can
 * show.
 *
 * An OAuth redirect is the reverse: it has to come back *into the process that
 * started it*. On a device that process is the app, and
 * `openAuthSessionAsync(url, returnUrl)` only hands control back when the
 * browser reaches a URL matching `returnUrl` — so a redirect pointing at the
 * website would leave the sheet sitting on a web page it has no reason to
 * close, and the sign-in would simply never return.
 *
 * Reusing `linkTargets()` here was a bug waiting for the domain to be
 * configured: the moment `EXPO_PUBLIC_WEB_ORIGIN` is set, every native Google
 * sign-in would have started hanging, with nothing on screen to explain why.
 * Only the web branch may use an http origin, because there the "process" is
 * the page itself.
 */
function redirectTo(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return `${window.location.origin}/`;
  }
  return `${linkTargets().scheme}://`;
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
  // Ask before leaving. See `providerEnabled` for why this is worth a round
  // trip: without it, a provider that is not switched on throws the person out
  // of the app and onto a page of raw JSON on the Supabase domain.
  if ((await providerEnabled(provider)) === false) {
    throw new Error(`Unsupported provider: provider is not enabled`);
  }

  return provider === 'apple' ? signInWithApple() : signInWithGoogle();
}

/**
 * Whether a provider is actually switched on for this project.
 *
 * **Why this exists.** `signInWithOAuth` does not talk to the server — it
 * builds the authorize URL on the client and then goes there. So a provider
 * that is not enabled fails *at the destination*, and the shape of that
 * failure is genuinely bad:
 *
 *   - on the web the page has already navigated, so the person is looking at
 *     `{"code":400,"error_code":"validation_failed","msg":"Unsupported
 *     provider: provider is not enabled"}` on `supabase.co`, outside the app,
 *     with the back button as their only way home. Nothing in the app ever
 *     sees an error to report, because the document that called it is gone.
 *   - on a device the browser sheet opens onto that same JSON, and dismissing
 *     it looks identical to changing your mind — the button silently does
 *     nothing.
 *
 * Only `signInWithIdToken`, which Apple uses, returns the failure to the
 * caller properly. So this closes the gap for the path that cannot.
 *
 * **It fails open, deliberately.** GoTrue's `/settings` is unauthenticated and
 * returns an `external` map of provider flags, but that shape could not be
 * verified from the environment this was written in — the egress proxy refuses
 * that host. So anything other than an explicit `false` — a network failure, a
 * non-200, a body that does not look the way it is expected to — returns null
 * and the sign-in proceeds exactly as it would have. A check that cannot be
 * confirmed must not be able to block a working sign-in; the worst case here
 * is that it changes nothing and the old behaviour stands.
 */
async function providerEnabled(provider: OAuthProvider): Promise<boolean | null> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  try {
    const response = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } });
    if (!response.ok) return null;

    const body: unknown = await response.json();
    const external = (body as { external?: Record<string, unknown> } | null)?.external;
    if (!external || typeof external !== 'object') return null;

    const flag = external[provider];
    return typeof flag === 'boolean' ? flag : null;
  } catch {
    return null;
  }
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
