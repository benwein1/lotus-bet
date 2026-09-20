/**
 * Turning an invite token into something you can paste into a chat.
 *
 * Pure on purpose — no Expo, no React Native, no `window`. Everything that
 * varies (the deployed origin, the app's URL scheme, whose group it is) comes
 * in as an argument, so the awkward parts are unit-testable and the caller is
 * the only thing that has to know about the platform.
 */

/** Where an invite token lives in both the app and the web build. */
export const INVITE_PATH = 'join';

export interface LinkTargets {
  /**
   * The deployed web origin, e.g. `https://betta.example.workers.dev`.
   * Null until the app is actually deployed somewhere.
   */
  webOrigin: string | null;
  /** The app's own scheme, `betta`. */
  scheme: string;
}

/**
 * The URL to share.
 *
 * An `https://` link is strongly preferred over `betta://` and it is not a
 * matter of taste: a custom scheme is dead text in every chat app, mail client
 * and browser that has never heard of it, which is all of them until the app is
 * installed. The person you are inviting is by definition the person who does
 * not have it yet. An `https://` link opens the web build for them — and, once
 * the domain carries an apple-app-site-association file, opens straight into
 * the app for everyone who does.
 *
 * The scheme URL is the fallback for a build with no origin configured, where
 * a link that only works on your own phone still beats no link at all.
 */
export function inviteUrl(token: string, targets: LinkTargets): string {
  const clean = token.trim();
  if (targets.webOrigin) {
    return `${stripTrailingSlash(targets.webOrigin)}/${INVITE_PATH}/${encodeURIComponent(clean)}`;
  }
  return `${targets.scheme}://${INVITE_PATH}/${encodeURIComponent(clean)}`;
}

/**
 * The URL for one bet.
 *
 * Same reasoning as `inviteUrl`, and deliberately the same shape: `https://`
 * wherever an origin is configured, because a `betta://` link is dead text in
 * every chat app that has not heard of the scheme — and the friend you are
 * sending a bet to is often exactly the person without the app. The scheme is
 * the fallback for a build with no origin, where a link that works on your own
 * phone still beats no link.
 *
 * `/bet/<id>` is the route the app already has, so a phone with Betta
 * installed resolves it once the domain carries an
 * apple-app-site-association file, and every other device opens the web build
 * at the same place.
 */
export function betUrl(betId: string, targets: LinkTargets): string {
  const clean = betId.trim();
  if (targets.webOrigin) {
    return `${stripTrailingSlash(targets.webOrigin)}/bet/${encodeURIComponent(clean)}`;
  }
  return `${targets.scheme}://bet/${encodeURIComponent(clean)}`;
}

/**
 * The sentence above a shared bet.
 *
 * The question itself rather than "check out this bet", because the question
 * is the interesting part and a share with no content is ignored. Trimmed to
 * a length that survives a WhatsApp preview without becoming a wall.
 *
 * The URL is not interpolated here, for the same reason it is not in
 * `inviteMessage`: iOS and Android take the message and the link separately
 * and render the preview themselves.
 */
export function betShareMessage(title: string, groupName?: string | null): string {
  const question = title.trim().length > 120 ? `${title.trim().slice(0, 117)}…` : title.trim();
  const where = groupName?.trim() ? ` in ${groupName.trim()}` : '';
  return `"${question}" — a bet${where} on Betta. What do you reckon?`;
}

/**
 * What goes in the message box above the link.
 *
 * Named, short, and it says what the app does — a bare URL in a group chat
 * reads like spam, and "Betta" alone does not tell anyone why they should
 * tap it. The URL is deliberately *not* interpolated into this sentence: iOS
 * and Android share sheets take the message and the URL separately and will
 * render the link preview themselves, and apps that only take one string get
 * them joined by the caller.
 */
export function inviteMessage(groupName: string, inviterName?: string | null): string {
  const who = inviterName?.trim();
  const group = groupName.trim() || 'a group';
  return who
    ? `${who} wants you in "${group}" on Betta — bet your friends on anything, settle up however you like.`
    : `Join "${group}" on Betta — bet your friends on anything, settle up however you like.`;
}

/** Message and URL as one string, for anywhere that only accepts one. */
export function inviteShareText(
  groupName: string,
  url: string,
  inviterName?: string | null
): string {
  return `${inviteMessage(groupName, inviterName)}\n\n${url}`;
}

/**
 * How long a link has left, as a sentence rather than a timestamp.
 *
 * Nobody shares a link and then reads an ISO date. What they want to know is
 * whether it is still worth sending.
 */
export function inviteExpiry(expiresAt: string, now: number = Date.now()): string {
  const ms = new Date(expiresAt).getTime() - now;
  if (Number.isNaN(ms)) return '';
  if (ms <= 0) return 'Expired';

  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) {
    const minutes = Math.max(1, Math.floor(ms / 60_000));
    return `Expires in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  if (hours < 24) return `Expires in ${hours} hour${hours === 1 ? '' : 's'}`;

  const days = Math.floor(hours / 24);
  return `Expires in ${days} day${days === 1 ? '' : 's'}`;
}

function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}
