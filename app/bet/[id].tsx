import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { GroupFace } from '@/components/group-face';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
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
import {
  AlertIcon,
  CheckIcon,
  ChevronRightIcon,
  ClockIcon,
  LockIcon,
  TrophyIcon,
} from '@/components/icons';
import { OddsBar } from '@/components/odds-bar';
import { ContentWidth, Screen } from '@/components/screen';
import { DetailTopBar } from '@/components/detail-top-bar';
import { FloatingTabBar, TabBarScrim } from '@/components/tab-bar';
import {
  Avatar,
  AvatarStack,
  Badge,
  Button,
  ErrorNotice,
  Loading,
  Money,
  PressableScale,
  SectionTitle,
  tap,
  useConfirm,
} from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { useForegroundRefresh } from '@/hooks/use-foreground-refresh';
import { useGroupRealtime } from '@/hooks/use-group-realtime';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import type { BetSide, BetWithPositions, UserRow } from '@/lib/database.types';
import { formatMoney, isForfeit } from '@/lib/currency';
import { formatCountdown, formatShortDate } from '@/lib/format';
import { shareBet } from '@/lib/invites';
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
import { motion, optionColor, optionSoftColor, tabular } from '@/theme';

export default function BetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const betId = id ?? '';
  const { session, profile } = useAuth();
  const colors = useColors();
  const scheme = useScheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabInset = useTabBarInset();
  const userId = session?.user.id ?? '';

  // One request, not three. The group's members and the ledger rows used to be
  // their own `useAsync`, each keyed on something only the *first* response
  // could supply — the group id, the status — so opening a bet was a waterfall
  // three deep on a cold cache. `fetchBet` embeds both now.
  const bet = useAsync(() => fetchBet(betId), [betId]);
  const groupId = bet.data?.group_id;

  const [busy, setBusy] = useState(false);
  // The resolve sheet, opened from the row under the two options.
  const [calling, setCalling] = useState(false);
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
          : isForfeit(data)
            ? `Everybody else owes it: ${data.stake_text}. Nothing lands on a balance. This cannot be undone.`
            : `${winners} ${winners === 1 ? 'person splits' : 'people split'} ${formatMoney(
                data.total_pot_agorot,
                data.group?.currency
              )}. This cannot be undone.`,
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
      {/* No navigation bar.

          The approved board runs the photo from the very top of the screen,
          with the back button floating over it — the bet's own picture is the
          header. An opaque bar above it would eat 100pt and put the group's
          name on screen twice, since the hero already names it. */}
      <Stack.Screen options={{ headerShown: false }} />
      <Screen ground="sunken">
        {/* The comment composer lives at the bottom of a long scroll, so
            without this the keyboard covers the thing you are typing into. */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1"
        >
        <ScrollView
          // With no navigation bar the media starts at y=0. A bet without one
          // has to clear the floating back button itself.
          contentContainerClassName="px-gutter"
          // The media runs to the very top of the screen, as drawn. A bet
          // without one has to clear the floating back button itself.
          contentContainerStyle={{
            paddingTop: media.length > 0 ? 0 : insets.top + 62,
            paddingBottom: tabInset,
          }}
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
            {/* The bet, on its photo.

                Everything that identifies it — the group, the question, the
                pot and the countdown — sits on the picture with the three
                actions, so the page below can start on the odds. That is one
                whole line of vertical space bought back, and the money reads
                while you are still looking at the thing it is about.

                With no photo the same block draws on the page ground instead.
                Half the bets in this app have no attachment, and a hero that
                only works with one is a hero that works half the time. */}
            <Animated.View
              entering={FadeIn.duration(motion.duration.base)}
              className={media.length > 0 ? '-mx-gutter mb-6' : 'mb-6 pt-2'}
            >
              <View className="relative">
                {media.length > 0 && (
                  <>
                    {/* Double-tap to like, the gesture everyone already has in
                        their fingers. It belongs *here* and not on the feed
                        card: there, a single tap opens the bet, and waiting
                        ~250ms to find out whether a second tap is coming would
                        make every navigation in the app feel slow to buy one
                        shortcut. */}
                    <DoubleTapToLike enabled={!social.liked} onLike={() => void likeFromGesture()}>
                      <BetMediaView media={media} active radius={0} className="h-[318px] w-full" />
                    </DoubleTapToLike>
                    {/* Explicit rgba stops: an eight-digit hex that does not
                        truly reach zero leaves a hard seam across the photo. */}
                    <LinearGradient
                      colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0.08)', 'rgba(0,0,0,0.74)']}
                      locations={[0, 0.34, 1]}
                      pointerEvents="none"
                      style={StyleSheet.absoluteFill}
                    />
                  </>
                )}

                <View
                  className={
                    media.length > 0 ? 'absolute inset-x-0 bottom-0 px-gutter pb-4' : ''
                  }
                >
                  {isCreator && !isResolved && !isCancelled && (
                    <View className="mb-3 flex-row">
                      <View className="flex-row items-center gap-1.5 rounded-full bg-scrim px-2.5 py-1">
                        <View className="h-1.5 w-1.5 rounded-full bg-brand" />
                        <Text className="text-2xs font-bold tracking-wide text-on-media">
                          YOURS
                        </Text>
                      </View>
                    </View>
                  )}

                  {/* Group, then who posted it. The status is already said by
                      the countdown beside the pot, and a badge here put a
                      coloured pill in front of the group's own name. */}
                  <View className="flex-row items-center gap-2.5">
                    {data.group?.avatar_url ? (
                      <GroupFace
                        avatarUrl={data.group.avatar_url}
                        size={26}
                        radius={999}
                      />
                    ) : null}
                    <Text
                      numberOfLines={1}
                      className={`text-sm font-semibold ${
                        media.length > 0 ? 'text-on-media' : 'text-primary'
                      }`}
                    >
                      {data.group?.name ?? ''}
                    </Text>
                    {data.creator?.display_name && (
                      <Text
                        numberOfLines={1}
                        className={`shrink text-sm ${
                          media.length > 0 ? 'text-on-media-soft' : 'text-secondary'
                        }`}
                      >
                        · {data.creator.display_name} posted this
                      </Text>
                    )}
                  </View>

                  <Text
                    className={`mt-[13px] text-[25px] font-bold leading-[30px] tracking-[-0.7px] ${
                      media.length > 0 ? 'text-on-media' : 'text-primary'
                    }`}
                  >
                    {data.title}
                  </Text>

                  <View className="mt-[15px] flex-row items-end justify-between gap-3">
                    <View className="flex-row items-center gap-3.5">
                      {/* A forfeit reads as a sentence, so it takes the
                          pot's place at a size a sentence can hold. */}
                      {isForfeit(data) ? (
                        <Text
                          numberOfLines={2}
                          className={`flex-1 text-callout font-semibold ${
                            media.length > 0 ? 'text-on-media' : 'text-primary'
                          }`}
                        >
                          {data.stake_text}
                        </Text>
                      ) : (
                        <Money
                          agorot={data.total_pot_agorot}
                          currency={data.group?.currency}
                          size="betPot"
                          tone={media.length > 0 ? 'onMedia' : 'neutral'}
                        />
                      )}
                      {countdown && !isResolved && !isCancelled && (
                        <View className="flex-row items-center gap-1.5">
                          <ClockIcon
                            size={13}
                            color={media.length > 0 ? colors.onMediaSoft : colors.textSecondary}
                          />
                          <Text
                            className={`text-sm ${
                              media.length > 0 ? 'text-on-media-soft' : 'text-secondary'
                            }`}
                          >
                            {countdown.replace('Closes in ', '')}
                          </Text>
                        </View>
                      )}
                    </View>

                    <BetActions
                      gap={16}
                      liked={social.liked}
                      likeCount={social.likeCount}
                      commentCount={social.commentCount}
                      onToggleLike={toggleLike}
                      onPressShare={() => {
                        tap();
                        // Swallowed: a share sheet the user dismissed is not
                        // an error worth interrupting the bet for.
                        void shareBet(betId, data.title, data.group?.name).catch(() => {});
                      }}
                      onMedia={media.length > 0}
                    />
                  </View>
                </View>
              </View>

              {data.description && (
                <Text
                  className={`mt-4 text-base leading-[22px] text-secondary ${
                    media.length > 0 ? 'px-gutter' : ''
                  }`}
                >
                  {data.description}
                </Text>
              )}
            </Animated.View>

            {/* The odds, with no option names: the labels are on the
                cards directly below, in their own colour and on the thing you
                press, so printing them here is the same two words twice. */}
            <Animated.View entering={FadeInDown.delay(60).duration(motion.duration.base)}>
              <OddsBar
                slices={slices}
                winningId={isResolved ? data.winning_option_id ?? null : null}
                size="lg"
                compact
                showNames={false}
                figurePx={28}
                barPx={3}
                gapPx={12}
              />
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
              className="mt-5 flex-row flex-wrap gap-2.5"
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
                  currency={data.group?.currency}
                  // No payoff line on a forfeit: there is no pot to divide,
                  // and "+$0.00 each" is worse than saying nothing.
                  shareAgorot={
                    canJoin && !isForfeit(data)
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

            {/* Yours to call, said where the sides are.

                The creator's controls used to be a titled section at the foot
                of the screen, under the comments — the furthest point from the
                two options the decision is actually between. It is one row
                now, directly below them, and pressing it asks which side was
                right with those same two labels.

                It was Spring Mint, on the reasoning that `brand` marks status
                and calling a bet is a change of status. In the app that read
                as a neon glow — mint text and mint rule over a green wash,
                three greens in a row — and it sat beside two green-and-red
                side buttons that mean something else entirely.

                It is the accent now, which is the rule the rest of the app
                already follows: blue carries every action, and for the
                creator this is *the* action. The row shape is what keeps it
                from being mistaken for a side — the two options are squares,
                this is a full-width row with a disc and a chevron — rather
                than the colour doing that job. */}
            {isCreator && !isResolved && !isCancelled && (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Call this bet — pick the side that was right"
                disabled={busy}
                scaleTo={0.985}
                onPress={() => setCalling(true)}
                className="mt-4 flex-row items-center gap-3 rounded-2xl border border-accent bg-accent-soft px-4 py-3.5"
              >
                <View className="h-[30px] w-[30px] items-center justify-center rounded-full bg-accent">
                  <CheckIcon size={17} color={colors.accentInk} />
                </View>
                <View className="flex-1">
                  <Text className="text-subhead font-bold text-accent">Call it</Text>
                  <Text className="mt-0.5 text-xs text-secondary">
                    Pick the side that was right
                  </Text>
                </View>
                <ChevronRightIcon size={16} color={colors.brand} />
              </PressableScale>
            )}

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

            {/* What is left of the creator's controls once calling it has
                moved up beside the sides. Locking and cancelling are rare and
                neither is the thing you came back to do, so they stay at the
                foot of the screen. */}
            {isCreator && !isResolved && !isCancelled && (
              <View className="mt-7">
                <SectionTitle>You created this bet</SectionTitle>
                <View className="rounded-3xl border border-hairline bg-surface p-4">
                  <Text className="mb-4 text-sm leading-[18px] text-secondary">
                    Bets can&apos;t be edited — only locked, called or cancelled.
                  </Text>
                  <View className="gap-3">
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

        <DetailTopBar onBack={() => router.back()} onMedia={media.length > 0} />
        <TabBarScrim />
        <FloatingTabBar active="index" onSelect={(t) => router.navigate(t.href)} />

        {/* Which side was right, asked with the same two labels and the same
            two colours the options carry. Picking one here is the whole
            resolve: one tap from the row, rather than a scroll to a section
            and then a button. */}
        <Modal
          visible={calling}
          transparent
          animationType="fade"
          onRequestClose={() => setCalling(false)}
        >
          <Pressable
            className="flex-1 justify-end bg-scrim"
            onPress={() => setCalling(false)}
            accessibilityLabel="Close"
          >
            <View className="rounded-t-[30px] border-t border-hairline-strong bg-surface2 px-gutter pb-10 pt-3">
              <View className="mb-5 h-1 w-9 self-center rounded-full bg-hairline-strong" />
              <Text className="text-xl font-bold text-primary">Which side was right?</Text>
              <Text className="mt-1.5 text-subhead leading-5 text-secondary">
                Everybody is paid the moment you pick. This cannot be undone.
              </Text>
              <View className="mt-5 gap-3">
                {slices.map((slice, index) => (
                  <PressableScale
                    key={slice.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${slice.label} won`}
                    disabled={busy}
                    onPress={() => {
                      setCalling(false);
                      confirmResolve(slice.id);
                    }}
                    style={{ borderColor: optionColor(index, slices.length, scheme) }}
                    className="h-[52px] flex-row items-center justify-center gap-2 rounded-2xl border bg-surface"
                  >
                    <TrophyIcon size={16} color={optionColor(index, slices.length, scheme)} />
                    <Text
                      numberOfLines={1}
                      style={{ color: optionColor(index, slices.length, scheme) }}
                      className="text-callout font-bold"
                    >
                      {slice.label}
                    </Text>
                  </PressableScale>
                ))}
              </View>
            </View>
          </Pressable>
        </Modal>

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
  currency,
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
  /** The group's, since the pot is denominated by the group and not the bet. */
  currency?: string | null;
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
      <View className="flex-row items-center gap-1.5">
        <Text
          numberOfLines={1}
          style={dimmed ? undefined : { color }}
          className={`flex-1 text-base font-bold ${dimmed ? 'text-tertiary' : ''}`}
        >
          {label}
        </Text>
        {won === true && <TrophyIcon size={15} color={colors.positive} />}
      </View>

      {/* The payoff sits right under the label and in the side's own colour:
          it is the consequence of this square, not a footnote to it. Hidden
          once the bet closes, because the number would be a promise nobody
          can take. */}
      {shareAgorot !== null && (
        <Text
          style={dimmed ? undefined : { color }}
          className={`mt-[5px] text-sm ${dimmed ? 'text-tertiary' : ''}`}
        >
          {selected ? 'Tap to withdraw' : `+${formatMoney(shareAgorot, currency)} each`}
        </Text>
      )}

      <View className="flex-1" />

      {/* The roster as a stack, not a list of names. Four faces and a count
          fit on one line; four rows of name did not, and the card had to grow
          to a different height for every option. */}
      <View className="mt-3.5 flex-row items-center gap-2">
        {people.length === 0 ? (
          <Text className="text-xs text-tertiary">Nobody yet</Text>
        ) : (
          <>
            <AvatarStack people={people} size={22} max={4} />
            <Text style={tabular} className="text-xs text-secondary">
              {people.length}
            </Text>
          </>
        )}
      </View>
    </>
  );

  // Two fill the row; three or more take half and wrap.
  const sizing = { flexBasis: count === 2 ? 0 : '47%' as const, flexGrow: 1 };

  if (!pressable) {
    return (
      <View
        style={sizing}
        className={`h-[114px] rounded-[18px] border bg-surface px-[15px] pb-[13px] pt-[15px] ${
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
      // The side you are on is outlined *and* filled, in its own colour: a
      // 2pt rule alone over the same ground as the other square read as a
      // focus ring rather than as a choice already made.
      style={{
        ...sizing,
        borderWidth: selected ? 2 : 1,
        ...(selected
          ? { borderColor: color, backgroundColor: optionSoftColor(index, count, scheme) }
          : null),
      }}
      className={`h-[114px] rounded-[18px] px-[15px] pb-[13px] pt-[15px] ${
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
              <Money agorot={myAmountAgorot} currency={bet.group?.currency} size="xl" sign />
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
