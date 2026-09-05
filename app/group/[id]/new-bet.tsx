import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Switch, Text, View } from 'react-native';

import { CameraIcon, CloseIcon, PhotoIcon, VideoIcon } from '@/components/icons';
import { ContentWidth, Screen } from '@/components/screen';
import {
  BlockField,
  Button,
  Chip,
  ErrorNotice,
  Overline,
  PressableScale,
  SectionTitle,
  TextField,
  FieldGroup,
} from '@/components/ui';
import { formatAgorot, parseIlsToAgorot } from '@/lib/format';
import { captureMedia, pickMedia, MAX_ATTACHMENTS, type PickedMedia } from '@/lib/media';
import { announceNewBet } from '@/lib/notifications';
import { createBet } from '@/lib/queries';
import { useAuth } from '@/providers/auth-provider';
import { useColors } from '@/providers/theme-provider';

// Two-outcome only for the MVP; these presets cover most of what people
// actually bet on in a group chat.
const LABEL_PRESETS: [string, string][] = [
  ['Yes', 'No'],
  ['Over', 'Under'],
  ['Home', 'Away'],
  ['Will', "Won't"],
];

const POT_PRESETS = [20, 50, 100, 200];

const DURATION_PRESETS: { label: string; hours: number }[] = [
  { label: '1 hour', hours: 1 },
  { label: '6 hours', hours: 6 },
  { label: '24 hours', hours: 24 },
  { label: '3 days', hours: 72 },
];

