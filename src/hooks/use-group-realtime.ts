import { useEffect } from 'react';

import { supabase } from '@/lib/supabase';

/**
 * One Supabase Realtime channel per group. Any change to a bet, a position, a
 * ledger line or a settlement in that group nudges the screen to refetch.
 *
 * Refetching rather than patching local state keeps this honest: the server is
 * always the source of truth for who is on which side.
 */
export function useGroupRealtime(groupId: string | null | undefined, onChange: () => void) {
  useEffect(() => {
    if (!groupId) return;

    const channel = supabase
      .channel(`group:${groupId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bets', filter: `group_id=eq.${groupId}` },
        onChange
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bet_ledger_entries', filter: `group_id=eq.${groupId}` },
        onChange
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'settlement_confirmations', filter: `group_id=eq.${groupId}` },
        onChange
      )
      // bet_positions has no group_id column, so it cannot be server-filtered;
      // the volume in a friend group is tiny, so we take every event.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bet_positions' }, onChange)
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [groupId, onChange]);
}

/**
 * Home-feed variant: the user's bets span several groups, so there is no single
 * group_id to filter on. RLS already limits the rows the client can see, and a
 * friend group's write volume is tiny, so an unfiltered listener is fine here.
 */
export function useFeedRealtime(enabled: boolean, onChange: () => void) {
  useEffect(() => {
    if (!enabled) return;

    const channel = supabase
      .channel('feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bets' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bet_positions' }, onChange)
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, onChange]);
}
