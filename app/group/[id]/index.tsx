import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Platform, RefreshControl, ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from '@/components/animated';

import { BetCard } from '@/components/bet-card';
import { GroupFace } from '@/components/group-face';
import {
  CameraIcon,
  CheckIcon,
  CopyIcon,
  ShareIcon,
  HandshakeIcon,
  PlusIcon,
  TicketIcon,
} from '@/components/icons';
import { ContentWidth, Screen } from '@/components/screen';
import { BetCardSkeleton } from '@/components/skeletons';
import {
  Avatar,
  AvatarStack,
  Button,
  EmptyState,
  ErrorNotice,
  Loading,
  Money,
  PressableScale,
} from '@/components/ui';
import { UnderlineTabs } from '@/components/underline-tabs';
import { useAsync } from '@/hooks/use-async';
import { useGroupRealtime } from '@/hooks/use-group-realtime';
import { inviteUrl, linkTargets, shareInvite } from '@/lib/invites';
import { pickAvatar, uploadAvatar } from '@/lib/media';
import {
  createGroupInvite,
  fetchGroup,
  fetchGroupBalances,
  fetchGroupBets,
  GROUP_HISTORY_PAGE,
  updateGroupAvatar,
} from '@/lib/queries';
import type { BetWithPositions } from '@/lib/database.types';
import { useAuth } from '@/providers/auth-provider';
import { useColors } from '@/providers/theme-provider';
import { motion } from '@/theme';

type TabKey = 'live' | 'settled' | 'people' | 'activity';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'live', label: 'Live Bets' },
  { key: 'settled', label: 'Settled' },
  { key: 'people', label: 'People' },
  { key: 'activity', label: 'Activity' },
];

/**
 * One group.
 *
 * Everything the screen used to stack — identity, your balance, the member
 * list, two invite controls, a new-bet button, live bets and history — is now
 * four tabs under one header, with Live Bets first because the bets are what
 * the page is for. The header itself sits on the page ground rather than on a
 * photo banner: the picture survives as the face, which is enough identity for
 * a screen you arrived at by name.
 */
