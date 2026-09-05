import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { ContentWidth, Screen } from '@/components/screen';
import { BlockField, Button, ErrorNotice, PressableScale, SectionTitle } from '@/components/ui';
import { createGroup } from '@/lib/queries';

const EMOJI_CHOICES = ['🎲', '⚽️', '🏀', '🍻', '🏠', '💼', '🎬', '🃏', '🎾', '🏆', '🎮', '🍕'];

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
    <Screen ground="sunken">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
      <ScrollView
        contentContainerClassName="px-gutter pb-8 pt-6"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ContentWidth>
          {/* Live preview of the row they'll see on the Groups tab. */}
          <View className="mb-7 flex-row items-center gap-4 rounded-3xl border border-hairline bg-surface p-4">
            <View className="h-[52px] w-[52px] items-center justify-center rounded-2xl bg-surface2">
              <Text className="text-2xl">{emoji}</Text>
            </View>
            <View className="flex-1">
              <Text
                numberOfLines={1}
                className={`text-base font-semibold ${trimmed ? 'text-primary' : 'text-tertiary'}`}
              >
                {trimmed || 'Your group name'}
              </Text>
              <Text className="mt-0.5 text-sm text-secondary">Just you, for now</Text>
            </View>
          </View>

          <View className="mb-7">
            <BlockField
              label="Group name"
              value={name}
              onChangeText={setName}
              placeholder="Sunday League Degenerates"
              maxLength={60}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={submit}
            />
          </View>

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
                    ? 'border-accent bg-accent-soft'
                    : 'border-hairline bg-surface'
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
          <Text className="mt-3.5 text-center text-sm text-secondary">
            You&apos;ll get an invite code to share once it&apos;s made.
          </Text>
        </ContentWidth>
      </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
