import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';

import { ContentWidth, Screen } from '@/components/screen';
import { Button, ErrorNotice, SectionTitle } from '@/components/ui';
import { joinGroupWithCode } from '@/lib/queries';

const CODE_LENGTH = 6;

export default function JoinGroupScreen() {
  const router = useRouter();
  const inputRef = useRef<TextInput>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(value = code) {
    setError(null);
    setBusy(true);
    try {
      const group = await joinGroupWithCode(value);
      router.replace({ pathname: '/group/[id]', params: { id: group.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join that group.');
      setBusy(false);
    }
  }

  function onChange(next: string) {
    // Invite codes are drawn from an unambiguous uppercase alphabet.
    const clean = next.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
    setCode(clean);
    if (clean.length === CODE_LENGTH) void submit(clean);
  }

  return (
    <Screen ground="sunken">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 px-gutter pt-6"
      >
      <ContentWidth>
        <SectionTitle>Invite code</SectionTitle>

        {/* One hidden input behind six boxes, so paste and autofill still work. */}
        <Pressable onPress={() => inputRef.current?.focus()} accessibilityLabel="Invite code">
          <View className="flex-row justify-between gap-2">
            {Array.from({ length: CODE_LENGTH }, (_, i) => {
              const char = code[i];
              const isCursor = i === code.length;
              return (
                <View
                  key={i}
                  className={`h-16 flex-1 items-center justify-center rounded-2xl border ${
                    char
                      ? 'border-accent bg-accent-soft'
                      : isCursor
                        ? 'border-accent bg-surface'
                        : 'border-hairline bg-surface'
                  }`}
                >
                  <Text className="text-2xl font-bold text-primary">{char ?? ''}</Text>
                </View>
              );
            })}
          </View>
        </Pressable>

        <TextInput
          ref={inputRef}
          value={code}
          onChangeText={onChange}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={CODE_LENGTH}
          autoFocus
          caretHidden
          className="absolute h-16 w-full opacity-0"
        />

        <View className="mt-7">
          {error && <ErrorNotice message={error} />}
          <Button
            title="Join group"
            size="lg"
            onPress={() => submit()}
            loading={busy}
            disabled={code.length < CODE_LENGTH}
          />
        </View>

        <Text className="mt-4 text-center text-sm leading-5 text-secondary">
          Ask whoever set the group up — the code is on their group screen.
        </Text>
      </ContentWidth>
      </KeyboardAvoidingView>
    </Screen>
  );
}