export default function GroupDetailScreen() {
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const groupId = id ?? '';
  const router = useRouter();
  const { session, profile } = useAuth();
  const colors = useColors();
  const userId = session?.user.id ?? '';

  const group = useAsync(() => fetchGroup(groupId), [groupId]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  // The Groups tab points a group's face here, so arriving from it opens on
  // the people rather than on the bets.
  const [active, setActive] = useState<TabKey>(tab === 'people' ? 'people' : 'live');
  // How much settled history is on screen. Live bets are never paged — see
  // `fetchGroupBets`.
  const [pastLimit, setPastLimit] = useState(GROUP_HISTORY_PAGE);
  const bets = useAsync(() => fetchGroupBets(groupId, pastLimit), [groupId, pastLimit]);
  const balances = useAsync(() => fetchGroupBalances(groupId), [groupId]);

  // Depend on the `reload` functions, not the state objects: `useAsync`
  // returns a new object every render, which would make `refresh` — and so the
  // Realtime subscription that keys off it — unstable.
  const { reload: reloadBets } = bets;
  const { reload: reloadBalances } = balances;
  const { reload: reloadGroup } = group;

  const refresh = useCallback(() => {
    void reloadBets({ silent: true });
    void reloadBalances({ silent: true });
    void reloadGroup({ silent: true });
  }, [reloadBets, reloadBalances, reloadGroup]);

  useGroupRealtime(groupId, refresh);

  const isAdmin =
    group.data?.members.some((m) => m.user_id === userId && m.role === 'admin') ?? false;

  async function changePhoto() {
    setPhotoError(null);
    try {
      const picked = await pickAvatar();
      if (!picked) return;
      setPhotoBusy(true);
      const url = await uploadAvatar({ kind: 'groups', id: groupId }, picked);
      await updateGroupAvatar(groupId, url);
      await reloadGroup({ silent: true });
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Could not set that photo.');
    } finally {
      setPhotoBusy(false);
    }
  }

  // This screen stays mounted underneath the new-bet and bet-detail screens
  // pushed on top of it, so without this a bet you just posted would be
  // missing from "Live Bets" when you came back. Realtime carries other
  // people's changes; this carries your own.
  useFocusEffect(refresh);

  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  /**
   * Mint (or reuse) a link and hand it to the OS share sheet.
   *
   * The link is made on demand rather than up front: most people open a group
   * to look at bets, not to invite anyone, and a row in `group_invites` per
   * screen view would be a table full of links nobody sent.
   */
  async function shareLink() {
    if (!group.data || sharing) return;
    setSharing(true);
    setShareError(null);
    try {
      const invite = await createGroupInvite(group.data.id);
      await shareInvite(
        group.data.name,
        inviteUrl(invite.token, linkTargets()),
        profile?.display_name
      );
    } catch (err) {
      setShareError(err instanceof Error ? err.message : 'Could not make an invite link.');
    } finally {
      setSharing(false);
    }
  }

  async function copyInvite() {
    if (!group.data) return;
    await Clipboard.setStringAsync(group.data.invite_code);
    if (Platform.OS !== 'web') {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const openBets = useMemo(() => bets.data?.live ?? [], [bets.data]);
  const pastBets = useMemo(() => bets.data?.past ?? [], [bets.data]);

  if (group.loading) return <Loading label="Loading group…" />;
  if (!group.data) {
    return (
      <Screen className="px-gutter pt-10">
        <ErrorNotice message={group.error ?? 'This group is not available.'} />
        <Button
          title="Back to your groups"
          variant="tinted"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/groups'))}
        />
      </Screen>
    );
  }

  const data = group.data;
  const myBalance = Number(
    (balances.data ?? []).find((row) => row.user_id === userId)?.amount_agorot ?? 0
  );
  const morePast = bets.data?.morePast ?? false;
  const members = data.members.map((m) => ({
    id: m.user_id,
    name: m.user?.display_name ?? '?',
    avatarUrl: m.user?.avatar_url ?? null,
  }));

  return (
    <>
      <Stack.Screen options={{ title: data.name }} />
      <Screen>
        <ScrollView
          contentContainerClassName="px-gutter pb-12 pt-2"
          refreshControl={
            <RefreshControl
              refreshing={bets.refreshing}
              onRefresh={refresh}
              tintColor={colors.textTertiary}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          <ContentWidth>
            <Animated.View entering={FadeInDown.duration(motion.duration.base)}>
              <View className="flex-row items-center gap-3 pt-3">
                {isAdmin ? (
                  // Only an admin can write under `groups/<id>/` in storage,
                  // so only an admin is offered the control.
                  <PressableScale
                    onPress={() => void changePhoto()}
                    disabled={photoBusy}
                    scaleTo={0.94}
                    accessibilityRole="button"
                    accessibilityLabel="Change the group photo"
                    accessibilityState={{ busy: photoBusy }}
                    className={photoBusy ? 'opacity-60' : ''}
                  >
                    <GroupFace
                      avatarUrl={data.avatar_url}
                      members={members}
                      size={56}
                      radius={18}
                    />
                    <View className="absolute -bottom-1 -right-1 h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-canvas bg-accent">
                      <CameraIcon size={11} color={colors.accentInk} />
                    </View>
                  </PressableScale>
                ) : (
                  <GroupFace avatarUrl={data.avatar_url} members={members} size={56} radius={18} />
                )}

                <View className="min-w-0 flex-1">
                  <Text numberOfLines={1} className="text-xl font-bold text-primary">
                    {data.name}
                  </Text>
                  <View className="mt-1.5">
                    <AvatarStack people={members} size={20} max={5} />
                  </View>
                </View>

                {/* The balance is the control. Settle up used to be a button
                    beside it; with four tabs and none of them about money, the
                    figure people already look at is the thing to press. */}
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={`Settle up in ${data.name}`}
                  scaleTo={0.96}
                  onPress={() =>
                    router.push({ pathname: '/group/[id]/settle', params: { id: groupId } })
                  }
                  className="items-end"
                >
                  {myBalance === 0 ? (
                    <Text className="text-lg font-bold text-primary">Square</Text>
                  ) : (
                    <Money agorot={myBalance} currency={data.currency} size="md" sign />
                  )}
                  <Text className="mt-1 text-2xs text-tertiary">
                    {myBalance === 0
                      ? 'nothing owed'
                      : myBalance > 0
                        ? 'owed to you'
                        : 'you owe'}
                  </Text>
                </PressableScale>
              </View>

              {photoError && (
                <View className="mt-4">
                  <ErrorNotice message={photoError} />
                </View>
              )}
            </Animated.View>

            <View className="mt-6">
              <UnderlineTabs tabs={TABS} value={active} onChange={setActive} />
            </View>

            {bets.error && <ErrorNotice message={bets.error} />}

            <View className="mt-4">
              {active === 'live' && (
                <>
                  <NewBetRow
                    name={data.name}
                    onPress={() =>
                      router.push({ pathname: '/group/[id]/new-bet', params: { id: groupId } })
                    }
                  />
                  <View className="mt-3">
                    {bets.loading ? (
                      <>
                        <BetCardSkeleton />
                        <BetCardSkeleton />
                      </>
                    ) : openBets.length === 0 ? (
                      <View className="rounded-3xl border border-hairline bg-surface">
                        <EmptyState
                          icon={<TicketIcon size={26} color={colors.textSecondary} />}
                          title="Nothing running"
                          body="Start the first bet — pick a question with exactly two answers."
                        />
                      </View>
                    ) : (
                      openBets.map((bet, i) => (
                        <BetCard key={bet.id} bet={bet} currentUserId={userId} index={i} />
                      ))
                    )}
                  </View>
                </>
              )}

              {active === 'settled' && (
                <>
                  {pastBets.length === 0 ? (
                    <View className="rounded-3xl border border-hairline bg-surface">
                      <EmptyState
                        icon={<CheckIcon size={26} color={colors.textSecondary} />}
                        title="Nothing settled yet"
                        body="Bets that have been called or cancelled end up here."
                      />
                    </View>
                  ) : (
                    <>
                      {pastBets.map((bet, i) => (
                        <BetCard key={bet.id} bet={bet} currentUserId={userId} index={i} />
                      ))}
                      {/* A group two years old has hundreds of these and used
                          to fetch every one on every open. Explicit rather
                          than infinite scroll: history is something you go
                          looking for. */}
                      {morePast && (
                        <View className="mt-2">
                          <Button
                            title="Load older bets"
                            variant="plain"
                            loading={bets.refreshing}
                            onPress={() => setPastLimit((n) => n + GROUP_HISTORY_PAGE)}
                          />
                        </View>
                      )}
                    </>
                  )}
                </>
              )}

              {active === 'people' && (
                <>
                  <View className="overflow-hidden rounded-3xl border border-hairline bg-surface px-4">
                    {data.members.map((member, i) => (
                      <View
                        key={member.user_id}
                        className={`flex-row items-center gap-3 py-3 ${
                          i === data.members.length - 1 ? '' : 'border-b border-hairline'
                        }`}
                      >
                        <Avatar
                          name={member.user?.display_name ?? '?'}
                          id={member.user_id}
                          uri={member.user?.avatar_url}
                          size={34}
                        />
                        <Text className="flex-1 text-base text-primary">
                          {member.user?.display_name ?? 'Unknown'}
                          {member.user_id === userId && (
                            <Text className="text-secondary"> (you)</Text>
                          )}
                        </Text>
                        {member.role === 'admin' && (
                          <Text className="text-sm text-secondary">Admin</Text>
                        )}
                      </View>
                    ))}
                  </View>

                  {/* Two ways in, in the order people actually use them. A link
                      goes in the chat the group already lives in; the code is
                      for reading out loud to someone sitting next to you. A
                      duel gets neither — it is two people by definition. */}
                  {data.kind !== 'duel' && (
                    <View className="mt-3 gap-2.5">
                      <Button
                        title={sharing ? 'Preparing link' : 'Share invite'}
                        variant="tinted"
                        size="lg"
                        loading={sharing}
                        disabled={sharing}
                        icon={<ShareIcon size={18} color={colors.accent} />}
                        onPress={() => void shareLink()}
                      />

                      {shareError && <ErrorNotice message={shareError} />}

                      <PressableScale
                        onPress={copyInvite}
                        scaleTo={0.985}
                        accessibilityRole="button"
                        accessibilityLabel="Copy invite code"
                        className="flex-row items-center justify-between rounded-3xl border border-hairline bg-surface px-4 py-4"
                      >
                        <View>
                          <Text className="text-sm text-secondary">Or read out the code</Text>
                          <Text className="mt-0.5 text-xl font-bold tracking-[4px] text-primary">
                            {data.invite_code}
                          </Text>
                        </View>
                        <View className="flex-row items-center gap-1.5">
                          {copied ? (
                            <CheckIcon size={16} color={colors.positive} />
                          ) : (
                            <CopyIcon size={16} color={colors.accent} />
                          )}
                          <Text
                            className={`text-subhead font-semibold ${
                              copied ? 'text-positive' : 'text-accent'
                            }`}
                          >
                            {copied ? 'Copied' : 'Copy'}
                          </Text>
                        </View>
                      </PressableScale>
                    </View>
                  )}
                </>
              )}

              {active === 'activity' && (
                <ActivityList
                  live={openBets}
                  past={pastBets}
                  onOpen={(betId) =>
                    router.push({ pathname: '/bet/[id]', params: { id: betId } })
                  }
                />
              )}
            </View>
          </ContentWidth>
        </ScrollView>
      </Screen>
    </>
  );
}

/**
 * The way to start a bet in this group: a row at the head of the list rather
 * than a button above the tabs.
 *
 * It says what it makes — "New bet in <group>" — which a floating plus cannot,
 * and it scrolls away with the list instead of sitting over it. The ring is
 * the same one the Groups tab creates from.
 */
function NewBetRow({ name, onPress }: { name: string; onPress: () => void }) {
  const colors = useColors();

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`New bet in ${name}`}
      onPress={onPress}
      scaleTo={0.985}
      className="flex-row items-center gap-3 rounded-2xl border border-dashed border-hairline-strong px-3.5 py-3"
    >
      <LinearGradient
        colors={[colors.markFrom, colors.markTo]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={{ width: 34, height: 34, borderRadius: 999, padding: 2 }}
      >
        <View className="flex-1 items-center justify-center rounded-full bg-canvas">
          <PlusIcon size={17} color={colors.text} />
        </View>
      </LinearGradient>
      <Text numberOfLines={1} className="flex-1 text-subhead font-semibold text-primary">
        New bet in {name}
      </Text>
    </PressableScale>
  );
}

/**
 * What has happened in this group, newest first.
 *
 * Built from the bets already on screen rather than from a new query: a bet
 * carries when it was opened and how it ended, which is every event this group
 * has. Nothing here is a second source of truth, so it cannot drift from the
 * bets above it.
 */
function ActivityList({
  live,
  past,
  onOpen,
}: {
  live: BetWithPositions[];
  past: BetWithPositions[];
  onOpen: (betId: string) => void;
}) {
  const colors = useColors();

  const events = useMemo(() => {
    const all = [...live, ...past].map((bet) => {
      const settled = bet.status === 'resolved' || bet.status === 'cancelled';
      return {
        id: bet.id,
        title: bet.title,
        who: bet.creator?.display_name ?? 'Someone',
        what:
          bet.status === 'resolved'
            ? 'called it'
            : bet.status === 'cancelled'
              ? 'called it off'
              : 'opened it',
        at: settled ? (bet.resolved_at ?? bet.created_at) : bet.created_at,
        settled,
      };
    });
    return all.sort((a, b) => (a.at < b.at ? 1 : -1));
  }, [live, past]);

  if (events.length === 0) {
    return (
      <View className="rounded-3xl border border-hairline bg-surface">
        <EmptyState
          icon={<HandshakeIcon size={26} color={colors.textSecondary} />}
          title="Nothing has happened yet"
          body="Once somebody opens a bet here, it shows up in this list."
        />
      </View>
    );
  }

  return (
    <Animated.View entering={FadeIn.duration(motion.duration.fast)}>
      {events.map((event, i) => (
        <PressableScale
          key={event.id}
          accessibilityRole="button"
          accessibilityLabel={`${event.who} ${event.what}: ${event.title}`}
          scaleTo={0.99}
          onPress={() => onOpen(event.id)}
          className={`flex-row items-start gap-3 py-3.5 ${
            i === events.length - 1 ? '' : 'border-b border-hairline'
          }`}
        >
          <View
            className={`mt-1.5 h-2 w-2 rounded-full ${
              event.settled ? 'bg-hairline-strong' : 'bg-brand'
            }`}
          />
          <View className="flex-1">
            <Text className="text-subhead leading-5 text-secondary">
              <Text className="font-semibold text-primary">{event.who}</Text> {event.what}
            </Text>
            <Text numberOfLines={1} className="mt-0.5 text-sm text-primary">
              {event.title}
            </Text>
          </View>
        </PressableScale>
      ))}
    </Animated.View>
  );
}
