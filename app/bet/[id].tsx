import * as Haptics from 'expo-haptics';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown, ZoomIn } from '@/components/animated';

import { BetActions, betSocial } from '@/components/bet-actions';
import { betSlices, myOptionId, winningLabel } from '@/components/bet-card';
import { BetComments } from '@/components/bet-comments';
import { DoubleTapToLike } from '@/components/double-tap-like';
import { BetMediaView } from '@/components/bet-media';
import { BetProof } from '@/components/bet-proof';
import { ReportSheet, type ReportTarget } from '@/components/report-sheet';
import { splitMedia } from '@/lib/media';
import { AlertIcon, ClockIcon, LockIcon, TrophyIcon } from '@/components/icons';
import { OddsBar } from '@/components/odds-bar';
import { ContentWidth, Screen } from '@/components/screen';
import {
  Avatar,
  Badge,
  Button,
  ErrorNotice,
  Loading,
  Money,
  PressableScale,
  SectionTitle,
  useConfirm,
} from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { useForegroundRefresh } from '@/hooks/use-foreground-refresh';
import { useGroupRealtime } from '@/hooks/use-group-realtime';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import type { BetSide, BetWithPositions, UserRow } from '@/lib/database.types';
import { formatAgorot, formatCountdown, formatShortDate } from '@/lib/format';
import { previewShareAgorot } from '@/lib/payout';
import {
  cancelBet,
  fetchBet,
  joinBetOption,
  leaveBet,
  lockBet,
  resolveBet,
  setBetLike,
} from '@/lib/queries';
import { useAuth } from '@/providers/auth-provider';
import { useColors, useScheme } from '@/providers/theme-provider';
import { motion, optionColor } from '@/theme';

