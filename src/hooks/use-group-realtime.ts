import { useEffect, useId, useMemo, useRef } from 'react';

import { isDemoMode } from '@/lib/demo';
import { supabase } from '@/lib/supabase';

/**
 * How long a burst of Realtime events is collapsed into one refetch.
 *
 * Leading-edge: the first event fires straight away, because the whole value of
 * Realtime is that the screen reacts. What the window suppresses is the tail —
 * resolving a bet writes a ledger row per participant, so five people on one
 * bet produce five events in the same instant and five identical refetches.
 * SCALEABILITY.md section 6 stage 1 asks for exactly this.
 */
const BURST_MS = 500;

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
      // Filtered since `…_position_group_id.sql` gave `bet_positions` a
      // `group_id`. It used to take every position event in the database,
      // because there was nothing to filter on — see SECURITY.md #9.
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bet_positions',
          filter: `group_id=eq.${groupId}`,
        },
        handle
      )
  );
}

/**
 * Home-feed variant: the user's bets span several groups, so there is no single
 * group to filter on — but there is a *set*, and `group_id=in.(…)` takes it.
 *
 * The caller passes the groups its loaded bets belong to. That is the right
 * set rather than an approximation of one: a position on a bet the feed has
 * not loaded cannot change anything the feed is drawing.
 *
 * `bets` itself stays unfiltered, deliberately. A brand-new bet in a group
 * whose bets are not loaded yet is precisely the event the feed most needs to
 * hear about, and filtering on the groups it already knows would hide it. RLS
 * still decides which rows arrive.
 */
export function useFeedRealtime(
  groupIds: readonly string[] | null,
  onChange: () => void,
  onPosition?: PositionHandler
) {
  // Sorted and joined so that the same set in a different order does not
  // reopen the channel. The feed rebuilds this array on every fetch.
  const key = useMemo(() => [...(groupIds ?? [])].sort().join(','), [groupIds]);

  // Held in a ref for the same reason `onChange` is: the channel must not be
  // torn down and reopened because a caller rebuilt an inline arrow.
  const positionRef = useRef(onPosition);
  positionRef.current = onPosition;

  useRealtimeChannel(
    groupIds ? 'feed' : null,
    onChange,
    (channel, handle) => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table: 'bets' }, handle);

      // `in.()` with nothing in it is not a filter, it is a syntax error — and
      // a user whose feed is empty has no position events worth hearing.
      if (key.length > 0) {
        channel.on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'bet_positions',
            filter: `group_id=in.(${key})`,
          },
          // The payload already carries the row that changed, so a card whose
          // bet is on screen can be updated from it. Refetching a hundred bets
          // and re-signing their media to move one avatar is the trade the feed
          // already stopped making for likes (CLAUDE.md, "Making it feel
          // fast"); SCALEABILITY.md section 6 stage 3 asks for the same here.
          //
          // The handler says whether it recognised the bet. Anything it did not
          // — a bet posted since the last fetch, a payload without the columns —
          // falls through to the refetch, so being unable to patch is never
          // being wrong.
          (payload) => {
            if (!positionRef.current?.(payload as PositionPayload)) handle();
          }
        );
      }

      return channel;
    },
    key
  );
}

/** What a `bet_positions` change carries. */
export type PositionPayload = {
  eventType?: string;
  new?: Record<string, unknown> | null;
  old?: Record<string, unknown> | null;
};

/** Returns true when the change was applied locally and needs no refetch. */
export type PositionHandler = (payload: PositionPayload) => boolean;

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
 *
 * `rebuildKey` is for a builder that closes over something other than the
 * topic — the feed's set of group ids. Changing it reopens the channel, which
 * is the only way to change a server-side filter.
 */
function useRealtimeChannel(
  topic: string | null,
  onChange: () => void,
  build: ChannelBuilder,
  rebuildKey = ''
) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const instanceId = useId();

  useEffect(() => {
    // Demo mode has no backend to subscribe to.
    if (!topic || isDemoMode()) return;

    // Leading edge, then one trailing call if anything arrived during the
    // window. The trailing call is load-bearing for the same reason it is in
    // `createCoalescer`: an event that landed while the refetch was in flight
    // may be about a change that refetch was too early to see.
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending = false;

    const handle = () => {
      if (timer) {
        pending = true;
        return;
      }
      onChangeRef.current();
      timer = setTimeout(function settle() {
        timer = null;
        if (!pending) return;
        pending = false;
        onChangeRef.current();
        timer = setTimeout(settle, BURST_MS);
      }, BURST_MS);
    };

    const channel = build(supabase.channel(`${topic}:${instanceId}`), handle).subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
    // `build` closes over the topic and the rebuild key it was given, so those
    // are the only dependencies that should reopen the channel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, instanceId, rebuildKey]);
}
