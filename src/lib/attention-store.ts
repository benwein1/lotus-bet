/**
 * One number, published by the feed and read by the tab bar.
 *
 * ---------------------------------------------------------------------------
 * Why a store at all
 * ---------------------------------------------------------------------------
 * "How many bets are waiting on you" is computed from the feed's own rows —
 * see `attention.ts` — but the place it is most useful is the one screen that
 * cannot see them: the tab bar, while you are on Groups or Profile. The badge
 * is the only thing in the app that says "there is something for you over
 * there" once you have navigated away.
 *
 * Three ways to get a number from the feed to a sibling, and why this one:
 *
 * - **Fetch it again in the tab bar.** A second read of a hundred bets on
 *   every tab change, to produce a number the feed already had. No.
 * - **Lift it into a context around the tabs.** Works, but every consumer of
 *   that context re-renders whenever it changes, and the provider would sit
 *   above three screens to serve a dot on one of them.
 * - **A module-level store read through `useSyncExternalStore`.** Only the
 *   components that actually subscribe re-render, there is no provider to
 *   thread, and the value survives a tab switch unmounting the feed — which
 *   matters, because the badge's whole job is to be right while the feed is
 *   not mounted.
 *
 * It holds one integer. That is the whole of the global state, and it is
 * derived — nothing reads it back as a source of truth, and the feed
 * overwrites it wholesale on every pass. If this ever needs a second field,
 * that is the signal to reach for a real store rather than to widen this one.
 */

import { useSyncExternalStore } from 'react';

let count = 0;
const listeners = new Set<() => void>();

/**
 * Publish the current count. Called by the feed whenever its list changes.
 *
 * A no-op when the number has not moved, so a realtime patch that does not
 * change what is waiting on you does not re-render the tab bar.
 */
export function setAttentionCount(next: number): void {
  const clean = Number.isFinite(next) && next > 0 ? Math.floor(next) : 0;
  if (clean === count) return;
  count = clean;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The current count, outside React.
 *
 * Public because it is also the hook's snapshot, and because a module whose
 * only reader is a hook cannot be tested without pulling in a renderer — the
 * rules about what a bad number does belong in a plain unit test.
 */
export function getAttentionCount(): number {
  return count;
}

/**
 * The count, as a hook.
 *
 * The server snapshot is the same getter: this renders inside an Expo Router
 * web build, where a mismatch between the server and client snapshots is a
 * hydration error rather than a stale number.
 */
export function useAttentionCount(): number {
  return useSyncExternalStore(subscribe, getAttentionCount, getAttentionCount);
}

/**
 * Drop the count to zero.
 *
 * Sign-out calls this. Without it the next person on the device inherits a
 * badge counting the previous account's bets — the same reason `media.ts`
 * drops its signed-URL cache.
 */
export function clearAttentionCount(): void {
  setAttentionCount(0);
}
