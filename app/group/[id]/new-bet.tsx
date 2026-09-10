import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Switch, Text, View } from 'react-native';

import { CameraIcon, CloseIcon, PhotoIcon, PlusIcon, VideoIcon } from '@/components/icons';
import { ContentWidth, Screen } from '@/components/screen';
import {
  BlockField,
  Button,
  Chip,
  ErrorNotice,
  PressableScale,
  SectionTitle,
  TextField,
  FieldGroup,
  selectionTap,
} from '@/components/ui';
import { formatAgorot, parseIlsToAgorot } from '@/lib/format';
import { captureMedia, pickMedia, MAX_ATTACHMENTS, type PickedMedia } from '@/lib/media';
import { MAX_BET_OPTIONS, MIN_BET_OPTIONS, createBet, fetchGroup } from '@/lib/queries';
import { useAsync } from '@/hooks/use-async';
import { useAuth } from '@/providers/auth-provider';
import { useColors, useScheme } from '@/providers/theme-provider';
import { optionColor } from '@/theme';

// The common two-sided pairs, offered as a shortcut while a bet still has
// exactly two options.
const LABEL_PRESETS: [string, string][] = [
  ['Yes', 'No'],
  ['Over', 'Under'],
  ['Home', 'Away'],
  ['Will', "Won't"],
];

/** Placeholders that read as a real bet rather than "Option 3". */
const OPTION_PLACEHOLDERS = ['Yes', 'No', 'Too close to call', 'Something else', 'Nobody knows'];

const POT_PRESETS = [20, 50, 100, 200];

const DURATION_PRESETS: { label: string; hours: number }[] = [
  { label: '1 hour', hours: 1 },
  { label: '6 hours', hours: 6 },
  { label: '24 hours', hours: 24 },
  { label: '3 days', hours: 72 },
];

