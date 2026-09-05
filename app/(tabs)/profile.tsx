import { useCallback, useState } from 'react';
import { Alert, Platform, RefreshControl, ScrollView, Switch, Text, View } from 'react-native';
import Animated, { FadeInDown } from '@/components/animated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DemoBadge } from '@/components/demo-entry';
import { LogOutIcon, TrophyIcon } from '@/components/icons';
import { ContentWidth, ScreenBackdrop } from '@/components/screen';
import { ProfileSkeleton } from '@/components/skeletons';
import {
  Avatar,
  Button,
  Card,
  Divider,
  EmptySlot,
  EmptyState,
  ErrorNotice,
  InfoRow,
  Loading,
  Overline,
  SectionTitle,
  Stat,
  Title,
} from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { formatAgorot, formatShortDate } from '@/lib/format';
import { clearPushToken } from '@/lib/notifications';
import { fetchMyGroups, fetchMyHistory, fetchMyStats, type HistoryEntry } from '@/lib/queries';
import { useAuth } from '@/providers/auth-provider';
import { colors, motion } from '@/theme';

export default function ProfileScreen() {
  const { session, profile, updateProfile, signOut } = useAuth();
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

  return (
    <View className="flex-1 bg-ink-950">
      <ScreenBackdrop />
      <SafeAreaView edges={['top']} className="flex-1">
        <ScrollView
          contentContainerClassName="px-gutter pb-10 pt-2"
          refreshControl={
            <RefreshControl
              refreshing={stats.refreshing}
              onRefresh={refresh}
              tintColor={colors.brass['400']}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          <ContentWidth>
            <View className="mb-6 flex-row items-center gap-3 pt-4">
              <Title>Profile</Title>
              <DemoBadge />
            </View>

            {error && <ErrorNotice message={error} />}

            <Animated.View entering={FadeInDown.duration(motion.duration.base)}>
              <Card level="raised" className="mb-6 items-center py-7">
                <Avatar name={profile.display_name} id={profile.id} size={80} ring />
                <Text className="mt-4 font-display-bold text-xl text-ink-50">
                  {profile.display_name}
                </Text>
                <Text className="mt-1 text-sm text-ink-600">{profile.phone}</Text>

                <View className="mt-5 w-full flex-row items-center justify-center gap-2 border-t border-ink-750 pt-4">
                  <Overline>Lifetime net</Overline>
                  <Text
                    className={`font-display-bold text-base ${
                      net > 0 ? 'text-owed' : net < 0 ? 'text-owing' : 'text-ink-50'
                    }`}
                  >
                    {net === 0 ? '—' : formatAgorot(net, { sign: true })}
                  </Text>
                </View>
              </Card>
            </Animated.View>

            {stats.loading ? (
              <ProfileSkeleton />
            ) : (
              <Animated.View entering={FadeInDown.delay(60).duration(motion.duration.base)}>
                <SectionTitle>Your record</SectionTitle>
                <View className="mb-4 flex-row gap-3">
                  <Stat
                    label="Won"
                    value={formatAgorot(Number(s?.total_won_agorot ?? 0))}
                    tone="owed"
                  />
                  <Stat
                    label="Lost"
                    value={formatAgorot(Number(s?.total_lost_agorot ?? 0))}
                    tone="owing"
                  />
                  <Stat label="Win rate" value={winRate === null ? '—' : `${winRate}%`} />
                </View>

                <Card className="mb-7" padded={false}>
                  <View className="px-5">
                    <InfoRow label="Bets settled" value={String(s?.bets_settled ?? 0)} />
                    <InfoRow
                      label="Most active group"
                      value={mostActive ? `${mostActive.emoji ?? '🎲'} ${mostActive.name}` : '—'}
                      last
                    />
                  </View>
                </Card>
              </Animated.View>
            )}

            <SectionTitle>Notifications</SectionTitle>
            <Card className="mb-7" padded={false}>
              <View className="px-5">
                <ToggleRow
                  label="New bets in my groups"
                  hint="One push when someone posts."
                  value={profile.notify_new_bets}
                  disabled={saving}
                  onChange={(v) => void toggle('notify_new_bets', v)}
                />
                <Divider />
                <ToggleRow
                  label="Bets I joined resolving"
                  hint="Includes your result and amount."
                  value={profile.notify_resolutions}
                  disabled={saving}
                  onChange={(v) => void toggle('notify_resolutions', v)}
                  last
                />
              </View>
            </Card>

            <SectionTitle>Bet history</SectionTitle>
            {history.loading ? (
              <Loading label="Loading history…" />
            ) : (history.data ?? []).length === 0 ? (
              <View className="mb-7">
                <EmptySlot>
                  <EmptyState
                    icon={<TrophyIcon size={22} color={colors.brass['400']} />}
                    title="Nothing settled yet"
                    body="Once a bet you joined gets resolved it shows up here, win or lose."
                  />
                </EmptySlot>
              </View>
            ) : (
              <View className="mb-7">
                {(history.data ?? []).map((entry, i) => (
                  <HistoryRow key={entry.id} entry={entry} index={i} />
                ))}
              </View>
            )}

            <Button
              title="Sign out"
              variant="ghost"
              icon={<LogOutIcon size={16} color={colors.ink['500']} />}
              onPress={confirmSignOut}
            />

            <Text className="mt-7 text-center text-2xs leading-4 tracking-normal text-ink-650">
              Lotus Bet is a tracker. It holds no money, processes no payments,{'\n'}and sells no
              currency.
            </Text>
          </ContentWidth>
        </ScrollView>
      </SafeAreaView>
    </View>
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
  return (
    <View className={`flex-row items-center justify-between gap-4 py-3.5 ${last ? '' : ''}`}>
      <View className="flex-1">
        <Text className="text-sm text-ink-50">{label}</Text>
        <Text className="mt-0.5 text-xs text-ink-600">{hint}</Text>
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ false: colors.ink['750'], true: colors.brass['600'] }}
        thumbColor="#fff"
        ios_backgroundColor={colors.ink['750']}
      />
    </View>
  );
}

function HistoryRow({ entry, index }: { entry: HistoryEntry; index: number }) {
  const won = entry.amount_agorot > 0;
  const winningLabel =
    entry.bet.winning_option === 'a' ? entry.bet.option_a_label : entry.bet.option_b_label;

  return (
    <Animated.View
      entering={FadeInDown.delay(Math.min(index, 6) * motion.stagger).duration(
        motion.duration.base
      )}
    >
      <View className="mb-2.5 flex-row items-center gap-3.5 rounded-2xl border border-ink-800 bg-ink-900 p-4">
        <View
          className={`h-10 w-10 items-center justify-center rounded-2xl ${
            won ? 'bg-owed-shade' : 'bg-owing-shade'
          }`}
        >
          <TrophyIcon
            size={17}
            color={won ? colors.owed.DEFAULT : colors.owing.DEFAULT}
          />
        </View>

        <View className="flex-1">
          <Text numberOfLines={1} className="font-display text-sm text-ink-50">
            {entry.bet.title}
          </Text>
          <Text numberOfLines={1} className="mt-0.5 text-xs text-ink-600">
            {winningLabel} won in {entry.group.name}, {formatShortDate(entry.created_at)}
          </Text>
        </View>

        <Text className={`font-display-bold text-base ${won ? 'text-owed' : 'text-owing'}`}>
          {formatAgorot(entry.amount_agorot, { sign: true })}
        </Text>
      </View>
    </Animated.View>
  );
}
