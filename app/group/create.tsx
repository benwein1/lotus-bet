import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { AvatarPicker } from '@/components/avatar-picker';
import { ContentWidth, Screen } from '@/components/screen';
import { BlockField, Button, ErrorNotice, PressableScale, SectionTitle } from '@/components/ui';
import { uploadAvatar, type PickedMedia } from '@/lib/media';
import { createGroup, updateGroupAvatar } from '@/lib/queries';

const EMOJI_CHOICES = ['🎲', '⚽️', '🏀', '🍻', '🏠', '💼', '🎬', '🃏', '🎾', '🏆', '🎮', '🍕'];

export default function CreateGroupScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState<string>('🎲');
  const [photo, setPhoto] = useState<PickedMedia | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const trimmed = name.trim();

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const group = await createGroup(trimmed, emoji);

      // The upload path contains the group id, so the photo can only go up
      // once the row exists. A failure here loses the picture, not the group —
      // and the picture can be set again from the group screen.
      if (photo) {
        try {
          const url = await uploadAvatar({ kind: 'groups', id: group.id }, photo);
          await updateGroupAvatar(group.id, url);
        } catch {
          // Deliberately swallowed: the group is made, and stopping here to
          // report a failed image would strand the user on this screen.
        }
      }

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
          <View className="mb-7 items-center">
            {/* No `owner` yet — there is no group id to upload under until the
                row exists, so this holds the file and create() sends it. */}
            <AvatarPicker
              name={trimmed || 'New group'}
              size={92}
              onPick={setPhoto}
              uri={null}
            />
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

          <SectionTitle>{photo ? 'Or pick an icon instead' : 'Pick an icon'}</SectionTitle>
          <Text className="mb-3 mt-1 text-sm leading-[18px] text-secondary">
            {photo
              ? 'The photo wins. Remove it and the icon takes over.'
              : 'Used everywhere the group appears, until you add a photo.'}
          </Text>
          <View className={`mb-8 flex-row flex-wrap gap-2.5 ${photo ? 'opacity-50' : ''}`}>
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
            elevated
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
