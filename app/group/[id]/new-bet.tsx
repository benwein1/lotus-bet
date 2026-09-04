import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Button, ErrorNotice, SectionTitle } from '@/components/ui';
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const potAgorot = parseIlsToAgorot(pot);
  const canSubmit =
    title.trim().length >= 3 &&
    labelA.trim().length > 0 &&
    labelB.trim().length > 0 &&
    labelA.trim().toLowerCase() !== labelB.trim().toLowerCase() &&
    potAgorot !== null;

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
      <ScrollView contentContainerClassName="px-5 pb-10 pt-5" keyboardShouldPersistTaps="handled">
        <SectionTitle>What&apos;s the bet?</SectionTitle>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Will Yossi actually show up on time?"
          placeholderTextColor={colors.ink['600']}
          maxLength={140}
          multiline
          className="mb-4 min-h-14 rounded-2xl border border-ink-700 bg-ink-900 px-4 py-3 text-lg leading-6 text-white"
        />

        <SectionTitle>Details (optional)</SectionTitle>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="Ground rules, what counts as a win, that sort of thing."
          placeholderTextColor={colors.ink['600']}
          maxLength={500}
          multiline
          className="mb-6 min-h-20 rounded-2xl border border-ink-700 bg-ink-900 px-4 py-3 text-base leading-5 text-white"
        />

        <SectionTitle>The two sides</SectionTitle>
        <View className="mb-3 flex-row gap-3">
          <TextInput
            value={labelA}
            onChangeText={setLabelA}
            placeholder="Side A"
            placeholderTextColor={colors.ink['600']}
            maxLength={40}
            className="h-12 flex-1 rounded-2xl border border-sideA/40 bg-ink-900 px-4 text-base text-sideA"
          />
          <TextInput
            value={labelB}
            onChangeText={setLabelB}
            placeholder="Side B"
            placeholderTextColor={colors.ink['600']}
            maxLength={40}
            className="h-12 flex-1 rounded-2xl border border-sideB/40 bg-ink-900 px-4 text-base text-sideB"
          />
        </View>
        <View className="mb-6 flex-row flex-wrap gap-2">
          {LABEL_PRESETS.map(([a, b]) => (
            <Pressable
              key={`${a}/${b}`}
              onPress={() => {
                setLabelA(a);
                setLabelB(b);
              }}
              className="rounded-full border border-ink-700 px-3 py-1.5 active:bg-ink-800"
            >
              <Text className="text-xs text-ink-600">
                {a} / {b}
              </Text>
            </Pressable>
          ))}
        </View>

        <SectionTitle>Total pot</SectionTitle>
        <TextInput
          value={pot}
          onChangeText={setPot}
          placeholder="100"
          placeholderTextColor={colors.ink['600']}
          keyboardType="decimal-pad"
          className="h-14 rounded-2xl border border-ink-700 bg-ink-900 px-4 text-2xl font-bold text-white"
        />
        <Text className="mb-6 mt-2 text-xs leading-5 text-ink-600">
          One fixed pot for the whole bet — it doesn&apos;t grow as more people join. The winning
          side splits {potAgorot ? formatAgorot(potAgorot) : 'it'} between them; the losing side
          covers the same amount between them.
        </Text>

        <View className="mb-6 flex-row items-center justify-between rounded-2xl border border-ink-700 bg-ink-900 px-4 py-3">
          <View className="flex-1 pr-3">
            <Text className="text-sm font-semibold text-white">Join deadline</Text>
            <Text className="text-xs text-ink-600">
              {hasDeadline ? 'Locks itself when time runs out.' : 'You lock it manually instead.'}
            </Text>
          </View>
          <Switch
            value={hasDeadline}
            onValueChange={setHasDeadline}
            trackColor={{ false: colors.ink['700'], true: colors.lotus['600'] }}
            thumbColor="#fff"
          />
        </View>

        {hasDeadline && (
          <View className="mb-6 flex-row flex-wrap gap-2">
            {DURATION_PRESETS.map((preset) => (
              <Pressable
                key={preset.hours}
                onPress={() => setDeadlineHours(preset.hours)}
                className={`rounded-full border px-4 py-2 ${
                  deadlineHours === preset.hours
                    ? 'border-lotus-500 bg-lotus-500/15'
                    : 'border-ink-700'
                }`}
              >
                <Text
                  className={`text-xs ${
                    deadlineHours === preset.hours ? 'text-lotus-400' : 'text-ink-600'
                  }`}
                >
                  {preset.label}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {error && <ErrorNotice message={error} />}

        <Button title="Post bet" onPress={submit} loading={busy} disabled={!canSubmit} />
        <Text className="mt-3 text-center text-2xs leading-4 text-ink-600">
          No money moves through Lotus Bet. You&apos;re recording a friendly wager, nothing more.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
