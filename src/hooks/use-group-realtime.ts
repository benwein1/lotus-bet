import { useEffect, useId, useRef } from 'react';

import { supabase } from '@/lib/supabase';

/**
 * One Supabase Realtime channel per mounted screen, scoped to a group. Any
 * change to a bet, a position, a ledger line or a settlement in that group
 * nudges the screen to refetch.
 *
 * Refetching rather than patching local state keeps this honest: the server is
 * always the source of truth for who is on which side.
 *
 * Two things here are load-bearing; see `useRealtimeChannel` below for why.
 */
export function useGroupRealtime(groupId: string | null | undefined, onChange: () => void) {
  useRealtimeChannel(groupId ? `group:${groupId}` : null, onChange, (channel, handle) =>
    channel
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bets', filter: `group_id=eq.${groupId}` },
        handle
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bet_ledger_entries',
          filter: `group_id=eq.${groupId}`,
        },
        handle
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'settlement_confirmations',
          filter: `group_id=eq.${groupId}`,
        },
        handle
      )
      // bet_positions has no group_id column, so it cannot be server-filtered;
      // the volume in a friend group is tiny, so we take every event.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bet_positions' }, handle)
  );
}

/**
 * Home-feed variant: the user's bets span several groups, so there is no single
 * group_id to filter on. RLS already limits the rows the client can see, and a
 * friend group's write volume is tiny, so an unfiltered listener is fine here.
 */
export function useFeedRealtime(enabled: boolean, onChange: () => void) {
  useRealtimeChannel(enabled ? 'feed' : null, onChange, (channel, handle) =>
    channel
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bets' }, handle)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bet_positions' }, handle)
  );
}

type ChannelBuilder = (
  channel: ReturnType<typeof supabase.channel>,
  handle: () => void
) => ReturnType<typeof supabase.channel>;

/**
 * Opens a Realtime channel for as long as `topic` is non-null, and closes it
 * again on unmount.
 *
 * Two details exist to avoid "cannot add `postgres_changes` callbacks ... after
 * `subscribe()`", which supabase-js throws if a channel that is already
 * subscribed gets another listener registered on it:
 *
 * 1. `onChange` is held in a ref, so a caller that rebuilds its callback every
 *    render does not tear the channel down and reopen it every render.
 * 2. The channel name is suffixed with a per-instance id. Screens stack — the
 *    settle-up screen sits on top of the group detail screen, and both watch
 *    the same group — so a name derived only from the group id would collide
 *    with a live channel. `removeChannel` is also async, so even a remount can
 *    race against its own teardown.
 */
function useRealtimeChannel(topic: string | null, onChange: () => void, build: ChannelBuilder) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const instanceId = useId();

  useEffect(() => {
    if (!topic) return;

    const handle = () => onChangeRef.current();
    const channel = build(supabase.channel(`${topic}:${instanceId}`), handle).subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
    // `build` closes over the topic it was given, so the topic is the only
    // dependency that should reopen the channel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, instanceId]);
}
