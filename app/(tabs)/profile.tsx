import { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, Switch, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from '@/components/animated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DemoBadge } from '@/components/demo-entry';
import { LogOutIcon, TrophyIcon } from '@/components/icons';
import { ContentWidth, Screen } from '@/components/screen';
import { ProfileSkeleton } from '@/components/skeletons';
import {
  Avatar,
  Button,
  EmptyState,
  ErrorNotice,
  ListGroup,
  Loading,
  Money,
  Row,
  SectionTitle,
  Segmented,
  Stat,
  Title,
} from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { formatAgorot, formatShortDate } from '@/lib/format';
import { clearPushToken } from '@/lib/notifications';
import { fetchMyGroups, fetchMyHistory, fetchMyStats, type HistoryEntry } from '@/lib/queries';
import { useAuth } from '@/providers/auth-provider';
import { useAppearance, useColors } from '@/providers/theme-provider';
import { motion } from '@/theme';

export default function ProfileScreen() {
  const { session, profile, updateProfile, signOut } = useAuth();
  const colors = useColors();
  const reduced = useReducedMotion();
  const tabInset = useTabBarInset();
  const { preference, setPreference } = useAppearance();
  const userId = session?.user.id ?? '';

  const stats = useAsync(fetchMyStats, [userId]);
  const history = useAsync(() => fetchMyHistory(userId), [userId]);
  const groups = useAsync(fetchMyGroups, [userId]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { reload: reloadStats } = stats;
  const { reload: reloadHistory } = history;

  const refresh = useCallback(() => {
    void reloadStats({ silent: true });
    void reloadHistory({ silent: true });
  }, [reloadStats, reloadHistory]);

  async function toggle(key: 'notify_new_bets' | 'notify_resolutions', value: boolean) {
    setError(null);
    setSaving(true);
    try {
      await updateProfile({ [key]: value });

      // If both switches are off there is nothing left to push, so drop the
      // token rather than keep a stale one on the row.
      const newBets = key === 'notify_new_bets' ? value : profile?.notify_new_bets;
      const resolutions = key === 'notify_resolutions' ? value : profile?.notify_resolutions;
      if (!newBets && !resolutions) await clearPushToken();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that setting.');
    } finally {
      setSaving(false);
    }
  }

  function confirmSignOut() {
    Alert.alert('Sign out?', 'Your bets and balances stay exactly where they are.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);
  }

  if (!profile) return <Loading label="Loading your profile…" />;

  const s = stats.data;
  const decided = (s?.bets_won ?? 0) + (s?.bets_lost ?? 0);
  const winRate = decided > 0 ? Math.round(((s?.bets_won ?? 0) / decided) * 100) : null;
  const mostActive = (groups.data ?? []).find((g) => g.id === s?.most_active_group_id);
  const net = Number(s?.total_won_agorot ?? 0) - Number(s?.total_lost_agorot ?? 0);

  const entering = (delay: number) =>
    reduced
      ? FadeIn.duration(motion.duration.fast)
      : FadeInDown.delay(delay).duration(motion.duration.base);

  return (
    <Screen ground="sunken">
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
            <View className="mb-6 flex-row items-center justify-between pt-4">
              <Title>You</Title>
              <DemoBadge />
            </View>

            {error && <ErrorNotice message={error} />}

            <Animated.View entering={entering(0)}>
              <View className="mb-7 items-center rounded-3xl border border-hairline bg-surface px-5 py-7">
                <Avatar name={profile.display_name} id={profile.id} size={72} />
                <Text numberOfLines={1} className="mt-3.5 text-xl font-bold text-primary">
                  {profile.display_name}
                </Text>
                <Text numberOfLines={1} className="mt-0.5 text-subhead text-secondary">
                  {profile.email ?? profile.phone ?? ''}
                </Text>

                <View className="mt-6 items-center">
                  <Text className="text-sm text-secondary">Lifetime net</Text>
                  <View className="mt-1">
                    {net === 0 ? (
                      <Text className="text-4xl font-bold text-primary">Even</Text>
                    ) : (
                      <Money agorot={net} size="xl" sign />
                    )}
                  </View>
                </View>
              </View>
            </Animated.View>

            {stats.loading ? (
              <ProfileSkeleton />
            ) : (
              <Animated.View entering={entering(60)} className="mb-7">
                <SectionTitle>Your record</SectionTitle>
                <View className="flex-row gap-3">
                  <Stat
                    label="Won"
                    value={formatAgorot(Number(s?.total_won_agorot ?? 0))}
                    tone="positive"
                  />
                  <Stat
                    label="Lost"
                    value={formatAgorot(Number(s?.total_lost_agorot ?? 0))}
                    tone="negative"
                  />
                  <Stat label="Win rate" value={winRate === null ? '—' : `${winRate}%`} />
                </View>

                <ListGroup className="mt-3">
                  <Row label="Bets settled" value={String(s?.bets_settled ?? 0)} />
                  <Row
                    label="Most active group"
                    value={mostActive ? `${mostActive.emoji ?? '🎲'} ${mostActive.name}` : '—'}
                    last
                  />
                </ListGroup>
              </Animated.View>
            )}

            <View className="mb-7">
              <SectionTitle>Appearance</SectionTitle>
              <View className="rounded-2xl border border-hairline bg-surface p-3">
                <Segmented
                  value={preference}
                  onChange={setPreference}
                  options={[
                    { value: 'system', label: 'System' },
                    { value: 'light', label: 'Light' },
                    { value: 'dark', label: 'Dark' },
                  ]}
                />
                <Text className="mt-2.5 px-1 text-sm text-secondary">
                  System follows your device between light and dark.
                </Text>
              </View>
            </View>

            <View className="mb-7">
              <SectionTitle>Notifications</SectionTitle>
              <ListGroup>
                <ToggleRow
                  label="New bets in my groups"
                  hint="One push when someone posts."
                  value={profile.notify_new_bets}
                  disabled={saving}
                  onChange={(v) => void toggle('notify_new_bets', v)}
                />
                <ToggleRow
                  label="Bets I joined resolving"
                  hint="Includes your result and amount."
                  value={profile.notify_resolutions}
                  disabled={saving}
                  onChange={(v) => void toggle('notify_resolutions', v)}
                  last
                />
              </ListGroup>
            </View>

            <View className="mb-7">
              <SectionTitle>Bet history</SectionTitle>
              {history.loading ? (
                <Loading label="Loading history…" />
              ) : (history.data ?? []).length === 0 ? (
                <View className="rounded-3xl border border-hairline bg-surface">
                  <EmptyState
                    icon={<TrophyIcon size={26} color={colors.textSecondary} />}
                    title="Nothing settled yet"
                    body="Once a bet you joined gets resolved it shows up here, win or lose."
                  />
                </View>
              ) : (
                <View className="overflow-hidden rounded-3xl border border-hairline bg-surface">
                  {(history.data ?? []).map((entry, i) => (
                    <HistoryRow
                      key={entry.id}
                      entry={entry}
                      index={i}
                      last={i === (history.data ?? []).length - 1}
                    />
                  ))}
                </View>
              )}
            </View>

            <Button
              title="Sign out"
              variant="destructive"
              icon={<LogOutIcon size={16} color={colors.negative} />}
              onPress={confirmSignOut}
            />

            <Text className="mt-7 text-center text-xs leading-4 text-tertiary">
              Lotus Bet is a tracker. It holds no money, processes no payments, and sells no
              currency.
            </Text>
          </ContentWidth>
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

function ToggleRow({
  label,
  hint,
  value,
  disabled,
  onChange,
  last = false,
}: {
  label: string;
  hint: string;
  value: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
  last?: boolean;
}) {
  const colors = useColors();

  return (
    <View>
      <View className="flex-row items-center justify-between gap-4 px-4 py-3">
        <View className="flex-1">
          <Text className="text-base text-primary">{label}</Text>
          <Text className="mt-0.5 text-sm text-secondary">{hint}</Text>
        </View>
        <Switch
          value={value}
          disabled={disabled}
          onValueChange={onChange}
          trackColor={{ false: colors.surface3, true: colors.accent }}
          thumbColor="#FFFFFF"
          ios_backgroundColor={colors.surface3}
        />
      </View>
      {!last && <View className="ml-4 h-px bg-hairline" />}
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
