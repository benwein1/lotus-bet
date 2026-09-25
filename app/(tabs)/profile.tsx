import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown } from '@/components/animated';

import { AvatarPicker } from '@/components/avatar-picker';
import { BetGrid } from '@/components/bet-grid';
import { DemoBadge } from '@/components/demo-entry';
import { SettingsIcon } from '@/components/icons';
import { NetChart } from '@/components/net-chart';
import { ContentWidth, Screen } from '@/components/screen';
import { ProfileSkeleton } from '@/components/skeletons';
import { StatsSheet } from '@/components/stats-sheet';
import { UnderlineTabs } from '@/components/underline-tabs';
import {
  Avatar,
  ErrorNotice,
  ListGroup,
  Loading,
  Money,
  PressableScale,
  SectionTitle,
} from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { APP_NAME } from '@/lib/legal';
import { formatShortDate } from '@/lib/format';
import { buildSeries, dominantCurrency } from '@/lib/profile-chart';
import {
  fetchBetsIJoined,
  fetchMyBets,
  fetchMyHistory,
  fetchMyPersonBalances,
  fetchMyStats,
  fetchMyTotalsByCurrency,
  type HistoryEntry,
} from '@/lib/queries';
import type { PersonBalance } from '@/lib/database.types';
import { useAuth } from '@/providers/auth-provider';
import { useColors } from '@/providers/theme-provider';
import { motion } from '@/theme';

/** How far the chart stops short of the screen edge. */
const CHART_BREATH = 6;

type TabKey = 'started' | 'joined' | 'settled';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'started', label: 'Started' },
  { key: 'joined', label: 'Joined' },
  { key: 'settled', label: 'Settled' },
];

/**
 * You.
 *
 * Who you are, how you are doing, and what you have bet — and nothing about
 * how the app works. Appearance, notifications, blocked people, the legal
 * documents, sign out and delete all moved behind the control at the top
 * right, because a profile is a page you would show someone and a screen with
 * "Delete account" on it is not.
 *
 * The chart is the whole hero: one line, your running total, and pressing it
 * anywhere opens the detail. It is drawn from the same ledger rows the figures
 * beside it are summed from, so the picture and the number cannot disagree.
 */
