import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'betta.feed.lastSeen';

/**
 * When the user last looked at the feed.
 *
 * Without this the feed is the same wall of cards whether you opened it thirty
 * seconds ago or last week, and there is no way to tell what arrived in
 * between. It is per-device and deliberately local: "have I seen this" is not
 * something worth a table, a write on every scroll, or a sync between phones.
 *
 * The mark is deferred until the screen loses focus, so a bet does not stop
 * being new while you are still looking at it.
 */
export function useLastSeen(): { since: number | null; markSeen: () => void } {
  const [since, setSince] = useState<number | null>(null);
  // What the *next* mark should write. Held in a ref so reading it on blur
  // does not re-run the effect that set it.
  const pending = useRef<number>(Date.now());
  const loaded = useRef(false);

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (!active) return;
      const parsed = stored ? Number(stored) : NaN;
      // A first launch has nothing to be new *since*, so nothing is marked.
      setSince(Number.isFinite(parsed) ? parsed : Date.now());
      loaded.current = true;
    });
    return () => {
      active = false;
    };
  }, []);

  const markSeen = useCallback(() => {
    if (!loaded.current) return;
    const now = pending.current;
    pending.current = Date.now();
    setSince(now);
    void AsyncStorage.setItem(STORAGE_KEY, String(now));
  }, []);

  // Leaving the screen is what counts as having seen it.
  useFocusEffect(
    useCallback(() => {
      pending.current = Date.now();
      return () => markSeen();
    }, [markSeen])
  );

  return { since, markSeen };
}

/** True when `createdAt` landed after the user last looked, and is not theirs. */
export function isNewSince(
  createdAt: string,
  since: number | null,
  creatorId: string,
  userId: string
): boolean {
  if (since === null || creatorId === userId) return false;
  return new Date(createdAt).getTime() > since;
}
