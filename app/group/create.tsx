import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { AvatarPicker } from '@/components/avatar-picker';
import { ContentWidth, Screen } from '@/components/screen';
import {
  BlockField,
  Button,
  ErrorNotice,
  PressableScale,
  SectionTitle,
  Segmented,
} from '@/components/ui';
import {
  CURRENCIES,
  DEFAULT_CURRENCY,
  currencyLabel,
  currencySymbol,
  type Currency,
} from '@/lib/currency';
import { uploadAvatar, type PickedMedia } from '@/lib/media';
import { createGroup, updateGroupAvatar } from '@/lib/queries';

const EMOJI_CHOICES = ['🎲', '⚽️', '🏀', '🍻', '🏠', '💼', '🎬', '🃏', '🎾', '🏆', '🎮', '🍕'];

/** Spoken names, because an emoji is not reliably announced on every platform. */
const EMOJI_NAMES: Record<string, string> = {
  '🎲': 'dice',
  '⚽️': 'football',
  '🏀': 'basketball',
  '🍻': 'drinks',
  '🏠': 'house',
  '💼': 'work',
  '🎬': 'film',
  '🃏': 'cards',
  '🎾': 'tennis',
  '🏆': 'trophy',
  '🎮': 'games',
  '🍕': 'food',
};

export default function CreateGroupScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState<string>('🎲');
  const [photo, setPhoto] = useState<PickedMedia | null>(null);
  const [currency, setCurrency] = useState<Currency>(DEFAULT_CURRENCY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const trimmed = name.trim();

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const group = await createGroup(trimmed, emoji, currency);

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
                // Without this the button is announced as an unlabelled radio:
                // an emoji glyph is not reliably read on every platform.
                accessibilityLabel={`Icon ${EMOJI_NAMES[choice] ?? choice}`}
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

          <SectionTitle>Currency</SectionTitle>
          <Text className="mb-3 mt-1 text-sm leading-[18px] text-secondary">
            Every pot and every balance in this group is counted in it. It can&apos;t be changed
            afterwards, because the running totals would stop adding up.
          </Text>
          <Segmented
            className="mb-2"
            value={currency}
            onChange={setCurrency}
            options={CURRENCIES.map((code) => ({
              value: code,
              label: `${currencySymbol(code)} ${code}`,
            }))}
          />
          <Text className="mb-8 px-1 text-sm text-tertiary">
            {currencyLabel(currency)}. Betta never handles the money — you settle up between
            yourselves.
          </Text>

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
