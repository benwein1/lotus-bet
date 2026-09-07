import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  Text,
  View,
  useWindowDimensions,
  type ViewToken,
} from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from '@/components/animated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FeedCard } from '@/components/bet-card';
import { BetSuggestions } from '@/components/bet-suggestions';
import { DemoBadge } from '@/components/demo-entry';
import { ChevronUpIcon } from '@/components/icons';
import { ContentWidth, Screen } from '@/components/screen';
import { BetFeedSkeleton } from '@/components/skeletons';
import { ErrorNotice, PressableScale, tap } from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { useFeedRealtime } from '@/hooks/use-group-realtime';
import { isNewSince, useLastSeen } from '@/hooks/use-last-seen';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import type { BetSide, BetWithPositions } from '@/lib/database.types';
import { fetchFeedBets, fetchMyGroups, joinBet } from '@/lib/queries';
import { useAuth } from '@/providers/auth-provider';
import { useColors } from '@/providers/theme-provider';
import { motion } from '@/theme';

/**
 * The feed. One bet fills most of the screen, and scrolling is how you get to
 * the next one — the bet, not a summary of your week, is the thing the app is
 * for. Bets you have already joined lead, then everything else still open.
 *
 * Cards snap so a scroll always lands on a whole bet, and only the card on
 * screen plays its video.
 *
 * Two things stop the feed being a wall you scroll once:
 *
 * - Anything posted since your last visit is marked, and a pill at the top
 *   says how many there are and takes you back to them.
 * - Reaching the end is not a dead stop. The bottom of the feed offers bets
 *   you could post into your own groups, so "nothing left to read" turns into
 *   "here is something to start".
 */
export default function FeedScreen() {
  const { session } = useAuth();
  const colors = useColors();
  const { height } = useWindowDimensions();
  const tabInset = useTabBarInset();
  const reduced = useReducedMotion();
  const userId = session?.user.id ?? '';

  const feed = useAsync(fetchFeedBets, [userId]);
  const groups = useAsync(fetchMyGroups, [userId]);
  const { since } = useLastSeen();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ id: string; side: BetSide } | null>(null);
  const [scrolledAway, setScrolledAway] = useState(false);
  const listRef = useRef<FlatList<BetWithPositions>>(null);

  // `feed` is a new object every render; `feed.reload` is stable.
  const { reload: reloadFeed } = feed;
  const { reload: reloadGroups } = groups;

  const refresh = useCallback(() => {
    void reloadFeed({ silent: true });
    void reloadGroups({ silent: true });
  }, [reloadFeed, reloadGroups]);

  useFeedRealtime(Boolean(userId), refresh);

  // Tab screens stay mounted, so without this the feed would still be showing
  // whatever it loaded at launch — a bet you just posted would not appear
  // until you pulled to refresh. Realtime covers other people's changes; this
  // covers your own.
  useFocusEffect(refresh);

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

  const newCount = useMemo(
    () => bets.filter((bet) => isNewSince(bet.created_at, since, bet.creator_id, userId)).length,
    [bets, since, userId]
  );

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems[0];
    if (first?.item && typeof first.item === 'object' && 'id' in first.item) {
      setActiveId((first.item as { id: string }).id);
    }
    // Anything past the first card counts as "away from the top".
    setScrolledAway((first?.index ?? 0) > 0);
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

  const myGroups = groups.data ?? [];

  return (
    <Screen>
      <SafeAreaView edges={['top']} className="flex-1">
        {/* No screen title. The tab bar already says where you are, and the
            bet is meant to be the first thing on the screen. The demo badge
            sits in a row that collapses to nothing when it renders null. */}
        <View className="items-end px-gutter pt-1">
          <DemoBadge />
        </View>

        {feed.error && (
          <View className="px-gutter">
            <ErrorNotice message={feed.error} />
          </View>
        )}

        {feed.loading ? (
          <ContentWidth className="px-gutter pt-2">
            <BetFeedSkeleton cardHeight={cardHeight} />
          </ContentWidth>
        ) : bets.length === 0 ? (
          <ContentWidth className="flex-1 justify-center px-gutter">
            {/* An empty feed used to be a sentence and a button to another
                tab. Somebody with no bets does not need to be told they have
                no bets — they need one to post. */}
            <BetSuggestions
              groups={myGroups}
              count={3}
              heading="Nothing running yet"
              subheading="Pick one to get started, or write your own. Everything stays editable."
            />
          </ContentWidth>
        ) : (
          <>
            <FlatList
              ref={listRef}
              data={bets}
              keyExtractor={(bet) => bet.id}
              // A snap interval of exactly one card means a flick always lands
              // on a whole bet rather than halfway between two.
              snapToInterval={snapInterval}
              decelerationRate="fast"
              snapToAlignment="start"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{
                paddingTop: 8,
                paddingBottom: tabInset,
                paddingHorizontal: 20,
              }}
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
                    isNew={isNewSince(item.created_at, since, item.creator_id, userId)}
                    onPickSide={(side) => pickSide(item.id, side)}
                    busySide={busy?.id === item.id ? busy.side : null}
                  />
                </ContentWidth>
              )}
              ListFooterComponent={
                <ContentWidth className="pb-2 pt-6">
                  {/* The end of the feed is where people leave. Giving it
                      something to do is worth more than a full stop. */}
                  <BetSuggestions
                    groups={myGroups}
                    count={2}
                    heading="That's everything"
                    subheading="You're caught up. Start one of these in your groups and give them something to argue about."
                  />

                  <Text className="mt-8 text-center text-xs leading-4 text-tertiary">
                    Lotus Bet tracks obligations only. Settle up with your friends however you
                    normally do.
                  </Text>
                </ContentWidth>
              }
            />

            {/* Back to the top, and how much you missed. Only once there is
                somewhere to go back to. */}
            {scrolledAway && (
              <Animated.View
                entering={reduced ? FadeIn.duration(motion.duration.fast) : FadeInDown.duration(220)}
                exiting={FadeOut.duration(140)}
                pointerEvents="box-none"
                className="absolute inset-x-0 top-0 items-center pt-2"
              >
                <PressableScale
                  scaleTo={0.94}
                  onPress={() => {
                    tap();
                    listRef.current?.scrollToOffset({ offset: 0, animated: true });
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={
                    newCount > 0
                      ? `${newCount} new ${newCount === 1 ? 'bet' : 'bets'}, back to the top`
                      : 'Back to the top'
                  }
                  className="flex-row items-center gap-1.5 rounded-full border border-chrome-edge bg-accent px-3.5 py-2"
                >
                  <ChevronUpIcon size={15} color={colors.accentInk} />
                  <Text className="text-sm font-semibold text-accent-ink">
                    {newCount > 0
                      ? `${newCount} new ${newCount === 1 ? 'bet' : 'bets'}`
                      : 'Back to top'}
                  </Text>
                </PressableScale>
              </Animated.View>
            )}
          </>
        )}
      </SafeAreaView>
    </Screen>
  );
}
