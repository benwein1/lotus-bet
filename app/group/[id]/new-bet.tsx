import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ContentWidth } from '@/components/screen';
import { Button, Chip, ErrorNotice, Overline, SectionTitle } from '@/components/ui';
import { formatAgorot, parseIlsToAgorot } from '@/lib/format';
import { announceNewBet } from '@/lib/notifications';
import { createBet } from '@/lib/queries';
import { useAuth } from '@/providers/auth-provider';
import { colors } from '@/theme';

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

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [labelA, setLabelA] = useState('Yes');
  const [labelB, setLabelB] = useState('No');
  const [pot, setPot] = useState('');
  const [hasDeadline, setHasDeadline] = useState(false);
  const [deadlineHours, setDeadlineHours] = useState(24);
  const [focusedField, setFocusedField] = useState<string | null>(null);
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

  const field = (name: string, tone?: 'a' | 'b') =>
    `rounded-2xl border bg-ink-900 px-4 ${
      focusedField === name
        ? tone === 'a'
          ? 'border-sideA'
          : tone === 'b'
            ? 'border-sideB'
            : 'border-brass-500'
        : 'border-ink-750'
    }`;

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
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-ink-950"
    >
      <ScrollView
        contentContainerClassName="px-gutter pb-10 pt-5"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ContentWidth>
          <SectionTitle>What&apos;s the bet?</SectionTitle>
          <TextInput
            value={title}
            onChangeText={setTitle}
            onFocus={() => setFocusedField('title')}
            onBlur={() => setFocusedField(null)}
            placeholder="Will Yossi actually show up on time?"
            placeholderTextColor={colors.ink['650']}
            maxLength={140}
            multiline
            className={`min-h-[64px] py-3.5 font-display text-lg leading-6 text-ink-50 ${field('title')}`}
          />
          <Text className="mb-6 mt-2 text-xs text-ink-650">
            {title.length > 0 ? `${140 - title.length} characters left` : 'Keep it decidable.'}
          </Text>

          <SectionTitle>Details (optional)</SectionTitle>
          <TextInput
            value={description}
            onChangeText={setDescription}
            onFocus={() => setFocusedField('desc')}
            onBlur={() => setFocusedField(null)}
            placeholder="Ground rules, what counts as a win, that sort of thing."
            placeholderTextColor={colors.ink['650']}
            maxLength={500}
            multiline
            className={`mb-7 min-h-[88px] py-3.5 text-base leading-6 text-ink-50 ${field('desc')}`}
          />

          <SectionTitle>The two sides</SectionTitle>
          <View className="mb-3 flex-row gap-3">
            <View className="flex-1">
              <Overline className="mb-1.5 text-sideA">Side A</Overline>
              <TextInput
                value={labelA}
                onChangeText={setLabelA}
                onFocus={() => setFocusedField('a')}
                onBlur={() => setFocusedField(null)}
                placeholder="Yes"
                placeholderTextColor={colors.ink['650']}
                maxLength={40}
                className={`h-12 font-display text-base text-sideA ${field('a', 'a')}`}
              />
            </View>
            <View className="flex-1">
              <Overline className="mb-1.5 text-right text-sideB">Side B</Overline>
              <TextInput
                value={labelB}
                onChangeText={setLabelB}
                onFocus={() => setFocusedField('b')}
                onBlur={() => setFocusedField(null)}
                placeholder="No"
                placeholderTextColor={colors.ink['650']}
                maxLength={40}
                className={`h-12 font-display text-base text-sideB ${field('b', 'b')}`}
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
            <Text className="mb-3 text-xs text-owing">The two sides need different labels.</Text>
          )}

          <View className="mb-7" />

          <SectionTitle>Total pot</SectionTitle>
          <View className={`h-16 flex-row items-center ${field('pot')}`}>
            <Text className="mr-2 font-display-bold text-2xl text-ink-650">₪</Text>
            <TextInput
              value={pot}
              onChangeText={setPot}
              onFocus={() => setFocusedField('pot')}
              onBlur={() => setFocusedField(null)}
              placeholder="100"
              placeholderTextColor={colors.ink['650']}
              keyboardType="decimal-pad"
              className="h-full flex-1 font-display-bold text-2xl text-ink-50"
            />
          </View>

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

          <Text className="mb-7 text-xs leading-5 text-ink-600">
            One fixed pot for the whole bet — it doesn&apos;t grow as more people join. The winning
            side splits {potAgorot ? formatAgorot(potAgorot) : 'it'} between them; the losing side
            covers the same amount between them.
          </Text>

          <View className="mb-4 flex-row items-center justify-between rounded-2xl border border-ink-750 bg-ink-900 px-4 py-3.5">
            <View className="flex-1 pr-3">
              <Text className="font-display text-sm text-ink-50">Join deadline</Text>
              <Text className="mt-0.5 text-xs text-ink-600">
                {hasDeadline ? 'Locks itself when time runs out.' : 'You lock it manually instead.'}
              </Text>
            </View>
            <Switch
              value={hasDeadline}
              onValueChange={setHasDeadline}
              trackColor={{ false: colors.ink['750'], true: colors.brass['600'] }}
              thumbColor="#fff"
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
            title="Post bet"
            size="lg"
            onPress={submit}
            loading={busy}
            disabled={!canSubmit}
          />
          <Text className="mt-4 text-center text-2xs leading-4 tracking-normal text-ink-650">
            No money moves through Lotus Bet.{'\n'}You&apos;re recording a friendly wager, nothing
            more.
          </Text>
        </ContentWidth>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
