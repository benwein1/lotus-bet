import Constants from 'expo-constants';
import { Link, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, RefreshControl, ScrollView, Switch, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from '@/components/animated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AvatarPicker } from '@/components/avatar-picker';
import { BetGrid } from '@/components/bet-grid';
import { DemoBadge } from '@/components/demo-entry';
import { ChevronRightIcon, LogOutIcon, TicketIcon, TrophyIcon } from '@/components/icons';
import { ContentWidth, Screen } from '@/components/screen';
import { ProfileSkeleton } from '@/components/skeletons';
import {
  Avatar,
  Button,
  EmptyState,
  ErrorNotice,
  ListGroup,
  Loading,
  PressableScale,
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
import { formatMoney } from '@/lib/currency';
import { formatShortDate } from '@/lib/format';
import {
  APP_NAME,
  SUPPORT_CONTACT_PUBLISHED,
  SUPPORT_EMAIL,
  SUPPORT_MAILTO,
} from '@/lib/legal';
import { clearPushToken } from '@/lib/notifications';
import { cancelDeadlineReminders } from '@/lib/reminders';
import {
  fetchBlockedUsers,
  fetchMyBets,
  fetchMyGroups,
  fetchMyHistory,
  fetchMyPersonBalances,
  fetchMyStats,
  fetchMyTotalsByCurrency,
  unblockUser,
  type CurrencyTotal,
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
  const router = useRouter();
  const reduced = useReducedMotion();
  const tabInset = useTabBarInset();
  const { preference, setPreference } = useAppearance();
  const userId = session?.user.id ?? '';

  const stats = useAsync(fetchMyStats, [userId]);
  const totals = useAsync(fetchMyTotalsByCurrency, [userId]);
  const history = useAsync(() => fetchMyHistory(userId), [userId]);
  const groups = useAsync(fetchMyGroups, [userId]);
  const owed = useAsync(() => fetchMyPersonBalances(userId), [userId]);
  const blocked = useAsync(fetchBlockedUsers, [userId]);
  const mine = useAsync(() => fetchMyBets(userId), [userId]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { ask, dialog } = useConfirm();

  // Spelled as a sentence rather than "1.0.0 · 12". A support request that
  // quotes the build is worth a great deal and this is the only place anybody
  // can read it, so it has to be legible rather than terse. The build number
  // is absent on the web and in Expo Go, where there is no native build.
  const build = Constants.nativeBuildVersion;
  const version = Constants.expoConfig?.version ?? '—';
  const versionLabel = build ? `Version ${version} (build ${build})` : `Version ${version}`;

  const { reload: reloadStats } = stats;
  const { reload: reloadHistory } = history;
  const { reload: reloadOwed } = owed;
  const { reload: reloadBlocked } = blocked;
  const { reload: reloadMine } = mine;

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
    void reloadMine({ silent: true });
  }, [reloadStats, reloadHistory, reloadOwed, reloadMine]);

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
  const hasRecord = decided > 0 || Number(s?.bets_settled ?? 0) > 0;

  /**
   * Lifetime money, one line per currency.
   *
   * `my_stats`'s own two money columns add every group's integers together
   * regardless of what they denominate, which stopped being a real number when
   * a group could be created in dollars. `my_totals_by_currency` splits them;
   * an empty result means the project has not applied that migration, and
   * falling back to `my_stats` is exactly right there, because such a project
   * has no currency column and every group in it is in shekels.
   */
  const byCurrency: CurrencyTotal[] =
    totals.data && totals.data.length > 0
      ? totals.data
      : [
          {
            currency: 'ILS' as const,
            wonAgorot: Number(s?.total_won_agorot ?? 0),
            lostAgorot: Number(s?.total_lost_agorot ?? 0),
            netAgorot: Number(s?.total_won_agorot ?? 0) - Number(s?.total_lost_agorot ?? 0),
          },
        ];
  const squareEverywhere = byCurrency.every((t) => t.netAgorot === 0);

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
                    ) : squareEverywhere ? (
                      <Text className="text-4xl font-bold text-primary">Even</Text>
                    ) : (
                      // One line per currency. Normally there is one, and this
                      // renders exactly as it always did; two means the account
                      // plays in two, and stacking them is the only honest
                      // answer — there is no rate to collapse them with.
                      byCurrency
                        .filter((t) => t.netAgorot !== 0)
                        .map((t) => (
                          <Money
                            key={t.currency}
                            agorot={t.netAgorot}
                            currency={t.currency}
                            size="xl"
                            sign
                          />
                        ))
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
                {/* Won and lost are money, so there is a pair per currency; the
                    win rate is a count of events and means the same thing in
                    all four, so there is one of it.

                    One currency — which is nearly every account — keeps the
                    three-across row this has always been. Only a genuinely
                    mixed account pays a line per currency for it. */}
                {byCurrency.length === 1 && byCurrency[0] ? (
                  <View className="flex-row gap-3">
                    <Stat
                      label="Won"
                      value={formatMoney(byCurrency[0].wonAgorot, byCurrency[0].currency)}
                      tone="positive"
                    />
                    <Stat
                      label="Lost"
                      value={formatMoney(byCurrency[0].lostAgorot, byCurrency[0].currency)}
                      tone="negative"
                    />
                    <Stat label="Win rate" value={winRate === null ? '—' : `${winRate}%`} />
                  </View>
                ) : (
                  <>
                    {byCurrency.map((t) => (
                      <View key={t.currency} className="mb-3 flex-row gap-3">
                        <Stat
                          label={`Won (${t.currency})`}
                          value={formatMoney(t.wonAgorot, t.currency)}
                          tone="positive"
                        />
                        <Stat
                          label={`Lost (${t.currency})`}
                          value={formatMoney(t.lostAgorot, t.currency)}
                          tone="negative"
                        />
                      </View>
                    ))}
                    <View className="flex-row gap-3">
                      <Stat label="Win rate" value={winRate === null ? '—' : `${winRate}%`} />
                    </View>
                  </>
                )}

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

            {/* Authorship, not participation. "Bet history" below answers what
                you have been *in*; this answers what you have put *up*, which
                is the question a profile grid is actually asking — and it is
                the only screen where a bet you created but never joined is
                yours. Placed directly under the record, the way a profile
                leads with its content and keeps settings underneath. */}
            <View className="mb-7">
              <SectionTitle>Bets you started</SectionTitle>
              {mine.loading ? (
                <Loading label="Loading your bets…" />
              ) : (mine.data ?? []).length === 0 ? (
                <View className="rounded-3xl border border-hairline bg-surface">
                  <EmptyState
                    icon={<TicketIcon size={26} color={colors.textSecondary} />}
                    title="You haven't started one yet"
                    body="Post a bet in any of your groups and it shows up here."
                  />
                </View>
              ) : (
                <BetGrid bets={mine.data ?? []} />
              )}
            </View>

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

            {/* Guideline 1.2 asks a user-generated-content app to publish its
                rules and a way to reach a person, and 5.1.1 asks for the
                privacy policy to be reachable from inside the app. Sign-up is
                where somebody agrees; this is where they can go back and read
                what they agreed to, which is not the same screen and not a
                place anybody returns to.

                The two documents are screens rather than links out: the text
                ships with the build, so they open with no network and before
                any domain exists. */}
            <View className="mb-7">
              <SectionTitle>About</SectionTitle>
              <ListGroup>
                <Row
                  label="Terms of Service"
                  trailing={<ChevronRightIcon size={18} color={colors.textTertiary} />}
                  onPress={() => router.push('/legal/terms')}
                />
                <Row
                  label="Privacy Policy"
                  trailing={<ChevronRightIcon size={18} color={colors.textTertiary} />}
                  onPress={() => router.push('/legal/privacy')}
                />
                <Row
                  label="Support"
                  trailing={<ChevronRightIcon size={18} color={colors.textTertiary} />}
                  onPress={() => router.push('/legal/support')}
                  last={!SUPPORT_CONTACT_PUBLISHED}
                />
                {/* Only when there is an address to write to. A contact row
                    that opens a mail composer addressed at a placeholder is
                    worse than no row: it looks like the app answered you. */}
                {SUPPORT_CONTACT_PUBLISHED && (
                  <Row
                    label="Contact us"
                    value={SUPPORT_EMAIL}
                    onPress={() => void Linking.openURL(SUPPORT_MAILTO)}
                    last
                  />
                )}
              </ListGroup>
              <Text className="mt-2.5 px-1 text-sm text-tertiary">{versionLabel}</Text>
            </View>

            <Button
              title="Sign out"
              variant="destructive"
              icon={<LogOutIcon size={16} color={colors.negative} />}
              onPress={confirmSignOut}
            />

            {/* Guideline 5.1.1(v) requires deletion to be reachable in the app.
                It sits under Sign out, as a plain link rather than a fourth
                button: it has to be findable without being a thing you hit by
                accident next to the one you meant. The screen it opens is where
                the consequences are explained — there is too much to say for a
                dialog, because what a deletion *keeps* here is unusual. */}
            {/* Shown in demo too. The demo's `deleteAccount` is a no-op, but its
                sign-out genuinely throws away every byte of in-memory state —
                so the screen's promise holds there as well, and hiding it would
                only mean the one flow Apple checks hardest is the one nobody
                can walk without a real account. */}
            <Link href="/delete-account" asChild>
                <PressableScale
                  scaleTo={0.99}
                  accessibilityRole="button"
                  accessibilityLabel="Delete your account"
                  className="mt-5 items-center py-2"
                >
                  <Text className="text-subhead text-tertiary">Delete account</Text>
                </PressableScale>
            </Link>

            <Text className="mt-7 text-center text-xs leading-4 text-tertiary">
              Betta is a tracker. It holds no money, processes no payments, and sells no
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
