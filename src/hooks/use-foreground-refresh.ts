import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { SIGN_CACHE_MS } from '@/lib/media';

/**
 * How long the app can be away before what is on screen counts as stale.
 *
 * Derived from the signing cache rather than picked, because the thing this
 * exists to fix is media: a signed URL is good for an hour and the cache hands
 * the same one out for forty-five minutes, so anything older than that window
 * may be rendering a URL that has since expired. Re-signing is what fixes it,
 * and `reload` is what re-signs.
 */
const STALE_AFTER_MS = SIGN_CACHE_MS;

/**
 * Refreshes a screen when the app comes back after being away a while.
 *
 * The bug this closes — APP_STORE.md §1 gap 7, CLAUDE.md §7.2 — is quiet and
 * looks like a rendering fault: signed media URLs last an hour, so a feed left
 * open on a locked phone overnight comes back showing broken images with no
 * error anywhere, because nothing failed. Realtime and pull-to-refresh both
 * re-sign, which is exactly why it only ever appeared on a screen nobody had
 * touched.
 *
 * Deliberately **not** a timer. A `setInterval` would fire while the phone is
 * asleep on some platforms and not others, and would keep a screen fetching
 * that nobody is looking at. Foregrounding is the moment the user can actually
 * see the result, and it is the only moment worth spending a round trip on.
 *
 * Also deliberately not every foreground: glancing at a notification and
 * coming straight back should cost nothing. Only an absence long enough to
 * have invalidated something triggers a read.
 */
export function useForegroundRefresh(reload: () => void, enabled = true): void {
  // Stable across renders so the effect never re-subscribes. Callers write
  // this as `feed.reload`, which `useAsync` already memoises, but a screen
  // that passes an inline arrow should not resubscribe on every render.
  const latest = useRef(reload);
  latest.current = reload;

  const leftAt = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const handle = (next: AppStateStatus) => {
      if (next === 'active') {
        const away = leftAt.current;
        leftAt.current = null;
        if (away !== null && Date.now() - away > STALE_AFTER_MS) latest.current();
      } else if (next === 'background' || next === 'inactive') {
        // Recorded on the way out rather than measured on the way in, because
        // "how long were we away" is the question and only the departure time
        // answers it. `inactive` counts: on iOS that is the app switcher and
        // the lock screen, which is precisely the overnight case.
        leftAt.current ??= Date.now();
      }
    };

    const subscription = AppState.addEventListener('change', handle);
    return () => subscription.remove();
  }, [enabled]);
}
