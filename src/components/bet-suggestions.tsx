import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { GroupGlyph } from '@/components/group-glyph';
import { PlusIcon, SparkIcon } from '@/components/icons';
import { Button, PressableScale, tap } from '@/components/ui';
import { formatAgorot } from '@/lib/format';
import type { GroupWithMembers } from '@/lib/queries';
import { CATEGORY_LABEL, suggestBets, suggestionSeed, type BetSuggestion } from '@/lib/suggestions';
import { useColors } from '@/providers/theme-provider';

/**
 * "Here is one you could post."
 *
 * The empty feed used to be a sentence and a button to another tab, which
 * asks the user to think of a bet from nothing. This shows three specific
 * ones instead; tapping one opens the ordinary new-bet form with the fields
 * filled in.
 *
 * A bet always belongs to a group, so there are three states here and they
 * are genuinely different screens, not one screen with things hidden:
 *
 *   no groups  → the only useful next step is making one
 *   one group  → tap a card, land on the form, done
 *   several    → tap a card, then say which group it is for
 */
export function BetSuggestions({
  groups,
  count = 3,
  heading,
  subheading,
}: {
  groups: GroupWithMembers[];
  count?: number;
  heading?: string;
  subheading?: string;
}) {
  const router = useRouter();
  const colors = useColors();

  // Seeded per half hour rather than per render: a card must not move under
  // the finger because the keyboard appeared or a refresh landed.
  const seed = useMemo(() => suggestionSeed(), []);
  const suggestions = useMemo(() => suggestBets(count, seed), [count, seed]);

  const [pending, setPending] = useState<BetSuggestion | null>(null);

  function open(suggestion: BetSuggestion, groupId: string) {
    router.push({
      pathname: '/group/[id]/new-bet',
      params: {
        id: groupId,
        title: suggestion.title,
        a: suggestion.labelA,
        b: suggestion.labelB,
        // The form's pot field is in shekels, and this is the one place a
        // whole-shekel amount is written out — every stored value stays in
        // agorot.
        pot: String(Math.round(suggestion.potAgorot / 100)),
      },
    });
  }

  function choose(suggestion: BetSuggestion) {
    tap();
    const only = groups[0];
    if (groups.length === 1 && only) {
      open(suggestion, only.id);
      return;
    }
    setPending(suggestion);
  }

  if (groups.length === 0) {
    return (
      <View className="items-center">
        <View className="mb-5 h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft">
          <SparkIcon size={24} color={colors.accent} />
        </View>
        <Text className="text-center text-xl font-bold text-primary">
          Bets live inside a group
        </Text>
        <Text className="mt-2 max-w-[300px] text-center text-callout leading-5 text-secondary">
          Make one for your football chat, your flatmates, whoever. Then post
          something and see who bites.
        </Text>
        <Button
          title="Make a group"
          size="lg"
          elevated
          className="mt-7 self-stretch"
          icon={<PlusIcon size={17} color={colors.accentInk} />}
          onPress={() => router.push('/group/create')}
        />
        <Button
          title="I have an invite code"
          variant="plain"
          size="lg"
          className="mt-1 self-stretch"
          onPress={() => router.push('/group/join')}
        />
      </View>
    );
  }

  // Which group is this for? Only asked when the answer is not obvious.
  if (pending) {
    return (
      <View>
        <Text className="text-lg font-bold text-primary">Which group?</Text>
        <Text className="mt-1 text-subhead leading-5 text-secondary" numberOfLines={2}>
          “{pending.title}”
        </Text>

        <View className="mt-4 overflow-hidden rounded-2xl border border-hairline-strong bg-surface">
          {groups.map((group, index) => (
            <PressableScale
              key={group.id}
              scaleTo={0.99}
              dim
              onPress={() => {
                tap();
                open(pending, group.id);
                setPending(null);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Post it in ${group.name}`}
              className={`flex-row items-center gap-3 px-4 py-3 ${
                index === groups.length - 1 ? '' : 'border-b border-hairline'
              }`}
            >
              <GroupGlyph
                emoji={group.emoji}
                avatarUrl={group.avatar_url}
                name={group.name}
                size={34}
                radius={11}
              />
              <Text numberOfLines={1} className="flex-1 text-base text-primary">
                {group.name}
              </Text>
            </PressableScale>
          ))}
        </View>

        <Button
          title="Never mind"
          variant="plain"
          className="mt-2"
          onPress={() => setPending(null)}
        />
      </View>
    );
  }

  return (
    <View>
      {heading && <Text className="text-lg font-bold text-primary">{heading}</Text>}
      {subheading && (
        <Text className="mt-1.5 text-callout leading-5 text-secondary">{subheading}</Text>
      )}

      <View className={heading || subheading ? 'mt-4 gap-2.5' : 'gap-2.5'}>
        {suggestions.map((suggestion) => (
          <SuggestionCard
            key={suggestion.id}
            suggestion={suggestion}
            onPress={() => choose(suggestion)}
          />
        ))}
      </View>

      <Button
        title="Write my own"
        variant="secondary"
        size="lg"
        className="mt-3"
        icon={<PlusIcon size={17} color={colors.text} />}
        onPress={() => {
          const only = groups[0];
          if (groups.length === 1 && only) {
            router.push({ pathname: '/group/[id]/new-bet', params: { id: only.id } });
          } else {
            router.push('/(tabs)/groups');
          }
        }}
      />
    </View>
  );
}

function SuggestionCard({
  suggestion,
  onPress,
}: {
  suggestion: BetSuggestion;
  onPress: () => void;
}) {
  return (
    <PressableScale
      scaleTo={0.98}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Post a bet: ${suggestion.title}`}
      className="rounded-2xl border border-hairline-strong bg-surface p-4"
    >
      {/* Sentence case, not a tracked all-caps eyebrow. */}
      <Text className="text-sm text-tertiary">{CATEGORY_LABEL[suggestion.category]}</Text>
      <Text numberOfLines={2} className="mt-1 text-callout font-semibold leading-5 text-primary">
        {suggestion.title}
      </Text>

      <View className="mt-3 flex-row items-center gap-2">
        <View className="rounded-full bg-sideA-soft px-2.5 py-1">
          <Text numberOfLines={1} className="text-xs font-semibold text-sideA">
            {suggestion.labelA}
          </Text>
        </View>
        <View className="rounded-full bg-sideB-soft px-2.5 py-1">
          <Text numberOfLines={1} className="text-xs font-semibold text-sideB">
            {suggestion.labelB}
          </Text>
        </View>
        <Text className="ml-auto text-xs text-tertiary">
          {formatAgorot(suggestion.potAgorot)} pot
        </Text>
      </View>
    </PressableScale>
  );
}