export default function BetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const betId = id ?? '';
  const { session, profile } = useAuth();
  const colors = useColors();
  const router = useRouter();
  const userId = session?.user.id ?? '';

  // One request, not three. The group's members and the ledger rows used to be
  // their own `useAsync`, each keyed on something only the *first* response
  // could supply — the group id, the status — so opening a bet was a waterfall
  // three deep on a cold cache. `fetchBet` embeds both now.
  const bet = useAsync(() => fetchBet(betId), [betId]);
  const groupId = bet.data?.group_id;

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  /** What the report/block sheet is pointed at, if anything. */
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const { ask, dialog } = useConfirm();

  // See the note in group/[id]/index.tsx: depend on the stable `reload`, not
  // on the state object, or the Realtime channel reopens every render.
  const { reload: reloadBet } = bet;

  const refresh = useCallback(() => {
    void reloadBet({ silent: true });
  }, [reloadBet]);

  useGroupRealtime(groupId, refresh);

  // Same reason as the feed: the hero photo is a signed URL with an hour on it,
  // and a screen nobody has touched never re-signs.
  useForegroundRefresh(refresh, Boolean(betId));

  // Same reason as the group screen: this one is still mounted under the
  // settle-up screen, so a balance settled there would otherwise be stale on
  // the way back.
  useFocusEffect(refresh);

  if (bet.loading) return <Loading label="Loading bet…" />;
  if (!bet.data) {
    return (
      <Screen className="px-gutter pt-10">
        <ErrorNotice message={bet.error ?? 'This bet is not available.'} />
        <Button
          title="Back to the feed"
          variant="tinted"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
        />
      </Screen>
    );
  }

  const data = bet.data;
  const slices = betSlices(data);
  const social = betSocial(data, userId);
  const picked = myOptionId(data, userId);
  const isCreator = data.creator_id === userId;
  const countdown = formatCountdown(data.close_at);
  const deadlinePassed = countdown === 'Closed';
  const canJoin = data.status === 'open' && !deadlinePassed;
  const isResolved = data.status === 'resolved';
  const isCancelled = data.status === 'cancelled';
  // The hero at the top of the screen is the bet's *illustration*; proof of
  // outcome is a separate gallery further down. Without the split, a photo
  // somebody added after the result would silently become the bet's face.
  const { attachments: media, proof } = splitMedia(data.media ?? []);

  // The same rule the RLS policy enforces, mirrored here only so the button is
  // absent rather than present-and-refused. The server is still the gate.
  const iHadASide = (data.positions ?? []).some((p) => p.user_id === userId);
  const canAddProof = isResolved && (isCreator || iHadASide);

  const myLedgerAmount =
    (data.ledger ?? []).find((entry) => entry.user_id === userId)?.amount_agorot ?? null;

  const usersById = new Map<string, UserRow>(
    (data.group?.members ?? []).map((m) => [m.user_id, m.user])
  );

  const creatorName = usersById.get(data.creator_id)?.display_name ?? 'this person';

  /**
   * Like without re-reading the bet.
   *
   * `BetActions` has already moved the heart and will roll itself back if this
   * throws, so the only thing left is the write and a patch of the one field
   * that changed. Re-fetching the whole bet — options, positions, media,
   * ledger, the group's members — to move a number by one was most of why
   * liking felt heavier than it looks.
   */
  async function toggleLike(next: boolean) {
    await setBetLike(betId, userId, next);
    bet.setData((current) =>
      current
        ? {
            ...current,
            likes: next
              ? [...(current.likes ?? []), { user_id: userId }]
              : (current.likes ?? []).filter((like) => like.user_id !== userId),
          }
        : current
    );
  }

  /** Double-tap only ever adds a like; it never takes one away. */
  async function likeFromGesture() {
    if (social.liked) return;
    try {
      await toggleLike(true);
    } catch {
      // The heart animation has already played. A failed write is picked up by
      // the next refresh rather than yanked back under the finger.
    }
  }

  async function withBusy(action: () => Promise<void>) {
    setActionError(null);
    setBusy(true);
    try {
      await action();
      await bet.reload({ silent: true });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  async function pickOption(next: string) {
    if (Platform.OS !== 'web') {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    await withBusy(async () => {
      // Tapping the option you're already on withdraws you from the bet.
      if (picked === next) await leaveBet(betId);
      else await joinBetOption(betId, next);
    });
  }

  function confirmResolve(optionId: string) {
    const slice = slices.find((s) => s.id === optionId);
    const label = slice?.label ?? 'That option';
    const winners = slice?.count ?? 0;

    ask({
      title: `"${label}" won?`,
      message:
        winners === 0
          ? 'Nobody backed that side, so nothing will change hands. This cannot be undone.'
          : `${winners} ${winners === 1 ? 'person splits' : 'people split'} ${formatAgorot(data.total_pot_agorot)}. This cannot be undone.`,
      confirmLabel: 'Resolve',
      destructive: true,
      onConfirm: () =>
        void withBusy(async () => {
          await resolveBet(betId, optionId);
          if (Platform.OS !== 'web') {
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
        }),
    });
  }

  function confirmCancel() {
    ask({
      title: 'Cancel this bet?',
      message: 'Nobody wins, nobody owes anything.',
      cancelLabel: 'Keep it',
      confirmLabel: 'Cancel bet',
      destructive: true,
      onConfirm: () => void withBusy(() => cancelBet(betId)),
    });
  }

  return (
    <>
      <Stack.Screen options={{ title: data.group?.name ?? 'Bet' }} />
      <Screen ground="sunken">
        {/* The comment composer lives at the bottom of a long scroll, so
            without this the keyboard covers the thing you are typing into. */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1"
        >
        <ScrollView
          contentContainerClassName="px-gutter pb-12 pt-2"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          refreshControl={
            <RefreshControl
              refreshing={bet.refreshing}
              onRefresh={() => bet.reload()}
              tintColor={colors.textTertiary}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          <ContentWidth>
            {media.length > 0 && (
              <Animated.View entering={FadeIn.duration(motion.duration.base)} className="mb-5">
                {/* Double-tap to like, the gesture everyone already has in
                    their fingers. It belongs *here* and not on the feed card:
                    there, a single tap opens the bet, and waiting ~250ms to
                    find out whether a second tap is coming would make every
                    navigation in the app feel slow to buy one shortcut. */}
                <DoubleTapToLike
                  enabled={!social.liked}
                  onLike={() => void likeFromGesture()}
                >
                  <BetMediaView media={media} active radius={24} className="h-72 w-full" />
                </DoubleTapToLike>
              </Animated.View>
            )}

            <Animated.View entering={FadeInDown.duration(motion.duration.base)}>
              <View className="mb-3 flex-row items-center gap-2.5">
                <Badge label={data.status} tone={data.status} />
                {countdown && !isResolved && !isCancelled && (
                  <View className="flex-row items-center gap-1.5">
                    <ClockIcon size={13} color={colors.textSecondary} />
                    <Text className="text-sm text-secondary">{countdown}</Text>
                  </View>
                )}
                <Text className="ml-auto text-sm text-tertiary">
                  {formatShortDate(data.created_at)}
                </Text>
              </View>

              <Text className="text-2xl font-bold text-primary">{data.title}</Text>
              {data.description && (
                <Text className="mt-2.5 text-base leading-[22px] text-secondary">
                  {data.description}
                </Text>
              )}
            </Animated.View>

            {/* The market */}
            <Animated.View
              entering={FadeInDown.delay(60).duration(motion.duration.base)}
              className="mt-5"
            >
              <View className="rounded-3xl border border-hairline bg-surface p-4">
                <View className="mb-5 flex-row items-end justify-between">
                  <Text className="text-subhead text-secondary">Total pot</Text>
                  <Money agorot={data.total_pot_agorot} size="lg" tone="accent" />
                </View>
                <OddsBar
                  slices={slices}
                  winningId={isResolved ? data.winning_option_id ?? null : null}
                  size="lg"
                />
              </View>
            </Animated.View>

            {actionError && (
              <View className="mt-4">
                <ErrorNotice message={actionError} />
              </View>
            )}

            {/* One row of squares: the tap target and the roster in the same
                object. See OptionCard for why these used to be two rows. */}
            <Animated.View
              entering={FadeInDown.delay(120).duration(motion.duration.base)}
              className="mt-4 flex-row flex-wrap gap-3"
            >
              {slices.map((slice, index) => (
                <OptionCard
                  key={slice.id}
                  label={slice.label}
                  index={index}
                  count={slices.length}
                  selected={picked === slice.id}
                  pressable={canJoin}
                  disabled={busy}
                  // Joining makes that option one bigger, so preview against
                  // n+1 unless you are already on it. No preview once the bet
                  // is closed — the number would be a promise nobody can take.
                  shareAgorot={
                    canJoin
                      ? previewShareAgorot(
                          data.total_pot_agorot,
                          picked === slice.id ? slice.count : slice.count + 1
                        )
                      : null
                  }
                  won={isResolved ? data.winning_option_id === slice.id : null}
                  people={(data.positions ?? [])
                    .filter((p) => p.option_id === slice.id)
                    .map((p) => ({
                      id: p.user_id,
                      name: usersById.get(p.user_id)?.display_name ?? 'Someone',
                      avatarUrl: usersById.get(p.user_id)?.avatar_url ?? null,
                    }))}
                  onPress={() => void pickOption(slice.id)}
                />
              ))}
            </Animated.View>

            {!canJoin && !isResolved && !isCancelled && (
              <View className="mt-4 flex-row items-center gap-3 rounded-2xl border border-hairline bg-surface px-4 py-3.5">
                <LockIcon size={17} color={colors.textSecondary} />
                <Text className="flex-1 text-subhead leading-5 text-secondary">
                  {deadlinePassed
                    ? 'The join deadline has passed — waiting on the creator to call it.'
                    : 'This bet is locked. No more joining.'}
                </Text>
              </View>
            )}

            {isCancelled && (
              <View className="mt-4 flex-row items-center gap-3 rounded-2xl border border-hairline bg-surface px-4 py-3.5">
                <AlertIcon size={17} color={colors.textSecondary} />
                <Text className="flex-1 text-subhead text-secondary">
                  This bet was cancelled. Nobody won and nobody owes anything.
                </Text>
              </View>
            )}

            {isResolved && (
              <ResolvedSummary bet={data} userId={userId} myAmountAgorot={myLedgerAmount} />
            )}

            {/* Proof sits directly under the result it is proof of, and above
                "Who's in" — the answer, then the evidence, then the roster. */}
            {isResolved && (
              <BetProof
                bet={data}
                proof={proof}
                currentUserId={userId}
                canAdd={canAddProof}
                usersById={usersById}
                onChanged={() => bet.reload({ silent: true })}
              />
            )}

            {/* Reactions sit between the bet and the creator's controls: the
                bet is what you came for, the talk about it is next, and the
                buttons that end it are last. */}
            <View className="mt-7 flex-row items-center justify-between">
              <BetActions
                liked={social.liked}
                likeCount={social.likeCount}
                commentCount={social.commentCount}
                onToggleLike={toggleLike}
              />
            </View>

            <BetComments
              betId={betId}
              currentUserId={userId}
              currentUserName={profile?.display_name}
              currentUserAvatar={profile?.avatar_url}
              onReportComment={(comment) =>
                setReporting({
                  kind: 'comment',
                  id: comment.id,
                  authorId: comment.user_id,
                  authorName: comment.author?.display_name ?? 'this person',
                  noun: 'this comment',
                })
              }
            />

            {/* Reporting the bet itself, not a comment on it. Offered to
                everyone except its creator — who has lock, resolve and cancel
                instead, and does not need a way to report themselves. */}
            {!isCreator && (
              <PressableScale
                scaleTo={0.99}
                onPress={() =>
                  setReporting({
                    kind: 'bet',
                    id: betId,
                    authorId: data.creator_id,
                    authorName: creatorName,
                    noun: 'this bet',
                  })
                }
                accessibilityRole="button"
                accessibilityLabel="Report this bet"
                className="mt-7 flex-row items-center justify-center gap-2 py-2"
              >
                <AlertIcon size={15} color={colors.textTertiary} />
                <Text className="text-sm text-tertiary">Report this bet</Text>
              </PressableScale>
            )}

            {isCreator && !isResolved && !isCancelled && (
              <View className="mt-7">
                <SectionTitle>You created this bet</SectionTitle>
                <View className="rounded-3xl border border-hairline bg-surface p-4">
                  <Text className="mb-4 text-sm leading-[18px] text-secondary">
                    Only you can call it. Bets can&apos;t be edited — only locked, resolved or
                    cancelled.
                  </Text>
                  <View className="gap-3">
                    {slices.map((slice) => (
                      <Button
                        key={slice.id}
                        title={`"${slice.label}" won`}
                        variant="secondary"
                        disabled={busy}
                        icon={<TrophyIcon size={16} color={colors.text} />}
                        onPress={() => confirmResolve(slice.id)}
                      />
                    ))}
                    {data.status === 'open' && (
                      <Button
                        title="Lock — no more joining"
                        variant="plain"
                        disabled={busy}
                        icon={<LockIcon size={16} color={colors.accent} />}
                        onPress={() => void withBusy(() => lockBet(betId))}
                      />
                    )}
                    <Button
                      title="Cancel bet"
                      variant="destructive"
                      disabled={busy}
                      onPress={confirmCancel}
                    />
                  </View>
                </View>
              </View>
            )}
          </ContentWidth>
        </ScrollView>
        </KeyboardAvoidingView>

        {/* Blocking hides the blocked person's comments at the policy level, so
            the screen has to re-read to see that happen. */}
        <ReportSheet
          target={reporting}
          onClose={() => setReporting(null)}
          onBlocked={() => void bet.reload({ silent: true })}
        />

        {dialog}
      </Screen>
    </>
  );
}

/**
 * One square per outcome: the tap target *and* the roster of who is on it.
 *
 * There used to be two rows — a row of buttons to pick a side, then a second
 * row underneath listing who had picked what. Two rows of the same N squares,
 * in the same order, in the same colours, saying different halves of one
 * thing. You picked "Yes" in the top row and then looked down to a *different*
 * "Yes" to see who else had.
 *
 * Merging them makes the square the whole object: its label, what you would
 * win, who is already on it, and pressing it puts you there. The roster is
 * what makes the choice interesting — you are not betting on an outcome so
 * much as against the people who took the other one — so it belongs on the
 * thing you press, not in a separate list below.
 *
 * The states it has to carry at once:
 * - open and joinable  → pressable, shows the payoff preview
 * - locked / past deadline → not pressable, still shows who is in
 * - resolved → winner outlined and badged, losers dimmed, nothing pressable
 */
function OptionCard({
  label,
  index,
  count,
  selected,
  pressable,
  disabled,
  shareAgorot,
  won,
  people,
  onPress,
}: {
  label: string;
  index: number;
  count: number;
  selected: boolean;
  /** False once the bet is locked, past its deadline, resolved or cancelled. */
  pressable: boolean;
  disabled: boolean;
  /** Null while the bet is still joinable — there is no payoff to preview. */
  shareAgorot: number | null;
  /** Null while unresolved; true/false once a winner is declared. */
  won: boolean | null;
  people: { id: string; name: string; avatarUrl?: string | null }[];
  onPress: () => void;
}) {
  const colors = useColors();
  const scheme = useScheme();
  // With an arbitrary number of options there is no literal class name to
  // write, so the colour is an inline style. Tailwind cannot see an
  // interpolated class — see §4.
  const color = optionColor(index, count, scheme);
  const dimmed = won === false;

  const body = (
    <>
      <View className="mb-3 flex-row items-center gap-1.5">
        <Text
          numberOfLines={2}
          style={dimmed ? undefined : { color }}
          className={`flex-1 text-base font-semibold ${dimmed ? 'text-tertiary' : ''}`}
        >
          {label}
        </Text>
        {won === true && <TrophyIcon size={15} color={colors.positive} />}
      </View>

      {people.length === 0 ? (
        <Text className="text-sm text-tertiary">Nobody yet</Text>
      ) : (
        people.map((person, personIndex) => (
          <View key={`${person.id}-${personIndex}`} className="mb-2 flex-row items-center gap-2">
            <Avatar name={person.name} id={person.id} uri={person.avatarUrl} size={24} />
            <Text numberOfLines={1} className="flex-1 text-sm text-primary">
              {person.name}
            </Text>
          </View>
        ))
      )}

      {/* The payoff line sits under the roster, not over it: the people are
          the reason to choose, the number is the consequence of choosing. */}
      {shareAgorot !== null && (
        <Text className="mt-1 text-sm text-secondary">
          {selected ? 'Tap to withdraw' : `Win ~${formatAgorot(shareAgorot)}`}
        </Text>
      )}
    </>
  );

  // Two fill the row; three or more take half and wrap.
  const sizing = { flexBasis: count === 2 ? 0 : '47%' as const, flexGrow: 1 };

  if (!pressable) {
    return (
      <View
        style={sizing}
        className={`rounded-3xl border bg-surface p-4 ${
          won === true ? 'border-positive' : 'border-hairline'
        } ${dimmed ? 'opacity-60' : ''}`}
      >
        {body}
      </View>
    );
  }

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      scaleTo={0.955}
      accessibilityRole="button"
      accessibilityLabel={
        selected
          ? `Withdraw from ${label}. ${describeRoster(people)}`
          : `Back ${label}. ${describeRoster(people)}`
      }
      accessibilityState={{ selected, disabled }}
      style={{ ...sizing, borderColor: selected ? color : undefined }}
      className={`rounded-3xl border-2 p-4 ${
        selected ? '' : 'border-hairline bg-surface'
      } ${disabled ? 'opacity-50' : ''}`}
    >
      {body}
    </PressableScale>
  );
}

/**
 * The roster as a sentence, for the accessibility label.
 *
 * A screen reader announcing the button has to say who is on it too, or the
 * merge loses exactly the information it was meant to surface — the avatars
 * are decorative to it.
 */
function describeRoster(people: { name: string }[]): string {
  if (people.length === 0) return 'Nobody on this side yet.';
  if (people.length === 1) return `${people[0]!.name} is on this side.`;
  if (people.length <= 3) {
    const names = people.map((p) => p.name);
    const last = names.pop();
    return `${names.join(', ')} and ${last} are on this side.`;
  }
  return `${people[0]!.name} and ${people.length - 1} others are on this side.`;
}

/**
 * The payoff moment. A bet resolving is the emotional peak of the app, so it
 * gets a real entrance rather than a quiet re-render — the one place in the
 * product where a spring is allowed to overshoot.
 */
function ResolvedSummary({
  bet,
  userId,
  myAmountAgorot,
}: {
  bet: BetWithPositions;
  userId: string;
  /** The signed ledger line the resolve-bet function wrote for this user. */
  myAmountAgorot: number | null;
}) {
  const colors = useColors();
  const reduced = useReducedMotion();
  const slices = betSlices(bet);
  const side = myOptionId(bet, userId);
  const winners = slices.find((s) => s.id === bet.winning_option_id)?.count ?? 0;
  const winner = winningLabel(bet) ?? 'That option';

  if (winners === 0) {
    return (
      <Animated.View entering={FadeIn.delay(120).duration(motion.duration.slow)} className="mt-4">
        <View className="flex-row items-center gap-3 rounded-3xl border border-hairline bg-surface px-4 py-4">
          <AlertIcon size={18} color={colors.textSecondary} />
          <View className="flex-1">
            <Text className="text-subhead font-semibold text-primary">
              {winner} won — but nobody backed it.
            </Text>
            <Text className="mt-0.5 text-sm text-secondary">
              No money changes hands on this one.
            </Text>
          </View>
        </View>
      </Animated.View>
    );
  }

  const iWon = side !== null && side === bet.winning_option_id;
  const watchedOnly = side === null;

  return (
    <Animated.View
      entering={
        reduced
          ? FadeIn.duration(motion.duration.fast)
          : ZoomIn.delay(140)
              .springify()
              .duration(motion.celebrate.duration)
              .dampingRatio(motion.celebrate.dampingRatio)
      }
      className="mt-4"
    >
      <View
        className={`items-center rounded-3xl border px-5 py-6 ${
          watchedOnly
            ? 'border-hairline bg-surface'
            : iWon
              ? 'border-positive bg-positive-soft'
              : 'border-negative bg-negative-soft'
        }`}
      >
        {!watchedOnly && (
          <Animated.View
            entering={
              // The badge lands after the card, and only overshoots on a win.
              // A loss gets the same layout and none of the bounce: animating
              // a defeat like a victory is the kind of thing that makes an app
              // feel like it is not paying attention.
              reduced
                ? FadeIn.duration(motion.duration.fast)
                : iWon
                  ? ZoomIn.delay(260)
                      .springify()
                      .duration(motion.celebrate.duration)
                      .dampingRatio(motion.celebrate.dampingRatio)
                  : FadeIn.delay(220).duration(motion.duration.base)
            }
            className="mb-3 h-14 w-14 items-center justify-center rounded-full bg-surface"
          >
            <TrophyIcon size={26} color={iWon ? colors.positive : colors.negative} />
          </Animated.View>
        )}

        <Text className="text-subhead text-secondary">
          <Text className="font-semibold text-primary">{winner}</Text> took it
        </Text>

        {side !== null && myAmountAgorot !== null && (
          <>
            {/* The number is the payoff of the entire product, so it gets a
                subject and the one animation in the app that overshoots. */}
            <Text
              className={`mt-3 text-sm font-semibold ${
                iWon ? 'text-positive' : 'text-negative'
              }`}
            >
              {iWon ? 'You won' : 'You owe'}
            </Text>
            <Animated.View
              entering={
                reduced
                  ? FadeIn.duration(motion.duration.fast)
                  : iWon
                    ? ZoomIn.delay(340)
                        .springify()
                        .duration(motion.celebrate.duration)
                        .dampingRatio(motion.celebrate.dampingRatio)
                    : FadeInDown.delay(280).duration(motion.duration.base)
              }
              className="mt-0.5"
            >
              <Money agorot={myAmountAgorot} size="xl" sign />
            </Animated.View>
          </>
        )}

        <Text className="mt-3 text-center text-sm leading-[18px] text-secondary">
          {watchedOnly
            ? 'You sat this one out.'
            : 'Settle it on the group’s settle-up screen when you’re ready.'}
        </Text>
      </View>
    </Animated.View>
  );
}
