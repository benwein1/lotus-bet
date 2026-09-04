import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Button, ErrorNotice, SectionTitle } from '@/components/ui';
import { createGroup } from '@/lib/queries';
import { colors } from '@/theme';

const EMOJI_CHOICES = ['🎲', '⚽️', '🏀', '🍻', '🏠', '💼', '🎬', '🃏', '🎾', '🏆'];

export default function CreateGroupScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState<string>('🎲');
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
      <ScrollView contentContainerClassName="px-5 pb-8 pt-6" keyboardShouldPersistTaps="handled">
        <SectionTitle>Group name</SectionTitle>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Sunday League Degenerates"
          placeholderTextColor={colors.ink['600']}
          maxLength={60}
          autoFocus
          className="mb-6 h-14 rounded-2xl border border-ink-700 bg-ink-900 px-4 text-lg text-white"
        />

        <SectionTitle>Pick an icon</SectionTitle>
        <View className="mb-8 flex-row flex-wrap gap-2">
          {EMOJI_CHOICES.map((choice) => (
            <Pressable
              key={choice}
              onPress={() => setEmoji(choice)}
              accessibilityRole="radio"
              accessibilityState={{ selected: emoji === choice }}
              className={`h-14 w-14 items-center justify-center rounded-2xl border ${
                emoji === choice ? 'border-lotus-500 bg-lotus-500/15' : 'border-ink-700 bg-ink-900'
              }`}
            >
              <Text className="text-2xl">{choice}</Text>
            </Pressable>
          ))}
        </View>

        {error && <ErrorNotice message={error} />}

        <Button
          title="Create group"
          onPress={submit}
          loading={busy}
          disabled={trimmed.length < 2}
        />
        <Text className="mt-3 text-center text-xs text-ink-600">
          You&apos;ll get an invite code to share once it&apos;s made.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
