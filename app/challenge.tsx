import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn } from '@/components/animated';

import { ContentWidth, Screen } from '@/components/screen';
import {
  Avatar,
  Button,
  Divider,
  ErrorNotice,
  PressableScale,
  SectionTitle,
  Skeleton,
} from '@/components/ui';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import type { UserLookup } from '@/lib/database.types';
import { createDuel, searchUsersByUsername } from '@/lib/queries';
import { useColors } from '@/providers/theme-provider';

/** Matches the SQL floor. Below it the RPC returns nothing by design. */
const MIN_QUERY = 2;

/**
 * Challenge one person, and start a duel with them.
 *
 * ---------------------------------------------------------------------------
 * There is a search now, and it is narrow on purpose
 * ---------------------------------------------------------------------------
 * This screen used to take an exact handle and nothing else, because a prefix
 * search over the user table is a user-enumeration endpoint. That trade was
 * reconsidered: an exact-handle field means you cannot challenge anybody whose
 * handle you cannot spell, which in practice is most people, and asking a
 * friend to spell their username before you can bet them is the kind of
 * friction that ends the session.
 *
 * So `search_users_by_username` exists, and it gives away as little as a
 * prefix search can — prefix rather than contains, two characters minimum, ten
 * rows, handle and name and avatar only. The head of `…_username_search.sql`
 * records the whole reasoning, including the part it does not solve.
 *
 * ---------------------------------------------------------------------------
 * Picking is two taps, not one
 * ---------------------------------------------------------------------------
 * Tapping a result selects that person; a second, separate button starts the
 * duel. Collapsing the two would mean a mis-tap in a live-updating list
 * creates a real group with somebody you did not mean to challenge, and there
 * is no undo for that — `create_duel` reuses the group forever after.
 *
 * Underneath, a duel is a private two-person group. That is invisible here on
 * purpose: from the outside this is "you versus them", and every bet, balance
 * and settle-up between you lands in one place because it is the same group
 * every time you challenge them again.
 */
export default function ChallengeScreen() {
  const router = useRouter();
  const colors = useColors();
  const reduced = useReducedMotion();

  const [handle, setHandle] = useState('');
  const [results, setResults] = useState<UserLookup[]>([]);
  const [picked, setPicked] = useState<UserLookup | null>(null);
  const [searching, setSearching] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clean = handle.trim().replace(/^@/, '');
  // Once somebody is picked the list has done its job and the screen is about
  // one person. Typing again is what brings it back.
  const showResults = !picked && clean.length >= MIN_QUERY;

  // Search as they type, but only once they have stopped. Every keystroke
  // would be a round trip, and at 350ms a normal typing speed produces one
  // request for a whole handle rather than eight for its prefixes.
  useEffect(() => {
    if (clean.length < MIN_QUERY) {
      setResults([]);
      setSearching(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const found = await searchUsersByUsername(clean);
          if (cancelled) return;
          setResults(found);
          setError(null);
        } catch (err) {
          if (!cancelled) {
            setResults([]);
            setError(err instanceof Error ? err.message : 'Could not look that up.');
          }
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

  function onType(next: string) {
    setHandle(next);
    // A selection belongs to the handle that produced it. Leaving it up while
    // the field says something else is the shape of bug where you challenge
    // the person you looked at two searches ago.
    if (picked) setPicked(null);
  }

  function pick(user: UserLookup) {
    setPicked(user);
    setError(null);
    // The field becomes the record of who is selected, so the row and the
    // input never disagree about it.
    setHandle(user.username);
  }

  async function start() {
    if (!picked) return;
    setStarting(true);
    setError(null);
    try {
      const group = await createDuel(picked.username);
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
        <ContentWidth className="flex-1">
          <SectionTitle>Who are you betting?</SectionTitle>

          <View className="flex-row items-center gap-1 rounded-2xl border border-hairline bg-surface px-4">
            <Text className="text-xl font-semibold text-tertiary">@</Text>
            <TextInput
              value={handle}
              onChangeText={onType}
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
            Start typing their username. You don&apos;t need to be in a group together.
          </Text>

          {error && (
            <View className="mt-4">
              <ErrorNotice message={error} />
            </View>
          )}

          {showResults && (
            <ScrollView
              className="mt-5"
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View className="overflow-hidden rounded-2xl border border-hairline bg-surface">
                {searching && results.length === 0 ? (
                  // Skeletons rather than a spinner: the shape of a result row
                  // is known, and three is what the list usually returns.
                  <ResultSkeletons />
                ) : results.length === 0 ? (
                  <Text className="px-4 py-5 text-base text-secondary">
                    No one is using that username.
                  </Text>
                ) : (
                  results.map((user, index) => (
                    <View key={user.id}>
                      {index > 0 && <Divider className="ml-16" />}
                      <PressableScale
                        onPress={() => pick(user)}
                        accessibilityRole="button"
                        accessibilityLabel={`${user.display_name}, @${user.username}`}
                        className="flex-row items-center gap-3 px-4 py-3"
                      >
                        <Avatar
                          id={user.id}
                          name={user.display_name}
                          uri={user.avatar_url}
                          size={40}
                        />
                        <View className="flex-1">
                          <Text
                            numberOfLines={1}
                            className="text-base font-semibold text-primary"
                          >
                            {user.display_name}
                          </Text>
                          <Text numberOfLines={1} className="text-sm text-secondary">
                            @{user.username}
                          </Text>
                        </View>
                      </PressableScale>
                    </View>
                  ))
                )}
              </View>
            </ScrollView>
          )}

          {picked && (
            <Animated.View entering={reduced ? undefined : FadeIn} className="mt-6">
              <View className="flex-row items-center gap-3 rounded-3xl border border-hairline bg-surface p-4">
                <Avatar
                  id={picked.id}
                  name={picked.display_name}
                  uri={picked.avatar_url}
                  size={44}
                />
                <View className="flex-1">
                  <Text numberOfLines={1} className="text-base font-semibold text-primary">
                    {picked.display_name}
                  </Text>
                  <Text numberOfLines={1} className="text-sm text-secondary">
                    @{picked.username}
                  </Text>
                </View>
              </View>

              <View className="mt-4">
                <Button
                  title={starting ? 'Starting' : `Challenge ${picked.display_name}`}
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

function ResultSkeletons() {
  return (
    <View>
      {[0, 1, 2].map((i) => (
        <View key={i} className="flex-row items-center gap-3 px-4 py-3">
          <Skeleton width={40} height={40} radius={20} />
          <View className="flex-1 gap-1.5">
            <Skeleton width="52%" height={15} />
            <Skeleton width="32%" height={12} />
          </View>
        </View>
      ))}
    </View>
  );
}
