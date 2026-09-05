import { useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  Text,
  View,
  useWindowDimensions,
  type ViewToken,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FeedCard } from '@/components/bet-card';
import { DemoBadge } from '@/components/demo-entry';
import { TicketIcon } from '@/components/icons';
import { ContentWidth, Screen } from '@/components/screen';
import { BetFeedSkeleton } from '@/components/skeletons';
import { Button, EmptyState, ErrorNotice } from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { useFeedRealtime } from '@/hooks/use-group-realtime';
import type { BetSide } from '@/lib/database.types';
import { fetchFeedBets, joinBet } from '@/lib/queries';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { useAuth } from '@/providers/auth-provider';
import { useColors } from '@/providers/theme-provider';

/**
 * The feed. One bet fills most of the screen, and scrolling is how you get to
 * the next one — the bet, not a summary of your week, is the thing the app is
 * for. Bets you have already joined lead, then everything else still open.
 *
 * Cards snap so a scroll always lands on a whole bet, and only the card on
 * screen plays its video.
 */
export default function FeedScreen() {
  const { session } = useAuth();
  const colors = useColors();
  const router = useRouter();
  const { height } = useWindowDimensions();
  const tabInset = useTabBarInset();
  const userId = session?.user.id ?? '';

  const feed = useAsync(fetchFeedBets, [userId]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ id: string; side: BetSide } | null>(null);

  // `feed` is a new object every render; `feed.reload` is stable.
  const { reload: reloadFeed } = feed;

  const refresh = useCallback(() => {
    void reloadFeed({ silent: true });
  }, [reloadFeed]);

  useFeedRealtime(Boolean(userId), refresh);

  // The card is most of the screen, not all of it: the sliver of the next one
  // is what tells you there is more below.
  const cardHeight = Math.max(360, height - tabInset - 96);
  const snapInterval = cardHeight + 16;

  const bets = useMemo(() => {
    const all = feed.data ?? [];
    const mine = all.filter((bet) => bet.positions?.some((p) => p.user_id === userId));
    const rest = all.filter((bet) => !bet.positions?.some((p) => p.user_id === userId));
    return [...mine, ...rest];
  }, [feed.data, userId]);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems[0];
    if (first?.item && typeof first.item === 'object' && 'id' in first.item) {
      setActiveId((first.item as { id: string }).id);
    }
  });

  async function pickSide(betId: string, side: BetSide) {
    setBusy({ id: betId, side });
    try {
      await joinBet(betId, side);
      await reloadFeed({ silent: true });
    } catch {
      // The realtime refresh will put the card back the way it really is.
      await reloadFeed({ silent: true });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen>
      <SafeAreaView edges={['top']} className="flex-1">
        <View className="flex-row items-center justify-between px-gutter pb-3 pt-1">
          <Text className="text-2xl font-bold text-primary">Feed</Text>
          <DemoBadge />
        </View>

        {feed.error && (
          <View className="px-gutter">
            <ErrorNotice message={feed.error} />
          </View>
        )}

        {feed.loading ? (
          <ContentWidth className="px-gutter">
            <BetFeedSkeleton cardHeight={cardHeight} />
          </ContentWidth>
        ) : bets.length === 0 ? (
          <ContentWidth className="flex-1 justify-center px-gutter">
            <EmptyState
              icon={<TicketIcon size={26} color={colors.textSecondary} />}
              title="Nothing running"
              body="Bets your friends post show up here. Start one in a group and see who bites."
              action={
                <Button
                  title="Go to groups"
                  variant="tinted"
                  onPress={() => router.push('/(tabs)/groups')}
                />
              }
            />
          </ContentWidth>
        ) : (
          <FlatList
            data={bets}
            keyExtractor={(bet) => bet.id}
            // A snap interval of exactly one card means a flick always lands on
            // a whole bet rather than halfway between two.
            snapToInterval={snapInterval}
            decelerationRate="fast"
            snapToAlignment="start"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: tabInset, paddingHorizontal: 20 }}
            onViewableItemsChanged={onViewableItemsChanged.current}
            viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
            refreshControl={
              <RefreshControl
                refreshing={feed.refreshing}
                onRefresh={() => feed.reload()}
                tintColor={colors.textTertiary}
              />
            }
            renderItem={({ item }) => (
              <ContentWidth className="mb-4">
                <FeedCard
                  bet={item}
                  currentUserId={userId}
                  height={cardHeight}
                  active={activeId === item.id}
                  onPickSide={(side) => pickSide(item.id, side)}
                  busySide={busy?.id === item.id ? busy.side : null}
                />
              </ContentWidth>
            )}
            ListFooterComponent={
              <ContentWidth className="items-center pb-2 pt-4">
                <Text className="max-w-[300px] text-center text-xs leading-4 text-tertiary">
                  Lotus Bet tracks obligations only. Settle up with your friends however you
                  normally do.
                </Text>
              </ContentWidth>
            }
          />
        )}
      </SafeAreaView>
    </Screen>
  );
}
