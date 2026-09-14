import { useCallback, useEffect, useRef, useState } from 'react';

import { createCoalescer } from '@/lib/coalesce';

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
  /** Re-runs the loader. Pass `{ silent: true }` for realtime-driven refreshes. */
  reload: (options?: { silent?: boolean }) => Promise<void>;
  setData: React.Dispatch<React.SetStateAction<T | null>>;
}

/**
 * The app's one data-fetching primitive. Deliberately small: an MVP with a
 * handful of screens does not need a query cache, and Supabase Realtime
 * already tells us when to refetch.
 */
export function useAsync<T>(loader: () => Promise<T>, deps: React.DependencyList): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  // Guards against a slow response landing after the screen has unmounted.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Screen focus, Realtime events and the user's own write all ask for the same
  // refetch at the same moment; `createCoalescer` turns that burst into two
  // round trips instead of N. It lives in `lib/` rather than here so the number
  // it produces can be asserted without a renderer — see `coalesce.test.ts`.
  const coalescer = useRef(createCoalescer());

  const run = useCallback(async (silent: boolean) => {
    if (!silent) setRefreshing(true);
    try {
      const next = await loaderRef.current();
      if (!mounted.current) return;
      setData(next);
      setError(null);
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      if (mounted.current) {
        setRefreshing(false);
        setLoading(false);
      }
    }
  }, []);

  const reload = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;

      // A pull-to-refresh landing on top of a silent refetch still has to show
      // its spinner, or the gesture reads as ignored.
      if (!silent) setRefreshing(true);

      let first = true;
      await coalescer.current.run(async () => {
        // Only the caller's own run honours their `silent`; the trailing
        // re-run is never a user-visible refresh.
        await run(first ? silent : true);
        first = false;
      });
    },
    [run]
  );

  useEffect(() => {
    setLoading(true);
    void reload({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, refreshing, reload, setData };
}
