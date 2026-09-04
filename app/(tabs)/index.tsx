import { useCallback, useMemo } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';

import { BetCard, mySide } from '@/components/bet-card';
import { EmptyState, ErrorNotice, Loading, SectionTitle } from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { useFeedRealtime } from '@/hooks/use-group-realtime';
import { fetchFeedBets } from '@/lib/queries';
import { useAuth } from '@/providers/auth-provider';
import { colors } from '@/theme';

/**
 * Home feed: what you're already in, then what you could still join.
 *
 * Only open/locked bets appear here — resolved history lives on Profile.
 */
export default function HomeScreen() {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';

  const feed = useAsync(fetchFeedBets, [userId]);

  const refresh = useCallback(() => {
    void feed.reload({ silent: true });
  }, [feed]);

  useFeedRealtime(Boolean(userId), refresh);

  const { mine, open } = useMemo(() => {
    const bets = feed.data ?? [];
    return {
      mine: bets.filter((bet) => mySide(bet, userId) !== null),
      open: bets.filter((bet) => mySide(bet, userId) === null && bet.status === 'open'),
    };
  }, [feed.data, userId]);

  if (feed.loading) return <Loading label="Loading your bets…" />;

  return (
    <ScrollView
      className="flex-1 bg-ink-950"
      contentContainerClassName="px-4 pb-10 pt-4"
      refreshControl={
        <RefreshControl
          refreshing={feed.refreshing}
          onRefresh={() => feed.reload()}
          tintColor={colors.lotus['500']}
        />
      }
    >
      {feed.error && <ErrorNotice message={feed.error} />}

      <SectionTitle>Your open bets</SectionTitle>
      {mine.length === 0 ? (
        <View className="mb-6 rounded-3xl border border-dashed border-ink-700 bg-ink-900/40">
          <EmptyState
            emoji="🎯"
            title="No live bets"
            body="Pick a side on something below, or start one in a group."
          />
        </View>
      ) : (
        <View className="mb-6">
          {mine.map((bet) => (
            <BetCard key={bet.id} bet={bet} currentUserId={userId} showGroup />
          ))}
        </View>
      )}

      <SectionTitle>New bets in your groups</SectionTitle>
      {open.length === 0 ? (
        <View className="rounded-3xl border border-dashed border-ink-700 bg-ink-900/40">
          <EmptyState
            emoji="🍿"
            title="All caught up"
            body="Nothing new to join right now. Post a bet and see who bites."
          />
        </View>
      ) : (
        open.map((bet) => (
          <BetCard key={bet.id} bet={bet} currentUserId={userId} showGroup />
        ))
      )}

      <Text className="mt-8 text-center text-2xs leading-4 text-ink-600">
        Lotus Bet tracks obligations only. Settle up with your friends however you normally do.
      </Text>
    </ScrollView>
  );
}
