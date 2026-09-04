import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';

import { ContentWidth } from '@/components/screen';
import { Button, ErrorNotice, PressableScale, SectionTitle } from '@/components/ui';
import { createGroup } from '@/lib/queries';
import { colors } from '@/theme';

const EMOJI_CHOICES = ['🎲', '⚽️', '🏀', '🍻', '🏠', '💼', '🎬', '🃏', '🎾', '🏆', '🎮', '🍕'];

export default function CreateGroupScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState<string>('🎲');
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const trimmed = name.trim();

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const group = await createGroup(trimmed, emoji);
      router.replace({ pathname: '/group/[id]', params: { id: group.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the group.');
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-ink-950"
    >
      <ScrollView
        contentContainerClassName="px-gutter pb-8 pt-6"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ContentWidth>
          {/* Live preview of the row they'll see on the Groups tab. */}
          <View className="mb-7 flex-row items-center gap-4 rounded-3xl border border-ink-800 bg-ink-900 p-5">
            <View className="h-[52px] w-[52px] items-center justify-center rounded-2xl border border-ink-750 bg-ink-850">
              <Text className="text-2xl">{emoji}</Text>
            </View>
            <View className="flex-1">
              <Text
                numberOfLines={1}
                className={`font-display text-base ${trimmed ? 'text-ink-50' : 'text-ink-650'}`}
              >
                {trimmed || 'Your group name'}
              </Text>
              <Text className="mt-0.5 text-xs text-ink-600">1 member · just you, for now</Text>
            </View>
          </View>

          <SectionTitle>Group name</SectionTitle>
          <TextInput
            value={name}
            onChangeText={setName}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Sunday League Degenerates"
            placeholderTextColor={colors.ink['650']}
            maxLength={60}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={submit}
            className={`mb-7 h-14 rounded-2xl border bg-ink-900 px-4 font-display text-lg text-ink-50 ${
              focused ? 'border-lotus-500' : 'border-ink-750'
            }`}
          />

          <SectionTitle>Pick an icon</SectionTitle>
          <View className="mb-8 flex-row flex-wrap gap-2.5">
            {EMOJI_CHOICES.map((choice) => (
              <PressableScale
                key={choice}
                scaleTo={0.9}
                onPress={() => setEmoji(choice)}
                accessibilityRole="radio"
                accessibilityState={{ selected: emoji === choice }}
                className={`h-14 w-14 items-center justify-center rounded-2xl border ${
                  emoji === choice
                    ? 'border-lotus-500 bg-lotus-900'
                    : 'border-ink-750 bg-ink-900'
                }`}
              >
                <Text className="text-2xl">{choice}</Text>
              </PressableScale>
            ))}
          </View>

          {error && <ErrorNotice message={error} />}

          <Button
            title="Create group"
            size="lg"
            onPress={submit}
            loading={busy}
            disabled={trimmed.length < 2}
          />
          <Text className="mt-3.5 text-center text-xs text-ink-600">
            You&apos;ll get an invite code to share once it&apos;s made.
          </Text>
        </ContentWidth>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
