import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ChevronRightIcon, PhotoIcon } from '@/components/icons';
import { ContentWidth, Screen } from '@/components/screen';
import { Button, ErrorNotice, LiveDot, PressableScale } from '@/components/ui';
import {
  CURRENCIES,
  DEFAULT_CURRENCY,
  currencyLabel,
  currencySymbol,
  type Currency,
} from '@/lib/currency';
import { pickAvatar, uploadAvatar, type PickedMedia } from '@/lib/media';
import { createGroup, updateGroupAvatar } from '@/lib/queries';
import { useAuth } from '@/providers/auth-provider';
import { useColors } from '@/providers/theme-provider';

/**
 * Make a group.
 *
 * Two decisions and a picture, in the order the board sets them out: the
 * photo, the name, the currency, and a preview of what the thing you are
 * making will look like in the feed.
 *
 * **There is no icon picker any more.** A grid of twelve emoji used to sit
 * between the name and the currency, and it carried three problems at once:
 * an emoji renders differently on every platform, it was the one place in the
 * app that still used them after `icons.tsx` replaced the rest, and it made
 * the group's face a *choice* when the honest answer is that a group either
 * has a photo or it does not. `GroupFace` draws a glyph when there is none,
 * which is the same glyph everywhere and needs nobody to pick it.
 *
 * The preview block is not decoration. The photo is optional and people ask
 * what happens without one, so the screen shows both rows rather than
 * explaining.
 */
export default function CreateGroupScreen() {
  const router = useRouter();
  const colors = useColors();
  const { profile } = useAuth();

  const [name, setName] = useState('');
  const [photo, setPhoto] = useState<PickedMedia | null>(null);
  const [currency, setCurrency] = useState<Currency>(DEFAULT_CURRENCY);
  const [pickingCurrency, setPickingCurrency] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const trimmed = name.trim();

  async function choosePhoto() {
    try {
      const picked = await pickAvatar();
      if (picked) setPhoto(picked);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open your photos.');
    }
  }

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      // `emoji` is gone from the screen but stays on the table for the groups
      // that already have one. Nothing new sets it.
      const group = await createGroup(trimmed, null, currency);

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
    <>
      <Stack.Screen options={{ title: 'New group' }} />
      <Screen>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1"
        >
          <ScrollView
            contentContainerClassName="px-gutter pb-10 pt-6"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <ContentWidth>
              <View className="items-center">
                <PressableScale
                  scaleTo={0.96}
                  onPress={() => void choosePhoto()}
                  accessibilityRole="button"
                  accessibilityLabel={photo ? 'Change the group photo' : 'Add a group photo'}
                  className="h-[104px] w-[104px] items-center justify-center gap-1.5 overflow-hidden rounded-full border border-dashed border-hairline-strong bg-surface2"
                >
                  {photo ? (
                    <View className="absolute inset-0">
                      <PreviewImage uri={photo.uri} />
                    </View>
                  ) : (
                    <>
                      <PhotoIcon size={26} color={colors.textSecondary} />
                      <Text className="text-xs text-secondary">Add photo</Text>
                    </>
                  )}
                </PressableScale>
                <Text className="mt-2.5 text-xs text-secondary">
                  Optional · groups without one just show their name
                </Text>
              </View>

              <View className="mt-[26px] overflow-hidden rounded-2xl border border-hairline bg-surface">
                <View className="min-h-[44px] flex-row items-center border-b border-hairline px-[15px] py-3.5">
                  <Text className="w-[90px] text-callout text-primary">Name</Text>
                  <TextInput
                    value={name}
                    onChangeText={setName}
                    placeholder="The Boys"
                    placeholderTextColor={colors.textTertiary}
                    maxLength={60}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={() => void submit()}
                    accessibilityLabel="Group name"
                    className="flex-1 text-callout text-primary"
                    // See NativeWind gotcha 4b: without an explicit minimum the
                    // input keeps its intrinsic width and the row cannot shrink.
                    style={{ color: colors.text, minWidth: 0 }}
                  />
                </View>

                <PressableScale
                  scaleTo={0.995}
                  onPress={() => setPickingCurrency(true)}
                  accessibilityRole="button"
                  accessibilityLabel={`Currency, ${currencyLabel(currency)}`}
                  className="min-h-[44px] flex-row items-center px-[15px] py-3.5"
                >
                  <Text className="w-[90px] text-callout text-primary">Currency</Text>
                  <Text className="flex-1 text-callout text-secondary">{currency}</Text>
                  <ChevronRightIcon size={16} color={colors.textTertiary} />
                </PressableScale>
              </View>
              <Text className="mt-[9px] text-xs leading-[17px] text-secondary">
                Picked once, kept for good.
              </Text>

              <View className="mt-[22px]">
                <Text className="text-2xs font-bold tracking-[1.4px] text-secondary">
                  HOW IT LOOKS IN THE FEED
                </Text>
                <PreviewRow
                  name={trimmed || 'The Boys'}
                  handle={profile?.username ?? null}
                  photoUri={photo?.uri ?? null}
                  className="mt-2.5"
                />
                <PreviewRow
                  name="Sunday Degens"
                  handle="eldor"
                  photoUri={null}
                  showFace={false}
                  className="mt-2"
                />
                <Text className="mt-[9px] text-xs leading-[17px] text-secondary">
                  With a photo, and without. Nothing is generated to fill the gap.
                </Text>
              </View>

              {error && (
                <View className="mt-5">
                  <ErrorNotice message={error} />
                </View>
              )}

              <View className="mt-[26px]">
                <Button
                  title="Create group"
                  size="lg"
                  onPress={() => void submit()}
                  loading={busy}
                  disabled={trimmed.length < 2}
                />
              </View>
            </ContentWidth>
          </ScrollView>
        </KeyboardAvoidingView>

        <CurrencySheet
          open={pickingCurrency}
          value={currency}
          onClose={() => setPickingCurrency(false)}
          onPick={(next) => {
            setCurrency(next);
            setPickingCurrency(false);
          }}
        />
      </Screen>
    </>
  );
}

