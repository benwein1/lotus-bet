import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, RefreshControl, ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from '@/components/animated';

import { BetCard } from '@/components/bet-card';
import { GroupGlyph } from '@/components/group-glyph';
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
  Button,
  EmptyState,
  ErrorNotice,
  Loading,
  Money,
  PressableScale,
  SectionTitle,
} from '@/components/ui';
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
import { useAuth } from '@/providers/auth-provider';
import { useColors } from '@/providers/theme-provider';
import { motion } from '@/theme';

export default function GroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = id ?? '';
  const router = useRouter();
  const { session, profile } = useAuth();
  const colors = useColors();
  const userId = session?.user.id ?? '';

  const group = useAsync(() => fetchGroup(groupId), [groupId]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
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
  // missing from "Live bets" when you came back. Realtime carries other
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
      await shareInvite(group.data.name, inviteUrl(invite.token, linkTargets()), profile?.display_name);
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

  const myBalance = Number(
    (balances.data ?? []).find((row) => row.user_id === userId)?.amount_agorot ?? 0
  );
  const openBets = bets.data?.live ?? [];
  const pastBets = bets.data?.past ?? [];
  const morePast = bets.data?.morePast ?? false;

  return (
    <>
      <Stack.Screen options={{ title: group.data.name }} />
      <Screen ground="sunken">
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
            {/* Identity + your position, the two things you open a group for */}
            <Animated.View entering={FadeInDown.duration(motion.duration.base)}>
              <View className="mb-7 pt-4">
                <View className="flex-row items-start gap-3">
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
                      <GroupGlyph
                        emoji={group.data.emoji}
                        avatarUrl={group.data.avatar_url}
                        name={group.data.name}
                        size={52}
                        radius={17}
                      />
                      <View className="absolute -bottom-1 -right-1 h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-canvas bg-accent">
                        <CameraIcon size={11} color={colors.accentInk} />
                      </View>
                    </PressableScale>
                  ) : (
                    <GroupGlyph
                      emoji={group.data.emoji}
                      avatarUrl={group.data.avatar_url}
                      name={group.data.name}
                      size={52}
                      radius={17}
                    />
                  )}
                  <View className="flex-1">
                    <Text numberOfLines={2} className="text-2xl font-bold text-primary">
                      {group.data.name}
                    </Text>
                    <Text className="mt-1 text-subhead text-secondary">
                      {group.data.members.length}{' '}
                      {group.data.members.length === 1 ? 'member' : 'members'},{' '}
                      {openBets.length === 0
                        ? 'nothing running'
                        : `${openBets.length} running`}
                    </Text>
                  </View>
                </View>

                {photoError && (
                  <View className="mt-4">
                    <ErrorNotice message={photoError} />
                  </View>
                )}

                <View className="mt-5 flex-row items-end justify-between rounded-3xl border border-hairline bg-surface p-4">
                  <View>
                    <Text className="text-sm text-secondary">Your position here</Text>
                    <View className="mt-1">
                      {myBalance === 0 ? (
                        <Text className="text-2xl font-bold text-primary">Square</Text>
                      ) : (
                        <Money agorot={myBalance} currency={group.data?.currency} size="lg" sign />
                      )}
                    </View>
                  </View>
                  <Button
                    title="Settle up"
                    variant="tinted"
                    size="sm"
                    icon={<HandshakeIcon size={15} color={colors.accent} />}
                    onPress={() =>
                      router.push({ pathname: '/group/[id]/settle', params: { id: groupId } })
                    }
                  />
                </View>
              </View>
            </Animated.View>

            {/* Members + invite */}
            <Animated.View entering={FadeInDown.delay(60).duration(motion.duration.base)}>
              <View className="mb-7">
                <SectionTitle>Members</SectionTitle>
                <View className="overflow-hidden rounded-3xl border border-hairline bg-surface px-4">
                  {group.data.members.map((member, i) => (
                    <View
                      key={member.user_id}
                      className={`flex-row items-center gap-3 py-3 ${
                        i === group.data!.members.length - 1 ? '' : 'border-b border-hairline'
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
                    for reading out loud to someone sitting next to you. A duel
                    gets neither — it is two people by definition. */}
                {group.data.kind !== 'duel' && (
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
                          {group.data.invite_code}
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
              </View>
            </Animated.View>

            <Animated.View entering={FadeIn.delay(120).duration(motion.duration.base)}>
              <Button
                title="New bet"
                size="lg"
                elevated
                icon={<PlusIcon size={18} color={colors.accentInk} />}
                onPress={() =>
                  router.push({ pathname: '/group/[id]/new-bet', params: { id: groupId } })
                }
                className="mb-7"
              />
            </Animated.View>

            {bets.error && <ErrorNotice message={bets.error} />}

            <View className="mb-7">
              <SectionTitle>Live bets</SectionTitle>
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
                <View>
                  {openBets.map((bet, i) => (
                    <BetCard key={bet.id} bet={bet} currentUserId={userId} index={i} />
                  ))}
                </View>
              )}
            </View>

            {pastBets.length > 0 && (
              <View>
                <SectionTitle>Settled and cancelled</SectionTitle>
                {pastBets.map((bet, i) => (
                  <BetCard key={bet.id} bet={bet} currentUserId={userId} index={i} />
                ))}
                {/* A group two years old has hundreds of these and used to
                    fetch every one of them, with every embed, on every open.
                    Explicit rather than infinite scroll: the section below a
                    group's live bets is history, and history is something you
                    go looking for. */}
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
              </View>
            )}
          </ContentWidth>
        </ScrollView>
      </Screen>
    </>
  );
}