export default function ProfileScreen() {
  const { session, profile, updateProfile } = useAuth();
  const colors = useColors();
  const router = useRouter();
  const reduced = useReducedMotion();
  const tabInset = useTabBarInset();
  const { width } = useWindowDimensions();
  const userId = session?.user.id ?? '';

  const stats = useAsync(fetchMyStats, [userId]);
  const totals = useAsync(fetchMyTotalsByCurrency, [userId]);
  const history = useAsync(() => fetchMyHistory(userId), [userId]);
  const owed = useAsync(() => fetchMyPersonBalances(userId), [userId]);
  const mine = useAsync(() => fetchMyBets(userId), [userId]);
  const joined = useAsync(() => fetchBetsIJoined(userId), [userId]);

  const [tab, setTab] = useState<TabKey>('started');
  const [statsOpen, setStatsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { reload: reloadStats } = stats;
  const { reload: reloadHistory } = history;
  const { reload: reloadOwed } = owed;
  const { reload: reloadMine } = mine;
  const { reload: reloadJoined } = joined;

  const refresh = useCallback(() => {
    void reloadStats({ silent: true });
    void reloadHistory({ silent: true });
    void reloadOwed({ silent: true });
    void reloadMine({ silent: true });
    void reloadJoined({ silent: true });
  }, [reloadStats, reloadHistory, reloadOwed, reloadMine, reloadJoined]);

  useFocusEffect(refresh);

  const entries = useMemo(
    () =>
      (history.data ?? []).map((entry) => ({
        amountAgorot: Number(entry.amount_agorot),
        at: entry.created_at,
        currency: entry.group?.currency ?? null,
      })),
    [history.data]
  );

  const currency = useMemo(() => dominantCurrency(entries), [entries]);
  const series = useMemo(() => buildSeries(entries, currency), [entries, currency]);

  if (!profile) return <Loading label="Loading your profile…" />;

  const entering = (delay: number) =>
    reduced
      ? FadeIn.duration(motion.duration.fast)
      : FadeInDown.delay(delay).duration(motion.duration.base);

  // The chart is drawn edge to edge inside the gutter.
  /**
   * The chart runs nearly edge to edge, not inside the page's gutter.
   *
   * Everything else on this screen is a line of type that wants a margin to
   * read against. A chart is a shape, and 20pt of air either side of it is
   * 40pt of the one thing on the page that gets better with width. It keeps a
   * 6pt breath so the line never touches the bezel, and the block it sits in
   * cancels the gutter to get there.
   */
  const chartWidth = Math.max(240, Math.min(width, 560) - CHART_BREATH * 2);

  return (
    <Screen>
      <SafeAreaView edges={['top']} className="flex-1">
        <ScrollView
          contentContainerStyle={{ paddingBottom: tabInset }}
          contentContainerClassName="px-gutter pt-2"
          refreshControl={
            <RefreshControl
              refreshing={stats.refreshing}
              onRefresh={refresh}
              tintColor={colors.textTertiary}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          <ContentWidth>
            <View className="h-11 flex-row items-center justify-end gap-3 pt-1">
              <DemoBadge />
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Settings"
                onPress={() => router.push('/settings')}
                className="h-10 w-10 items-center justify-center rounded-full"
              >
                <SettingsIcon size={23} color={colors.textSecondary} />
              </PressableScale>
            </View>

            {error && <ErrorNotice message={error} />}

            <Animated.View entering={entering(0)}>
              <View className="mt-2 flex-row items-center gap-3">
                <AvatarPicker
                  name={profile.display_name}
                  id={profile.id}
                  uri={profile.avatar_url}
                  size={44}
                  owner={{ kind: 'users', id: profile.id }}
                  onChange={(url) => updateProfile({ avatar_url: url })}
                />
                <View className="min-w-0 flex-1">
                  <Text
                    numberOfLines={1}
                    className="text-base font-bold tracking-[-0.2px] text-primary"
                  >
                    {profile.display_name}
                  </Text>
                  {/* The handle is the one thing people need *from* you — it
                      is how somebody challenges you without sharing a group. */}
                  {profile.username ? (
                    <Text numberOfLines={1} className="mt-0.5 text-sm font-semibold text-accent">
                      @{profile.username}
                    </Text>
                  ) : null}
                </View>
              </View>

              <View className="mt-5 flex-row items-baseline gap-2.5">
                <Money agorot={series.net} currency={series.currency} size="net" sign />
                {series.recent !== 0 && (
                  <Text
                    className={`text-sm ${series.recent > 0 ? 'text-positive' : 'text-negative'}`}
                  >
                    {series.recent > 0 ? '+' : '−'}
                    {Math.abs(series.recent / 100).toFixed(0)} in the last 30 days
                  </Text>
                )}
              </View>
              {/* Only when an account genuinely plays in more than one. A
                  currency line on every profile would be noise; without it, an
                  account with two would read one of them as the whole story. */}
              {(totals.data ?? []).filter((t) => t.netAgorot !== 0).length > 1 && (
                <Text className="mt-1 text-xs text-tertiary">
                  in {series.currency} — see all stats for the rest
                </Text>
              )}

              {/* Out past the gutter. `-mx-gutter` cancels the screen's own
                  padding, and the breath is added back. */}
              <View className="-mx-gutter mt-3" style={{ paddingHorizontal: CHART_BREATH }}>
                <NetChart
                  series={series}
                  width={chartWidth}
                  onPress={() => setStatsOpen(true)}
                  label="Open your full statistics"
                />
              </View>
            </Animated.View>

            <View className="mt-[18px]">
              <UnderlineTabs tabs={TABS} value={tab} onChange={setTab} variant="even" />
            </View>

            <View className="mt-4">
              {tab === 'started' &&
                (mine.loading ? (
                  <ProfileSkeleton />
                ) : (
                  // Authorship, not participation: a bet you created and never
                  // took a side on is still yours, and this is the only screen
                  // that says so.
                  <BetGrid bets={mine.data ?? []} />
                ))}

              {tab === 'joined' &&
                (joined.loading ? <ProfileSkeleton /> : <BetGrid bets={joined.data ?? []} />)}

              {tab === 'settled' && (
                <>
                  <PeopleLedger
                    people={owed.data ?? []}
                    loading={owed.loading}
                    entering={entering(0)}
                  />
                  <View className="mt-7">
                    <SectionTitle>Bet history</SectionTitle>
                    {history.loading ? (
                      <Loading label="Loading history…" />
                    ) : (history.data ?? []).length === 0 ? (
                      <View className="rounded-3xl border border-hairline bg-surface px-5 py-6">
                        <Text className="text-callout leading-5 text-secondary">
                          Nothing settled yet. Once a bet you joined gets called, it lands here.
                        </Text>
                      </View>
                    ) : (
                      <View className="overflow-hidden rounded-3xl border border-hairline bg-surface">
                        {(history.data ?? []).map((entry, i, all) => (
                          <HistoryRow
                            key={entry.id}
                            entry={entry}
                            index={i}
                            last={i === all.length - 1}
                          />
                        ))}
                      </View>
                    )}
                  </View>
                </>
              )}
            </View>

            <Text className="mt-9 text-center text-xs leading-4 text-tertiary">
              Betta is a tracker. It holds no money, processes no payments, and sells no currency.
            </Text>
          </ContentWidth>
        </ScrollView>
      </SafeAreaView>

      <StatsSheet
        open={statsOpen}
        onClose={() => setStatsOpen(false)}
        stats={stats.data}
        series={series}
        totals={totals.data ?? []}
      />
    </Screen>
  );
}

/**
 * Who you owe, and who owes you — netted across every group.
 *
 * Two lists rather than one, because the two directions are read completely
 * differently: what you are owed is news, what you owe is a to-do. Mixing them
 * into one signed column makes you parse a minus sign to find out which is
 * which.
 *
 * The figures are the same ones settle-up would quote, computed by the same
 * `simplifyDebts`. They can move when somebody else settles, because who pays
 * whom is a suggestion the netting makes, not a debt anyone recorded — the
 * ledger only ever stores a balance per person per group.
 */
function PeopleLedger({
  people,
  loading,
  entering,
}: {
  people: PersonBalance[];
  loading: boolean;
  entering: ReturnType<typeof FadeInDown.duration> | undefined;
}) {
  const owedToYou = people.filter((p) => p.amountAgorot > 0);
  const youOwe = people.filter((p) => p.amountAgorot < 0);

  if (loading) {
    return (
      <View className="mb-7">
        <SectionTitle>Who owes who</SectionTitle>
        <Loading label="Working out the balances…" />
      </View>
    );
  }

  if (people.length === 0) {
    return (
      <Animated.View entering={entering} className="mb-7">
        <SectionTitle>Who owes who</SectionTitle>
        <View className="rounded-3xl border border-hairline bg-surface px-6 py-7">
          <Text className="text-center text-subhead leading-5 text-secondary">
            You&apos;re square with everyone. Nothing outstanding in any of your groups.
          </Text>
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View entering={entering} className="mb-7">
      <SectionTitle>Who owes who</SectionTitle>

      {owedToYou.length > 0 && (
        <>
          <Text className="mb-2 px-1 text-sm text-secondary">Owes you</Text>
          <ListGroup className="mb-4">
            {owedToYou.map((person, index) => (
              <PersonRow
                key={person.user.id}
                person={person}
                last={index === owedToYou.length - 1}
              />
            ))}
          </ListGroup>
        </>
      )}

      {youOwe.length > 0 && (
        <>
          <Text className="mb-2 px-1 text-sm text-secondary">You owe</Text>
          <ListGroup>
            {youOwe.map((person, index) => (
              <PersonRow
                key={person.user.id}
                person={person}
                last={index === youOwe.length - 1}
              />
            ))}
          </ListGroup>
        </>
      )}

      <Text className="mt-2.5 px-1 text-sm text-tertiary">
        {APP_NAME} never moves money. Settle up however you already do.
      </Text>
    </Animated.View>
  );
}

function PersonRow({ person, last }: { person: PersonBalance; last: boolean }) {
  return (
    <View
      className={`flex-row items-center gap-3 px-4 py-3 ${
        last ? '' : 'border-b border-hairline'
      }`}
    >
      <Avatar
        id={person.user.id}
        name={person.user.display_name}
        uri={person.user.avatar_url}
        size={34}
      />
      <View className="flex-1">
        <Text numberOfLines={1} className="text-callout font-semibold text-primary">
          {person.user.display_name}
        </Text>
        <Text numberOfLines={1} className="text-sm text-secondary">
          {person.groupNames.join(', ')}
        </Text>
      </View>
      <Money
        agorot={Math.abs(person.amountAgorot)}
        currency={person.currency}
        tone={person.amountAgorot > 0 ? 'positive' : 'negative'}
      />
    </View>
  );
}

function HistoryRow({
  entry,
  index,
  last,
}: {
  entry: HistoryEntry;
  index: number;
  last: boolean;
}) {
  const reduced = useReducedMotion();
  const winningLabel =
    entry.bet.winning_option === 'a' ? entry.bet.option_a_label : entry.bet.option_b_label;

  return (
    <Animated.View
      entering={
        reduced
          ? FadeIn.duration(motion.duration.fast)
          : FadeInDown.delay(Math.min(index, 6) * motion.stagger).duration(motion.duration.base)
      }
    >
      <View className="flex-row items-start gap-4 px-4 py-3.5">
        <View className="flex-1">
          <Text numberOfLines={2} className="text-subhead text-primary">
            {entry.bet.title}
          </Text>
          <Text numberOfLines={1} className="mt-0.5 text-sm text-secondary">
            {winningLabel} won in {entry.group.name}, {formatShortDate(entry.created_at)}
          </Text>
        </View>
        <Money agorot={entry.amount_agorot} size="sm" sign />
      </View>
      {!last && <View className="ml-4 h-px bg-hairline" />}
    </Animated.View>
  );
}
