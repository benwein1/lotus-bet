/**
 * Reading what a Supabase auth redirect actually said.
 *
 * A recovery link does not arrive as a tidy route. GoTrue bounces through
 * `/auth/v1/verify` and lands on the app with the session in the URL's
 * *fragment* — `#access_token=…&refresh_token=…&type=recovery` — under the
 * implicit flow, which is the client default here. An expired or reused link
 * comes back with `error`/`error_code` instead and no `type` at all.
 *
 * Pure on purpose, and split out for the same reason `invite-links.ts` and
 * `reminder-rules.ts` are: everything worth asserting is a string
 * transformation, and none of it should need a browser or a simulator.
 */

export interface RecoveryTokens {
  accessToken: string;
  refreshToken: string;
}

/** `a=1&b=2` → `{ a: '1', b: '2' }`, tolerating junk rather than throwing. */
function decodePairs(blob: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of blob.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const rawKey = eq === -1 ? pair : pair.slice(0, eq);
    const rawValue = eq === -1 ? '' : pair.slice(eq + 1);
    if (!rawKey) continue;
    try {
      out[decodeURIComponent(rawKey)] = decodeURIComponent(rawValue.replace(/\+/g, ' '));
    } catch {
      // A malformed percent-escape is not worth losing the other keys over.
      out[rawKey] = rawValue;
    }
  }
  return out;
}

/**
 * Every parameter a redirect carried, from the query string and the fragment
 * both.
 *
 * Both halves are read because which one GoTrue uses depends on the flow and
 * on whether it succeeded: tokens come back in the fragment, some errors in
 * the query. The fragment wins a collision, because that is where a real
 * session is.
 */
export function authRedirectParams(url: string): Record<string, string> {
  const hashAt = url.indexOf('#');
  const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const fragment = hashAt === -1 ? '' : url.slice(hashAt + 1);

  const queryAt = beforeHash.indexOf('?');
  const query = queryAt === -1 ? '' : beforeHash.slice(queryAt + 1);

  return { ...decodePairs(query), ...decodePairs(fragment) };
}

/**
 * True when this URL is somebody arriving from a password-reset email.
 *
 * Deliberately does not require the tokens. The app has to know it is in a
 * recovery *before* it knows whether the session took, or the redirect gate
 * gets a frame in which a perfectly ordinary-looking session is waved through
 * to the feed — which is the whole bug the `recovering` latch exists to stop.
 */
export function isRecoveryRedirect(url: string): boolean {
  return authRedirectParams(url).type === 'recovery';
}

/**
 * The session a recovery link is carrying, or null if it is not carrying one.
 *
 * Only the native side needs this. On the web `detectSessionInUrl` hands the
 * fragment to GoTrue for us; a custom-scheme deep link has no such thing, so
 * the tokens have to be lifted out and handed to `setSession` by hand.
 */
export function recoveryTokens(url: string): RecoveryTokens | null {
  const params = authRedirectParams(url);
  if (params.type !== 'recovery') return null;

  const accessToken = params.access_token;
  const refreshToken = params.refresh_token;
  if (!accessToken || !refreshToken) return null;

  return { accessToken, refreshToken };
}

/**
 * What went wrong, when a link came back refused.
 *
 * `error_description` is GoTrue's own sentence and is written for a person, so
 * it is preferred over the code when present.
 */
export function authRedirectError(url: string): string | null {
  const params = authRedirectParams(url);
  const description = params.error_description;
  if (description) return description;
  return params.error_code ?? params.error ?? null;
}