/**
 * A file the picker just handed back.
 *
 * React Native's own `Image` rather than expo-image's: this is a local URI for
 * the seconds before the group exists, so there is nothing to cache, sign or
 * recycle.
 */
function PreviewImage({ uri }: { uri: string }) {
  return <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />;
}

/**
 * One row of the feed preview — the group header as a card will draw it.
 *
 * Deliberately a copy of the shape rather than the real `FeedCard`: that
 * component needs a whole bet, and a preview that needs a fake bet to render
 * is a preview that will drift the day the card changes anyway.
 */
function PreviewRow({
  name,
  handle,
  photoUri,
  showFace = true,
  className = '',
}: {
  name: string;
  handle: string | null;
  photoUri: string | null;
  showFace?: boolean;
  className?: string;
}) {
  return (
    <View
      className={`flex-row items-center gap-2.5 rounded-2xl border border-hairline bg-surface px-4 py-3.5 ${className}`}
    >
      {showFace && (
        <View className="h-[30px] w-[30px] overflow-hidden rounded-full bg-surface3">
          {photoUri && <PreviewImage uri={photoUri} />}
        </View>
      )}
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-[14px] font-semibold text-primary">
          {name}
        </Text>
        {handle && (
          <Text numberOfLines={1} className="mt-px text-[11px] text-secondary">
            @{handle}
          </Text>
        )}
      </View>
      <View className="flex-row items-center gap-1.5 rounded-full bg-surface3 px-2.5 py-1">
        <LiveDot />
        <Text className="text-xs font-semibold text-primary">Live</Text>
      </View>
    </View>
  );
}

/**
 * The four currencies, as a sheet.
 *
 * A segmented control fitted them, but it also made the choice look like a
 * setting you would come back and change. This is the one decision on the
 * screen that cannot be undone, so it reads as a row you open rather than as
 * four buttons you flick between.
 */
function CurrencySheet({
  open,
  value,
  onClose,
  onPick,
}: {
  open: boolean;
  value: Currency;
  onClose: () => void;
  onPick: (next: Currency) => void;
}) {
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        className="flex-1 justify-end bg-scrim"
        onPress={onClose}
        accessibilityLabel="Close"
      >
        <View className="rounded-t-4xl border-t border-hairline-strong bg-canvas px-gutter pb-10 pt-5">
          <Text className="text-lg font-semibold text-primary">Currency</Text>
          <Text className="mt-1.5 text-sm leading-[19px] text-secondary">
            Every pot and every balance in this group is counted in it. It can&apos;t be changed
            afterwards, because the running totals would stop adding up.
          </Text>

          <View className="mt-4 overflow-hidden rounded-2xl border border-hairline bg-surface">
            {CURRENCIES.map((code, index) => (
              <PressableScale
                key={code}
                scaleTo={0.995}
                onPress={() => onPick(code)}
                accessibilityRole="radio"
                accessibilityState={{ selected: code === value }}
                accessibilityLabel={currencyLabel(code)}
                className={`min-h-[52px] flex-row items-center gap-3 px-4 py-3 ${
                  index > 0 ? 'border-t border-hairline' : ''
                }`}
              >
                <Text className="w-8 text-callout text-secondary">{currencySymbol(code)}</Text>
                <Text
                  className={`flex-1 text-callout ${
                    code === value ? 'font-semibold text-primary' : 'text-primary'
                  }`}
                >
                  {currencyLabel(code)}
                </Text>
                {code === value && <Text className="text-callout text-accent">Selected</Text>}
              </PressableScale>
            ))}
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}
