import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, Switch, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from '@/components/animated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AvatarPicker } from '@/components/avatar-picker';
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
  useConfirm,
} from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import type { PersonBalance } from '@/lib/database.types';
import { formatAgorot, formatShortDate } from '@/lib/format';
import { clearPushToken } from '@/lib/notifications';
import { cancelDeadlineReminders } from '@/lib/reminders';
import {
  fetchBlockedUsers,
  fetchMyGroups,
  fetchMyHistory,
  fetchMyPersonBalances,
  fetchMyStats,
  unblockUser,
  type HistoryEntry,
} from '@/lib/queries';
import { useAuth } from '@/providers/auth-provider';
import { useAppearance, useColors } from '@/providers/theme-provider';
import { motion } from '@/theme';

/**
 * The four kinds of notification, which the database still stores separately.
 *
 * Three are push, fanned out by the `notify` Edge Function; `notify_deadlines`
 * is scheduled locally on the device and needs no token at all. The screen now
 * offers one switch over all four — see `toggleNotifications` for why the
 * columns did not follow.
 */
type NotifyKey =
  | 'notify_new_bets'
  | 'notify_resolutions'
  | 'notify_group_joins'
  | 'notify_deadlines';

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
  const owed = useAsync(() => fetchMyPersonBalances(userId), [userId]);
  const blocked = useAsync(fetchBlockedUsers, [userId]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { ask, dialog } = useConfirm();

  const { reload: reloadStats } = stats;
  const { reload: reloadHistory } = history;
  const { reload: reloadOwed } = owed;
  const { reload: reloadBlocked } = blocked;

  /**
   * Unblocking is not confirmed.
   *
   * Blocking is the destructive direction and asks first; undoing it puts
   * things back the way they were and costs one more tap to redo. A dialog
   * here would only make the reversible half feel as heavy as the other one.
   */
  async function undoBlock(id: string) {
    setError(null);
    try {
      await unblockUser(id);
      await reloadBlocked({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not unblock them.');
    }
  }

  const refresh = useCallback(() => {
    void reloadStats({ silent: true });
    void reloadHistory({ silent: true });
    void reloadOwed({ silent: true });
  }, [reloadStats, reloadHistory, reloadOwed]);

  // `undefined` rather than a boolean means the project has not had the
  // notification-prefs migration applied yet.
  const hasNewerPrefs = profile?.notify_group_joins !== undefined;

  /**
   * On if *any* kind is still on.
   *
   * Accounts made before this screen had one switch can be in a mixed state —
   * someone who turned off only "new bets" is still being notified, and a
   * switch reading "off" while their phone buzzes would be a lie. Toggling
   * either way writes all four, so a mixed state survives exactly one tap.
   */
  const notificationsOn =
    (profile?.notify_new_bets ?? true) ||
    (profile?.notify_resolutions ?? true) ||
    (profile?.notify_group_joins ?? true) ||
    (profile?.notify_deadlines ?? true);

  /**
   * One switch for the lot.
   *
   * There were four — new bets, resolutions, group joins, deadlines — and four
   * switches is four decisions to make about a thing nobody wants to think
   * about. The question people actually have is "does this app buzz at me or
   * not", so that is the question the screen asks.
   *
   * The four columns stay. `push_targets_for_bet` and `push_targets_for_group`
   * read them per kind, and the reminder scheduler reads `notify_deadlines` on
   * its own — collapsing the *storage* would mean touching the push fan-out and
   * the SQL that decides who hears about what, to solve a problem that is
   * entirely in the UI. So the switch writes all four together and the backend
   * never learns anything changed.
   */
  async function toggleNotifications(value: boolean) {
    setError(null);
    setSaving(true);
    try {
      // Every key the project actually has. On a project without the prefs
      // migration, writing the two it does not know about would fail the whole
      // update — the same reason the extra switches were hidden before.
      const patch: Partial<Record<NotifyKey, boolean>> = {
        notify_new_bets: value,
        notify_resolutions: value,
      };
      if (hasNewerPrefs) {
        patch.notify_group_joins = value;
        patch.notify_deadlines = value;
      }
      await updateProfile(patch);

      // Deadline reminders are scheduled on this device, so turning them off
      // has to take effect here and now rather than at the next feed refresh.
      if (!value) {
        await cancelDeadlineReminders();
        // Nothing left to send: drop the token rather than keep a stale one on
        // the row. Deadlines need no token — they are local — but with a single
        // switch, off means off for all four, so the token has no job either.
        await clearPushToken();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that setting.');
    } finally {
      setSaving(false);
    }
  }

  function confirmSignOut() {
    ask({
      title: 'Sign out?',
      message: 'Your bets and balances stay exactly where they are.',
      cancelLabel: 'Stay',
      confirmLabel: 'Sign out',
      destructive: true,
      onConfirm: () => void signOut(),
    });
  }

  if (!profile) return <Loading label="Loading your profile…" />;

  const s = stats.data;
  const decided = (s?.bets_won ?? 0) + (s?.bets_lost ?? 0);
  const winRate = decided > 0 ? Math.round(((s?.bets_won ?? 0) / decided) * 100) : null;
  const mostActive = (groups.data ?? []).find((g) => g.id === s?.most_active_group_id);
  const net = Number(s?.total_won_agorot ?? 0) - Number(s?.total_lost_agorot ?? 0);
  const hasRecord = decided > 0 || Number(s?.bets_settled ?? 0) > 0;

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
            {/* No screen title — the tab bar carries that. */}
            <View className="mb-4 items-end pt-2">
              <DemoBadge />
            </View>

            {error && <ErrorNotice message={error} />}

            <Animated.View entering={entering(0)}>
              <View className="mb-7 mt-4 items-center rounded-3xl border border-hairline bg-surface px-5 py-7">
                <AvatarPicker
                  name={profile.display_name}
                  id={profile.id}
                  uri={profile.avatar_url}
                  size={84}
                  owner={{ kind: 'users', id: profile.id }}
                  onChange={(url) => updateProfile({ avatar_url: url })}
                />
                <Text numberOfLines={1} className="mt-3.5 text-xl font-bold text-primary">
                  {profile.display_name}
                </Text>
                {/* The handle sits above the email because it is the one
                    people need *from* you — it is how somebody challenges you
                    without sharing a group. Absent on a project that has not
                    applied `…_private_and_duels.sql` yet. */}
                {profile.username ? (
                  <Text numberOfLines={1} className="mt-1 text-callout font-semibold text-accent">
                    @{profile.username}
                  </Text>
                ) : null}
                {/* Read off the session, not off `public.users`. That column
                    is revoked from clients now, and the GoTrue session holds
                    the authoritative copy anyway — `users.email` was only ever
                    a mirror of it. */}
                <Text numberOfLines={1} className="mt-0.5 text-subhead text-secondary">
                  {session?.user.email ?? ''}
                </Text>

                <View className="mt-6 items-center">
                  <Text className="text-sm text-secondary">Lifetime net</Text>
                  <View className="mt-1">
                    {!hasRecord ? (
                      // "Even" implies you have played and broken even.
                      <Text className="text-2xl font-bold text-tertiary">Not started</Text>
                    ) : net === 0 ? (
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
            ) : !hasRecord ? (
              // A wall of zeros is not a record, it is a report that nothing
              // has happened. Say what will fill it instead.
              <Animated.View entering={entering(60)} className="mb-7">
                <SectionTitle>Your record</SectionTitle>
                <View className="rounded-3xl border border-hairline bg-surface px-5 py-6">
                  <Text className="text-callout leading-5 text-secondary">
                    Nothing settled yet. Once a bet you joined gets called, your running total
                    and your win rate start here.
                  </Text>
                </View>
              </Animated.View>
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

            {/* Directly under the record, because it is the answer to the
                question the record raises: fine, so who do I actually pay? */}
            <PeopleLedger
              people={owed.data ?? []}
              loading={owed.loading}
              entering={entering(90)}
            />

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
                  label="Notify me"
                  hint="New bets, results, people joining, and a nudge before a bet you haven't answered closes."
                  value={notificationsOn}
                  disabled={saving}
                  onChange={(v) => void toggleNotifications(v)}
                  last
                />
              </ListGroup>
            </View>

            {/* Only rendered once there is something to undo. A permanently
                empty "Blocked people" heading on everyone's Profile would be
                the app advertising a problem most groups do not have. */}
            {(blocked.data ?? []).length > 0 && (
              <View className="mb-7">
                <SectionTitle>Blocked</SectionTitle>
                <ListGroup>
                  {(blocked.data ?? []).map((person, i, all) => (
                    <View
                      key={person.id}
                      className={`flex-row items-center gap-3 px-4 py-3 ${
                        i < all.length - 1 ? 'border-b border-hairline' : ''
                      }`}
                    >
                      <Avatar
                        id={person.id}
                        name={person.display_name}
                        uri={person.avatar_url}
                        size={32}
                      />
                      <View className="flex-1">
                        <Text numberOfLines={1} className="text-subhead font-semibold text-primary">
                          {person.display_name}
                        </Text>
                        {person.username ? (
                          <Text numberOfLines={1} className="text-2xs text-tertiary">
                            @{person.username}
                          </Text>
                        ) : null}
                      </View>
                      <Button
                        title="Unblock"
                        variant="tinted"
                        size="sm"
                        onPress={() => void undoBlock(person.id)}
                      />
                    </View>
                  ))}
                </ListGroup>
                <Text className="mt-2 px-1 text-sm text-secondary">
                  Unblocking brings their comments back. It never changed who owes who.
                </Text>
              </View>
            )}

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
      {dialog}
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
        Lotus Bet never moves money. Settle up however you already do.
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
      <Money agorot={Math.abs(person.amountAgorot)} tone={person.amountAgorot > 0 ? 'positive' : 'negative'} />
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
