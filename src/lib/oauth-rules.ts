/**
 * The pure half of signing in with Apple or Google.
 *
 * Split out for the same reason `media-rules.ts` and `reminder-rules.ts` are:
 * the interesting decisions here are string handling and they have sharp edges,
 * while everything around them needs a device, a browser or a live GoTrue. This
 * file is what the tests hold.
 */

import { authRedirectParams } from '@/lib/auth-links';

export type OAuthProvider = 'apple' | 'google';

/** What the provider calls itself, for a button label or an error sentence. */
export const PROVIDER_LABEL: Record<OAuthProvider, string> = {
  apple: 'Apple',
  google: 'Google',
};

/**
 * Apple's name object, flattened.
 *
 * **Apple hands the name over exactly once** — on the very first authorisation,
 * and never again. Every later sign-in returns `fullName: null`, including
 * after a reinstall, because from Apple's side you were already told. So this
 * runs at most once per account and its output has to be captured there and
 * then; there is no second chance to ask.
 *
 * Both parts are optional and either can be an empty string. Someone who gave
 * only a family name is not an error, and neither is someone who gave nothing
 * — that person gets the profile-setup screen, which is the normal path for an
 * account with no name and needs no special case here.
 */
export function appleDisplayName(
  fullName: { givenName?: string | null; familyName?: string | null } | null | undefined
): string | null {
  if (!fullName) return null;

  const parts = [fullName.givenName, fullName.familyName]
    .map((part) => (part ?? '').trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) return null;

  // Clamped to the same 40 the display-name constraint enforces, so a long
  // name is shortened here rather than rejected by Postgres after the account
  // already exists.
  return parts.join(' ').slice(0, 40);
}

/**
 * The name a provider left in the session's user metadata.
 *
 * Apple and Google do not agree on a key, and neither of them uses the app's
 * own `display_name`: Google sends `name` and `full_name`, Apple sends
 * `full_name` assembled from the name it gave. The signup trigger reads the
 * same three keys in the same order — the app's own first, because that one
 * has been through `prepareContent` and a provider's string has not.
 *
 * Mirrored here rather than only in SQL because the client needs the same
 * answer to decide whether somebody still has to visit profile setup.
 */
export function providerDisplayName(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  if (!metadata) return null;

  for (const key of ['display_name', 'full_name', 'name']) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim().slice(0, 40);
    }
  }

  return null;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * The tokens on the URL a provider redirects back to.
 *
 * Under the implicit flow — which is supabase-js's default and what this app
 * uses — GoTrue appends `#access_token=…&refresh_token=…` to the redirect. On
 * the web `detectSessionInUrl` consumes that on its own; on a device nothing
 * does, because the redirect arrives as a string handed back by the in-app
 * browser and never touches a URL bar. So this is the native half.
 *
 * `authRedirectParams` is reused rather than reimplemented: it already reads
 * the fragment *and* the query with the fragment winning, which is the shape
 * GoTrue actually produces — tokens land in one and some errors in the other.
 *
 * Both tokens are required. A URL carrying only an access token is a session
 * that cannot be refreshed, which would sign somebody out an hour later for no
 * reason they could see.
 */
export function oauthTokens(url: string): OAuthTokens | null {
  const params = authRedirectParams(url);
  const accessToken = params.access_token;
  const refreshToken = params.refresh_token;

  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
}

/**
 * Whether an account still owes an agreement to this version of the terms.
 *
 * An email signup carries the version in its metadata and arrives already
 * agreed. A social signup cannot — there is no form and `signInWithIdToken`
 * takes no metadata — so the app records it afterwards through `accept_terms`.
 *
 * It is also how re-acceptance works when the wording changes: a row holding
 * last year's version is not agreed to this one. That is the whole reason the
 * column is a version rather than a boolean.
 */
export function needsTermsAcceptance(
  storedVersion: string | null | undefined,
  currentVersion: string
): boolean {
  return (storedVersion ?? '').trim() !== currentVersion;
}

/**
 * Supabase's failure strings, in the app's voice.
 *
 * The two that matter are the ones a person can actually cause: cancelling the
 * sheet, and the provider not being switched on in the project. The second is
 * a configuration mistake rather than a user error, and it is worth naming
 * precisely — "Unsupported provider" tells the person nothing and sends the
 * developer looking in the wrong place.
 */
export function friendlyOAuthError(provider: OAuthProvider, message: string): string {
  const lower = message.toLowerCase();

  // Both platforms' word for "the user backed out". Not an error to show.
  if (
    lower.includes('cancel') ||
    lower.includes('dismiss') ||
    lower.includes('the operation couldn’t be completed') ||
    lower.includes("the operation couldn't be completed")
  ) {
    return '';
  }

  if (lower.includes('unsupported provider') || lower.includes('provider is not enabled')) {
    return `${PROVIDER_LABEL[provider]} sign-in is not switched on for this project yet.`;
  }

  if (lower.includes('network') || lower.includes('fetch')) {
    return 'No connection. Check your signal and try again.';
  }

  return `Could not sign you in with ${PROVIDER_LABEL[provider]}.`;
}