export default function NewBetScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = id ?? '';
  const router = useRouter();
  const { session } = useAuth();
  const colors = useColors();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [labelA, setLabelA] = useState('Yes');
  const [labelB, setLabelB] = useState('No');
  const [pot, setPot] = useState('');
  const [media, setMedia] = useState<PickedMedia[]>([]);
  const [hasDeadline, setHasDeadline] = useState(false);
  const [deadlineHours, setDeadlineHours] = useState(24);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const potAgorot = parseIlsToAgorot(pot);
  const labelsClash =
    labelA.trim().length > 0 && labelA.trim().toLowerCase() === labelB.trim().toLowerCase();
  const canSubmit =
    title.trim().length >= 3 &&
    labelA.trim().length > 0 &&
    labelB.trim().length > 0 &&
    !labelsClash &&
    potAgorot !== null;

  async function addFromLibrary() {
    setError(null);
    try {
      const picked = await pickMedia(MAX_ATTACHMENTS - media.length);
      if (picked.length) setMedia((current) => [...current, ...picked]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open your library.');
    }
  }

  async function addFromCamera() {
    setError(null);
    try {
      const captured = await captureMedia();
      if (captured) setMedia((current) => [...current, captured]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the camera.');
    }
  }

  async function submit() {
    if (!canSubmit || !session) return;
    setError(null);
    setBusy(true);

    try {
      const bet = await createBet({
        groupId,
        creatorId: session.user.id,
        title: title.trim(),
        description: description.trim() || null,
        optionALabel: labelA.trim(),
        optionBLabel: labelB.trim(),
        totalPotAgorot: potAgorot!,
        closeAt: hasDeadline
          ? new Date(Date.now() + deadlineHours * 60 * 60 * 1000).toISOString()
          : null,
        media,
      });

      // Fire-and-forget: the bet exists whether or not the pushes land.
      void announceNewBet(bet.id);

      router.replace({ pathname: '/bet/[id]', params: { id: bet.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the bet.');
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
          contentContainerClassName="px-gutter pb-10 pt-5"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <ContentWidth>
            <View className="mb-7">
              <BlockField
                label="What's the bet?"
                value={title}
                onChangeText={setTitle}
                placeholder="Will Yossi actually show up on time?"
                maxLength={140}
                multiline
              />
              <Text className="mt-2 px-1 text-sm text-secondary">
                {title.length > 0 ? `${140 - title.length} characters left` : 'Keep it decidable.'}
              </Text>
            </View>

            <View className="mb-7">
              <BlockField
                label="Details (optional)"
                value={description}
                onChangeText={setDescription}
                placeholder="Ground rules, what counts as a win, that sort of thing."
                maxLength={500}
                multiline
              />
            </View>

            {/* Attachments. A bet with a photo is the one that gets picked up
                in the feed, so the picker sits above the fold, not buried at
                the bottom of the form. */}
            <View className="mb-7">
              <SectionTitle>Photo or video</SectionTitle>
              <MediaPicker
                media={media}
                onAddLibrary={addFromLibrary}
                onAddCamera={addFromCamera}
                onRemove={(index) =>
                  setMedia((current) => current.filter((_, i) => i !== index))
                }
              />
              <Text className="mt-2 px-1 text-sm leading-[18px] text-secondary">
                Up to {MAX_ATTACHMENTS}. Anything you attach fills the card in everyone&apos;s feed.
              </Text>
            </View>

            <SectionTitle>The two sides</SectionTitle>
            <View className="mb-3 flex-row gap-3">
              <View className="flex-1">
                <Overline className="mb-1.5 px-1 text-sideA">Side A</Overline>
                <BlockField
                  label=""
                  value={labelA}
                  onChangeText={setLabelA}
                  placeholder="Yes"
                  maxLength={40}
                />
              </View>
              <View className="flex-1">
                <Overline className="mb-1.5 px-1 text-sideB">Side B</Overline>
                <BlockField
                  label=""
                  value={labelB}
                  onChangeText={setLabelB}
                  placeholder="No"
                  maxLength={40}
                />
              </View>
            </View>

            <View className="mb-3 flex-row flex-wrap gap-2">
              {LABEL_PRESETS.map(([a, b]) => (
                <Chip
                  key={`${a}/${b}`}
                  label={`${a} / ${b}`}
                  selected={labelA === a && labelB === b}
                  onPress={() => {
                    setLabelA(a);
                    setLabelB(b);
                  }}
                />
              ))}
            </View>
            {labelsClash && (
              <Text className="mb-3 text-sm text-negative">
                The two sides need different labels.
              </Text>
            )}

            <View className="mb-7" />

            <SectionTitle>Total pot</SectionTitle>
            <FieldGroup>
              <TextField
                label="₪"
                value={pot}
                onChangeText={setPot}
                placeholder="100"
                keyboardType="decimal-pad"
                last
              />
            </FieldGroup>

            <View className="mb-3 mt-3 flex-row flex-wrap gap-2">
              {POT_PRESETS.map((amount) => (
                <Chip
                  key={amount}
                  label={`₪${amount}`}
                  selected={pot === String(amount)}
                  onPress={() => setPot(String(amount))}
                />
              ))}
            </View>

            <Text className="mb-7 px-1 text-sm leading-[18px] text-secondary">
              One fixed pot for the whole bet — it doesn&apos;t grow as more people join. The
              winning side splits {potAgorot ? formatAgorot(potAgorot) : 'it'} between them; the
              losing side covers the same amount between them.
            </Text>

            <View className="mb-4 flex-row items-center justify-between rounded-2xl border border-hairline bg-surface px-4 py-3.5">
              <View className="flex-1 pr-3">
                <Text className="text-base text-primary">Join deadline</Text>
                <Text className="mt-0.5 text-sm text-secondary">
                  {hasDeadline
                    ? 'Locks itself when time runs out.'
                    : 'You lock it manually instead.'}
                </Text>
              </View>
              <Switch
                value={hasDeadline}
                onValueChange={setHasDeadline}
                trackColor={{ false: colors.surface3, true: colors.accent }}
                thumbColor="#FFFFFF"
                ios_backgroundColor={colors.surface3}
              />
            </View>

            {hasDeadline && (
              <View className="mb-7 flex-row flex-wrap gap-2">
                {DURATION_PRESETS.map((preset) => (
                  <Chip
                    key={preset.hours}
                    label={preset.label}
                    selected={deadlineHours === preset.hours}
                    onPress={() => setDeadlineHours(preset.hours)}
                  />
                ))}
              </View>
            )}

            {error && <ErrorNotice message={error} />}

            <Button
              title={media.length > 0 && busy ? 'Uploading…' : 'Post bet'}
              size="lg"
              onPress={submit}
              loading={busy}
              disabled={!canSubmit}
            />
            <Text className="mt-4 text-center text-xs leading-4 text-tertiary">
              No money moves through Lotus Bet. You&apos;re recording a friendly wager, nothing
              more.
            </Text>
          </ContentWidth>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/**
 * Thumbnails plus the two ways in. A video thumbnail is its own first frame on
 * iOS; on the platforms where it is not, the badge is what says "this moves".
 */
function MediaPicker({
  media,
  onAddLibrary,
  onAddCamera,
  onRemove,
}: {
  media: PickedMedia[];
  onAddLibrary: () => void;
  onAddCamera: () => void;
  onRemove: (index: number) => void;
}) {
  const colors = useColors();
  const full = media.length >= MAX_ATTACHMENTS;

  return (
    <View className="flex-row flex-wrap gap-2.5">
      {media.map((item, index) => (
        <View key={`${item.uri}-${index}`} className="h-[88px] w-[88px]">
          <Image
            source={{ uri: item.uri }}
            contentFit="cover"
            className="h-full w-full rounded-2xl"
            style={{ backgroundColor: colors.surface3 }}
          />
          {item.kind === 'video' && (
            <View className="absolute bottom-1.5 left-1.5 flex-row items-center gap-1 rounded-full bg-scrim px-1.5 py-0.5">
              <VideoIcon size={12} color="#FFFFFF" />
            </View>
          )}
          <PressableScale
            onPress={() => onRemove(index)}
            scaleTo={0.88}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Remove attachment"
            className="absolute -right-1.5 -top-1.5 h-6 w-6 items-center justify-center rounded-full bg-scrim"
          >
            <CloseIcon size={13} color="#FFFFFF" />
          </PressableScale>
        </View>
      ))}

      {!full && (
        <>
          <PressableScale
            onPress={onAddLibrary}
            scaleTo={0.94}
            accessibilityRole="button"
            accessibilityLabel="Add a photo or video"
            className="h-[88px] w-[88px] items-center justify-center gap-1 rounded-2xl border border-dashed border-hairline-strong bg-surface"
          >
            <PhotoIcon size={20} color={colors.accent} />
            <Text className="text-xs text-secondary">Library</Text>
          </PressableScale>

          {Platform.OS !== 'web' && (
            <PressableScale
              onPress={onAddCamera}
              scaleTo={0.94}
              accessibilityRole="button"
              accessibilityLabel="Take a photo or video"
              className="h-[88px] w-[88px] items-center justify-center gap-1 rounded-2xl border border-dashed border-hairline-strong bg-surface"
            >
              <CameraIcon size={20} color={colors.accent} />
              <Text className="text-xs text-secondary">Camera</Text>
            </PressableScale>
          )}
        </>
      )}
    </View>
  );
}
