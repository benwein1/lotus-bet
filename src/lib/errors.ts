/**
 * What a failed request actually means, in words a person can act on.
 *
 * Today every failure becomes the same string in an `ErrorNotice`, and
 * "Failed to fetch" reads identically whether somebody is in a lift, their
 * session expired while the app was backgrounded, or the Supabase project is
 * paused. APP_STORE.md §1 calls that out as P1 for a specific reason: **App
 * Review tests in Airplane Mode**, and an app that says "Failed to fetch" there
 * looks broken rather than offline.
 *
 * Pure and dependency-free so the classification is testable without a network
 * — same split as `postgrest.ts`, `auth-links.ts` and `media-rules.ts`.
 *
 * Deliberately **no** connectivity library. `@react-native-community/netinfo`
 * would tell us about the radio, which is not the question: a phone can hold a
 * perfect wifi association to a captive portal that drops every request. The
 * thing worth reporting is that *this request* did not reach anything, and the
 * failure itself already says so. CLAUDE.md §10 asks for a reason the existing
 * stack cannot cover, and there is not one here.
 */

export type FailureKind =
  /** The request never reached a server. */
  | 'offline'
  /** The session is gone — expired, revoked, or the account was deleted. */
  | 'expired'
  /** The project is paused or down. Nothing the user can do. */
  | 'unavailable'
  /** A rate limit, ours or the platform's. */
  | 'slow-down'
  /** Anything else, reported as-is. */
  | 'unknown';

export interface Failure {
  kind: FailureKind;
  /** What to show. A sentence, not a code. */
  message: string;
}

/**
 * How a fetch that reached nothing announces itself.
 *
 * React Native throws `TypeError: Network request failed`; the browser throws
 * `TypeError: Failed to fetch`, and Safari `Load failed`. None of them carry a
 * status, because there was no response to take one from — which is exactly
 * what distinguishes this case from every other failure.
 */
const OFFLINE_PATTERNS = [
  /network request failed/i,
  /failed to fetch/i,
  /load failed/i,
  /network error/i,
  /err_internet_disconnected/i,
  /the internet connection appears to be offline/i,
];

/** GoTrue and PostgREST wording for a session that is no longer good. */
const EXPIRED_PATTERNS = [
  /jwt expired/i,
  /invalid jwt/i,
  /jwt.*malformed/i,
  /refresh.?token.*(not found|expired|revoked|already used)/i,
  /invalid claim/i,
  /session.*(expired|not found)/i,
  /\bunauthorized\b/i,
];

/** A paused project, a cold start, or the platform having a bad day. */
const UNAVAILABLE_PATTERNS = [
  /project.*paus/i,
  /service unavailable/i,
  /\b50[234]\b/,
  /upstream connect error/i,
];

/**
 * Ours and theirs. `53400` is the errcode the rate-limit triggers raise; the
 * rest is GoTrue's own throttling on sign-in and password reset.
 */
const SLOW_DOWN_PATTERNS = [
  /slow down/i,
  /53400/,
  /rate limit/i,
  /too many requests/i,
  /\b429\b/,
  /for security purposes, you can only request this after/i,
];

function textOf(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const shape = err as { message?: unknown; error_description?: unknown };
    if (typeof shape.message === 'string') return shape.message;
    if (typeof shape.error_description === 'string') return shape.error_description;
  }
  return '';
}

/**
 * Classifies a thrown error.
 *
 * Order matters. "Slow down" is checked before the generic patterns because a
 * rate-limit message can mention a status code, and `expired` before
 * `unavailable` because a dead session is actionable (sign in again) while an
 * outage is not.
 */
export function classifyFailure(err: unknown): Failure {
  const text = textOf(err);

  if (SLOW_DOWN_PATTERNS.some((p) => p.test(text))) {
    return {
      kind: 'slow-down',
      // The trigger's own message is already a sentence aimed at a person, so
      // it is used verbatim when we have it rather than replaced with a worse
      // generic one.
      message: /slow down/i.test(text)
        ? text
        : 'That was a lot at once. Give it a minute and try again.',
    };
  }

  if (OFFLINE_PATTERNS.some((p) => p.test(text))) {
    return {
      kind: 'offline',
      message: "You're offline. This will work again once you have a connection.",
    };
  }

  if (EXPIRED_PATTERNS.some((p) => p.test(text))) {
    return {
      kind: 'expired',
      message: 'Your session ended. Sign in again to pick up where you left off.',
    };
  }

  if (UNAVAILABLE_PATTERNS.some((p) => p.test(text))) {
    return {
      kind: 'unavailable',
      message: 'Lotus Bet is unreachable right now. Try again in a moment.',
    };
  }

  return {
    kind: 'unknown',
    // Never an empty notice: a blank error box is worse than a vague one.
    message: text.trim() || 'Something went wrong.',
  };
}

/** The sentence alone, for callers that only render a string. */
export function describeFailure(err: unknown): string {
  return classifyFailure(err).message;
}
