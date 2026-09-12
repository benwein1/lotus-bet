import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeIn } from '@/components/animated';

import { GroupGlyph } from '@/components/group-glyph';
import { ContentWidth, Screen } from '@/components/screen';
import { Button, ErrorNotice, Loading } from '@/components/ui';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import type { GroupRow } from '@/lib/database.types';
import { forgetPendingInvite, rememberInvite } from '@/lib/invites';
import { joinGroupWithInvite } from '@/lib/queries';
import { useAuth } from '@/providers/auth-provider';

/**
 * What an invite link opens.
 *
 * It redeems on arrival rather than showing a "Join?" button first. The person
 * tapping a link somebody sent them in a chat has already decided; making them
 * confirm a second time is a step that exists only to have a screen. What they
 * get instead is the group's name the moment it resolves, and a way in.
 *
 * The hard part is not the joining — it is that whoever you sent this to
 * probably does not have an account. They arrive signed out, the redirect gate
 * in `_layout.tsx` sends them to sign-in, and the token has to survive that
 * round trip or they finish signing up and land on an empty Groups tab with no
 * idea what went wrong. So the token is parked in storage on the way past and
 * the gate brings them back here.
 */
export default function JoinByLinkScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const { session, loading } = useAuth();
  const reduced = useReducedMotion();

  const [group, setGroup] = useState<GroupRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One attempt per token, however many times React re-runs the effect.
  const attempted = useRef<string | null>(null);

  useEffect(() => {
    const clean = token?.trim();
    if (!clean || loading) return;

    if (!session) {
      // Park it and let the gate do the redirecting — racing it with our own
      // `replace` here is how you get two navigations fighting over one stack.
      void rememberInvite(clean);
      return;
    }

    if (attempted.current === clean) return;
    attempted.current = clean;

    void (async () => {
      try {
        const joined = await joinGroupWithInvite(clean);
        // It worked; nothing should replay it after a later sign-out.
        await forgetPendingInvite();
        setGroup(joined);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'That invite link did not work.');
        await forgetPendingInvite();
      }
    })();
  }, [token, session, loading]);

  if (loading || (!error && !group)) {
    return (
      <Screen ground="sunken" className="items-center justify-center">
        <Loading label="Opening your invite" />
      </Screen>
    );
  }

  return (
    <Screen ground="sunken">
      <View className="flex-1 justify-center px-gutter">
        <ContentWidth>
          {error ? (
            <Animated.View entering={reduced ? undefined : FadeIn} className="gap-5">
              <ErrorNotice message={error} />
              <Text className="px-1 text-subhead leading-5 text-secondary">
                Links run out after a week. Ask whoever sent it for a fresh one — or join with
                the group&apos;s six-character code instead.
              </Text>
              <View className="gap-3">
                <Button
                  title="Enter a code"
                  variant="primary"
                  size="lg"
                  onPress={() => router.replace('/group/join')}
                />
                <Button
                  title="Not now"
                  variant="plain"
                  size="lg"
                  onPress={() => router.replace('/(tabs)')}
                />
              </View>
            </Animated.View>
          ) : group ? (
            <Animated.View entering={reduced ? undefined : FadeIn} className="items-center gap-5">
              <GroupGlyph
                name={group.name}
                emoji={group.emoji}
                avatarUrl={group.avatar_url ?? null}
                size={84}
              />
              <View className="items-center gap-1.5">
                <Text className="text-center text-2xl font-bold text-primary">
                  You&apos;re in
                </Text>
                <Text className="text-center text-base leading-5 text-secondary">
                  {group.name}
                </Text>
              </View>
              <View className="w-full gap-3">
                <Button
                  title="Open the group"
                  variant="primary"
                  size="lg"
                  onPress={() =>
                    router.replace({ pathname: '/group/[id]', params: { id: group.id } })
                  }
                />
              </View>
            </Animated.View>
          ) : null}
        </ContentWidth>
      </View>
    </Screen>
  );
}
