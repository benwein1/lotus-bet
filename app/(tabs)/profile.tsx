import { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, Switch, Text, View } from 'react-native';

import { Avatar, Button, Card, EmptyState, ErrorNotice, Loading, SectionTitle } from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { formatAgorot, formatShortDate } from '@/lib/format';
import { clearPushToken } from '@/lib/notifications';
import { fetchMyGroups, fetchMyHistory, fetchMyStats, type HistoryEntry } from '@/lib/queries';
import { useAuth } from '@/providers/auth-provider';
import { colors } from '@/theme';

export default function ProfileScreen() {
  const { session, profile, updateProfile, signOut } = useAuth();
  const userId = session?.user.id ?? '';

  const stats = useAsync(fetchMyStats, [userId]);
  const history = useAsync(() => fetchMyHistory(userId), [userId]);
  const groups = useAsync(fetchMyGroups, [userId]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void stats.reload({ silent: true });
    void history.reload({ silent: true });
  }, [stats, history]);

  async function toggle(
    key: 'notify_new_bets' | 'notify_resolutions',
    value: boolean
  ) {
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

  return (
    <ScrollView
      className="flex-1 bg-ink-950"
      contentContainerClassName="px-4 pb-12 pt-4"
      refreshControl={
        <RefreshControl refreshing={stats.refreshing} onRefresh={refresh} tintColor={colors.lotus['500']} />
      }
    >
      <Card className="mb-5 items-center py-6">
        <Avatar name={profile.display_name} size={72} />
        <Text className="mt-3 text-xl font-bold text-white">{profile.display_name}</Text>
        <Text className="mt-0.5 text-sm text-ink-600">{profile.phone}</Text>
      </Card>

      {error && <ErrorNotice message={error} />}

      <SectionTitle>Your record</SectionTitle>
      <View className="mb-5 flex-row gap-3">
        <StatTile label="Won" value={formatAgorot(Number(s?.total_won_agorot ?? 0))} tone="owed" />
        <StatTile label="Lost" value={formatAgorot(Number(s?.total_lost_agorot ?? 0))} tone="owing" />
        <StatTile label="Win rate" value={winRate === null ? '—' : `${winRate}%`} />
      </View>

      <Card className="mb-5">
        <View className="flex-row justify-between py-1">
          <Text className="text-sm text-ink-600">Bets settled</Text>
          <Text className="text-sm font-semibold text-white">{s?.bets_settled ?? 0}</Text>
        </View>
        <View className="flex-row items-center justify-between gap-4 py-1">
          <Text className="text-sm text-ink-600">Most active group</Text>
          <Text numberOfLines={1} className="flex-1 text-right text-sm font-semibold text-white">
            {mostActive ? `${mostActive.emoji ?? '🎲'} ${mostActive.name}` : '—'}
          </Text>
        </View>
      </Card>

      <SectionTitle>Notifications</SectionTitle>
      <Card className="mb-5">
        <ToggleRow
          label="New bets in my groups"
          value={profile.notify_new_bets}
          disabled={saving}
          onChange={(v) => void toggle('notify_new_bets', v)}
        />
        <ToggleRow
          label="Bets I joined getting resolved"
          value={profile.notify_resolutions}
          disabled={saving}
          onChange={(v) => void toggle('notify_resolutions', v)}
        />
        <Text className="mt-2 text-2xs leading-4 text-ink-600">
          We never notify on every join — that gets noisy fast in an active group.
        </Text>
      </Card>

      <SectionTitle>Bet history</SectionTitle>
      {history.loading ? (
        <Loading label="Loading history…" />
      ) : (history.data ?? []).length === 0 ? (
        <View className="mb-5 rounded-3xl border border-dashed border-ink-700 bg-ink-900/40">
          <EmptyState
            emoji="📜"
            title="Nothing settled yet"
            body="Once a bet you joined gets resolved it shows up here, win or lose."
          />
        </View>
      ) : (
        <View className="mb-5">
          {(history.data ?? []).map((entry) => (
            <HistoryRow key={entry.id} entry={entry} />
          ))}
        </View>
      )}

      <Button title="Sign out" variant="ghost" onPress={confirmSignOut} />

      <Text className="mt-6 text-center text-2xs leading-4 text-ink-600">
        Lotus Bet is a tracker. It holds no money, processes no payments, and sells no currency.
      </Text>
    </ScrollView>
  );
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'owed' | 'owing';
}) {
  const color = tone === 'owed' ? 'text-owed' : tone === 'owing' ? 'text-owing' : 'text-white';

  return (
    <View className="flex-1 rounded-3xl border border-ink-700/70 bg-ink-900 px-3 py-4">
      <Text className="text-2xs uppercase tracking-wider text-ink-600">{label}</Text>
      <Text numberOfLines={1} className={`mt-1 text-lg font-bold ${color}`}>
        {value}
      </Text>
    </View>
  );
}

function ToggleRow({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View className="flex-row items-center justify-between py-2">
      <Text className="flex-1 pr-3 text-sm text-white">{label}</Text>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ false: colors.ink['700'], true: colors.lotus['600'] }}
        thumbColor="#fff"
      />
    </View>
  );
}

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const won = entry.amount_agorot > 0;
  const winningLabel =
    entry.bet.winning_option === 'a' ? entry.bet.option_a_label : entry.bet.option_b_label;

  return (
    <View className="mb-2 flex-row items-center gap-3 rounded-3xl border border-ink-700/70 bg-ink-900 p-3">
      <View
        className={`h-9 w-9 items-center justify-center rounded-full ${
          won ? 'bg-owed/15' : 'bg-owing/15'
        }`}
      >
        <Text className="text-base">{won ? '🏆' : '💸'}</Text>
      </View>

      <View className="flex-1">
        <Text numberOfLines={1} className="text-sm font-semibold text-white">
          {entry.bet.title}
        </Text>
        <Text numberOfLines={1} className="text-2xs text-ink-600">
          {entry.group.emoji ?? '🎲'} {entry.group.name} · {winningLabel} won ·{' '}
          {formatShortDate(entry.created_at)}
        </Text>
      </View>

      <Text className={`text-sm font-bold ${won ? 'text-owed' : 'text-owing'}`}>
        {formatAgorot(entry.amount_agorot, { sign: true })}
      </Text>
    </View>
  );
}
