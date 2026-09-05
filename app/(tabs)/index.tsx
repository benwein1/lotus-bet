import { useCallback, useMemo } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BetCard, mySide } from '@/components/bet-card';
import { DemoBadge } from '@/components/demo-entry';
import { SparkIcon, TicketIcon } from '@/components/icons';
import { ContentWidth, ScreenGround } from '@/components/screen';
import { BetFeedSkeleton } from '@/components/skeletons';
import { EmptyState, ErrorNotice, Panel, Title } from '@/components/ui';
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
  const { session, profile } = useAuth();
  const userId = session?.user.id ?? '';

  const feed = useAsync(fetchFeedBets, [userId]);

  // `feed` is a new object every render; `feed.reload` is stable.
  const { reload: reloadFeed } = feed;

  const refresh = useCallback(() => {
    void reloadFeed({ silent: true });
  }, [reloadFeed]);

  useFeedRealtime(Boolean(userId), refresh);

  const { mine, open } = useMemo(() => {
    const bets = feed.data ?? [];
    return {
      mine: bets.filter((bet) => mySide(bet, userId) !== null),
      open: bets.filter((bet) => mySide(bet, userId) === null && bet.status === 'open'),
    };
  }, [feed.data, userId]);

  const firstName = profile?.display_name.split(' ')[0];

  return (
    <View className="flex-1 bg-ink-950">
      <ScreenGround />
      <SafeAreaView edges={['top']} className="flex-1">
        <ScrollView
          contentContainerClassName="px-gutter pb-10 pt-2"
          refreshControl={
            <RefreshControl
              refreshing={feed.refreshing}
              onRefresh={() => feed.reload()}
              tintColor={colors.brass['400']}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          <ContentWidth>
            <View className="mb-8 pt-6">
              <View className="mb-3 flex-row items-center justify-between">
                <Text className="font-display text-xs text-ink-600">
                  {greeting()}
                  {firstName ? `, ${firstName}` : ''}
                </Text>
                <DemoBadge />
              </View>
              <Title>Your action</Title>
              {!feed.loading && (
                <Text className="mt-3 text-sm text-ink-600">
                  {mine.length === 0
                    ? 'Nothing riding on you right now.'
                    : `${mine.length} live ${mine.length === 1 ? 'bet' : 'bets'}, ${open.length} you could still join.`}
                </Text>
              )}
            </View>

            {feed.error && <ErrorNotice message={feed.error} />}

            {feed.loading ? (
              <BetFeedSkeleton count={3} />
            ) : (
              <>
                <Panel title="Riding on you" className="mb-8">
                {mine.length === 0 ? (
                  <View>
                      <EmptyState
                        icon={<TicketIcon size={26} color={colors.ink['500']} />}
                        title="No live bets"
                        body="Pick a side on something below, or start one in a group."
                      />
                  </View>
                ) : (
                  <View>
                    {mine.map((bet, i) => (
                      <BetCard
                        key={bet.id}
                        bet={bet}
                        currentUserId={userId}
                        showGroup
                        index={i}
                      />
                    ))}
                  </View>
                )}
                </Panel>

                <Panel title="Open in your groups">
                {open.length === 0 ? (
                    <EmptyState
                      icon={<SparkIcon size={26} color={colors.ink['500']} />}
                      title="All caught up"
                      body="Nothing new to join right now. Post a bet and see who bites."
                    />
                ) : (
                  open.map((bet, i) => (
                    <BetCard key={bet.id} bet={bet} currentUserId={userId} showGroup index={i} />
                  ))
                )}
                </Panel>
              </>
            )}

            <View className="mt-12">
              <View className="h-px w-10 bg-ink-800" />
              <Text className="mt-4 text-xs leading-5 text-ink-650">
                Lotus Bet tracks obligations only. Settle up with your friends however you
                normally do.
              </Text>
            </View>
          </ContentWidth>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function greeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}
