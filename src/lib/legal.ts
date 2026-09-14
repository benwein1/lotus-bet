/**
 * Where the legal pages live, and which version people agreed to.
 *
 * Guideline 1.2 requires an app carrying user-generated content to publish its
 * rules and its contact information, and 5.1.1 requires a privacy policy
 * reachable from inside the app. App Store Connect asks for both URLs as part
 * of the listing, and a reviewer follows them.
 *
 * **These are placeholders until the domain exists.** They are gathered here,
 * in one file with one constant each, precisely so that pointing them at the
 * real pages is a three-line change rather than a hunt through screens — and
 * so `npm run typecheck` is not the thing standing between you and remembering.
 */

/**
 * Set this to your domain and the three URLs below follow.
 *
 * Read from the environment when it is set, so a staging build can point
 * somewhere else without a code change. Falls back to the placeholder, which
 * is deliberately an obviously-fake host rather than a plausible one: a dead
 * link that looks real is worse than one that announces itself.
 */
const ORIGIN = process.env.EXPO_PUBLIC_LEGAL_ORIGIN ?? 'https://example.invalid';

export const TERMS_URL = `${ORIGIN}/terms`;
export const PRIVACY_URL = `${ORIGIN}/privacy`;
export const SUPPORT_URL = `${ORIGIN}/support`;

/**
 * Whether the legal pages are actually somewhere.
 *
 * The sign-up screen still requires agreement when this is false — the record
 * of acceptance is what matters legally and it should exist from the first
 * account — but nothing renders a link that is known to go nowhere.
 */
export const LEGAL_PAGES_PUBLISHED = !ORIGIN.endsWith('example.invalid');

/**
 * The version of the terms being agreed to, recorded against the account.
 *
 * A bare "accepted: true" is worth very little the first time the terms change:
 * you cannot tell who agreed to what, so you cannot tell who needs to be asked
 * again. Bump this whenever the published terms change materially, and the
 * accounts that predate the change are then a query rather than a guess.
 */
export const TERMS_VERSION = '2026-09-14';
