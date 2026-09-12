import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn } from '@/components/animated';

import { ContentWidth, Screen } from '@/components/screen';
import {
  Avatar,
  Button,
  ErrorNotice,
  PressableScale,
  SectionTitle,
} from '@/components/ui';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import type { UserLookup } from '@/lib/database.types';
import { createDuel, findUserByUsername } from '@/lib/queries';
import { useColors } from '@/providers/theme-provider';

/**
 * Challenge one person, by handle, whether or not you share a group.
 *
 * You type a handle you already know. There is no search and no browsing —
 * a prefix lookup over the user table would be a way to harvest every account
 * on the service, so the only thing the server will answer is an exact match.
 *
 * Underneath, accepting creates a private two-person group. That is invisible
 * here on purpose: from the outside this is "you versus them", and every bet,
 * balance and settle-up between you lands in one place because it is the same
 * group every time you challenge them again.
 */
export default function ChallengeScreen() {
  const router = useRouter();
  const colors = useColors();
  const reduced = useReducedMotion();

  const [handle, setHandle] = useState('');
  const [found, setFound] = useState<UserLookup | null>(null);
  const [searching, setSearching] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clean = handle.trim().replace(/^@/, '');

  // Look up as they type, but only once they have stopped. Every keystroke
  // would be a round trip for an answer that is only useful when the handle is
  // complete.
  useEffect(() => {
    if (clean.length < 3) {
      setFound(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const user = await findUserByUsername(clean);
          if (cancelled) return;
          setFound(user);
          setError(user ? null : 'No one is using that username.');
        } catch (err) {
          if (!cancelled) setError(err instanceof Error ? err.message : 'Could not look that up.');
        } finally {
          if (!cancelled) setSearching(false);
        }
      })();
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [clean]);

  async function start() {
    if (!found) return;
    setStarting(true);
    setError(null);
    try {
      const group = await createDuel(found.username);
      // Straight into posting the bet: the challenge is the reason they came
      // here, and an empty group screen is a dead end.
      router.replace({ pathname: '/group/[id]/new-bet', params: { id: group.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start that challenge.');
      setStarting(false);
    }
  }

  return (
    <Screen ground="sunken">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 px-gutter pt-6"
      >
        <ContentWidth>
          <SectionTitle>Their username</SectionTitle>

          <View className="flex-row items-center gap-1 rounded-2xl border border-hairline bg-surface px-4">
            <Text className="text-xl font-semibold text-tertiary">@</Text>
            <TextInput
              value={handle}
              onChangeText={setHandle}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              placeholder="username"
              placeholderTextColor={colors.textTertiary}
              accessibilityLabel="Their username"
              className="flex-1 py-4 text-lg text-primary"
              // See NativeWind gotcha 4b: without this the input keeps its
              // intrinsic width and the row cannot shrink.
              style={{ color: colors.text, minWidth: 0 }}
            />
          </View>

          <Text className="mt-2.5 px-1 text-sm text-secondary">
            You don&apos;t need to be in a group together. Ask them for their username — there&apos;s
            no way to search for people.
          </Text>

          {error && !searching && (
            <View className="mt-4">
              <ErrorNotice message={error} />
            </View>
          )}

          {found && (
            <Animated.View entering={reduced ? undefined : FadeIn} className="mt-6">
              <PressableScale
                onPress={() => void start()}
                disabled={starting}
                accessibilityRole="button"
                accessibilityLabel={`Challenge ${found.display_name}`}
                className="flex-row items-center gap-3 rounded-3xl border border-hairline bg-surface p-4"
              >
                <Avatar
                  id={found.id}
                  name={found.display_name}
                  uri={found.avatar_url}
                  size={44}
                />
                <View className="flex-1">
                  <Text numberOfLines={1} className="text-base font-semibold text-primary">
                    {found.display_name}
                  </Text>
                  <Text numberOfLines={1} className="text-sm text-secondary">
                    @{found.username}
                  </Text>
                </View>
              </PressableScale>

              <View className="mt-4">
                <Button
                  title={starting ? 'Starting' : `Challenge ${found.display_name}`}
                  variant="primary"
                  size="lg"
                  loading={starting}
                  disabled={starting}
                  onPress={() => void start()}
                />
              </View>

              <Text className="mt-2.5 px-1 text-sm text-tertiary">
                Just the two of you. Nobody else sees these bets, and what you owe each other shows
                up on your profile.
              </Text>
            </Animated.View>
          )}
        </ContentWidth>
      </KeyboardAvoidingView>
    </Screen>
  );
}