export default function NewBetScreen() {
  // The suggestion cards on the feed link straight here with the fields
  // already filled. Everything stays editable — a prompt is a starting point,
  // not a template.
  const { id, title: seedTitle, a: seedA, b: seedB, pot: seedPot } =
    useLocalSearchParams<{
      id: string;
      title?: string;
      a?: string;
      b?: string;
      pot?: string;
    }>();
  const groupId = id ?? '';
  const router = useRouter();
  const { session } = useAuth();
  const colors = useColors();
  const scheme = useScheme();

  const [title, setTitle] = useState(seedTitle ?? '');
  const [description, setDescription] = useState('');
  // Two is the floor, and the first two are what land in `option_a_label` /
  // `option_b_label` on the row.
  const [options, setOptions] = useState<string[]>([seedA ?? 'Yes', seedB ?? 'No']);
  const [pot, setPot] = useState(seedPot ?? '');
  const [media, setMedia] = useState<PickedMedia[]>([]);
  const [hasDeadline, setHasDeadline] = useState(false);
  const [deadlineHours, setDeadlineHours] = useState(24);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Empty means everyone in the group. Naming anybody makes the bet private to
  // them and you.
  const [invited, setInvited] = useState<string[]>([]);

  const group = useAsync(() => fetchGroup(groupId), [groupId]);
  const others = (group.data?.members ?? []).filter((m) => m.user_id !== session?.user.id);
  const isPrivate = invited.length > 0;

  const potAgorot = parseIlsToAgorot(pot);
  const trimmed = options.map((label) => label.trim());
  const filled = trimmed.filter(Boolean);
  // Case-insensitive, because "Yes" and "yes" are the same answer and a bet
  // with both is unresolvable by anyone reading it.
  const labelsClash = new Set(filled.map((l) => l.toLowerCase())).size !== filled.length;
  const canSubmit =
    title.trim().length >= 3 &&
    filled.length === trimmed.length &&
    filled.length >= MIN_BET_OPTIONS &&
    !labelsClash &&
    potAgorot !== null;

  function setOption(index: number, value: string) {
    setOptions((current) => current.map((label, i) => (i === index ? value : label)));
  }

  function addOption() {
    if (options.length >= MAX_BET_OPTIONS) return;
    selectionTap();
    setOptions((current) => [...current, '']);
  }

  function removeOption(index: number) {
    if (options.length <= MIN_BET_OPTIONS) return;
    selectionTap();
    setOptions((current) => current.filter((_, i) => i !== index));
  }

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
        optionLabels: trimmed,
        totalPotAgorot: potAgorot!,
        closeAt: hasDeadline
          ? new Date(Date.now() + deadlineHours * 60 * 60 * 1000).toISOString()
          : null,
        media,
        inviteeIds: invited,
      });

      // Fire-and-forget: the bet exists whether or not the pushes land.

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

            <SectionTitle>The options</SectionTitle>
            <Text className="mb-3 mt-1 px-1 text-sm leading-[18px] text-secondary">
              Two at least, {MAX_BET_OPTIONS} at most. Whoever backs the one that happens
              splits the pot; everybody else covers it between them.
            </Text>

            <View className="mb-3 gap-2.5">
              {options.map((label, index) => (
                <View key={index} className="flex-row items-center gap-2">
                  <View
                    style={{ backgroundColor: optionColor(index, options.length, scheme) }}
                    className="h-2.5 w-2.5 rounded-full"
                  />
                  <View className="flex-1">
                    <BlockField
                      value={label}
                      onChangeText={(value) => setOption(index, value)}
                      placeholder={OPTION_PLACEHOLDERS[index] ?? `Option ${index + 1}`}
                      maxLength={40}
                    />
                  </View>
                  {options.length > MIN_BET_OPTIONS && (
                    <PressableScale
                      onPress={() => removeOption(index)}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove option ${index + 1}`}
                      className="h-9 w-9 items-center justify-center rounded-full bg-surface2"
                    >
                      <CloseIcon size={14} color={colors.textSecondary} />
                    </PressableScale>
                  )}
                </View>
              ))}
            </View>

            {options.length < MAX_BET_OPTIONS && (
              <Button
                title="Add another option"
                variant="secondary"
                className="mb-3"
                icon={<PlusIcon size={16} color={colors.text} />}
                onPress={addOption}
              />
            )}

            {/* The presets only make sense while it is still a two-sided bet;
                once there is a third option there is no pair to swap in. */}
            {options.length === 2 && (
              <View className="mb-3 flex-row flex-wrap gap-2">
                {LABEL_PRESETS.map(([a, b]) => (
                  <Chip
                    key={`${a}/${b}`}
                    label={`${a} / ${b}`}
                    selected={options[0] === a && options[1] === b}
                    onPress={() => setOptions([a!, b!])}
                  />
                ))}
              </View>
            )}

            {labelsClash && (
              <Text className="mb-3 text-sm text-negative">
                Two options cannot have the same label.
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

            {/* Only worth showing when there is somebody to leave out. In a
                two-person group — every duel — the bet is already private to
                the pair, so the control would be a decision with one answer. */}
            {others.length > 1 && (
              <View className="mb-7">
                <SectionTitle>Who can see it</SectionTitle>
                <View className="rounded-2xl border border-hairline bg-surface p-3">
                  <View className="flex-row gap-2">
                    <Chip
                      label="Everyone in the group"
                      selected={!isPrivate}
                      onPress={() => setInvited([])}
                    />
                    <Chip
                      label="Only who I pick"
                      selected={isPrivate}
                      onPress={() =>
                        setInvited((current) =>
                          current.length > 0 ? current : [others[0]!.user_id]
                        )
                      }
                    />
                  </View>

                  {isPrivate && (
                    // A rule, because without one the names wrap into the mode
                    // row and "Dor Levi" reads as a third way to answer "who
                    // can see it" rather than an answer to "which of them".
                    <View className="mt-3 flex-row flex-wrap gap-2 border-t border-hairline pt-3">
                      {others.map((member) => {
                        const picked = invited.includes(member.user_id);
                        return (
                          <Chip
                            key={member.user_id}
                            multi
                            label={member.user?.display_name ?? 'Someone'}
                            selected={picked}
                            onPress={() =>
                              setInvited((current) =>
                                picked
                                  ? current.filter((u) => u !== member.user_id)
                                  : [...current, member.user_id]
                              )
                            }
                          />
                        );
                      })}
                    </View>
                  )}
                </View>
                <Text className="mt-2.5 px-1 text-sm leading-[18px] text-secondary">
                  {isPrivate
                    ? invited.length === 1
                      ? 'Just the two of you. Nobody else in the group sees this bet at all.'
                      : `You and ${invited.length} others. Nobody else in the group sees this bet at all.`
                    : 'Everyone in the group can see it and take a side.'}
                </Text>
              </View>
            )}

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
              elevated
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
