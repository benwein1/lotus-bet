import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';

import { Button, ErrorNotice, SectionTitle } from '@/components/ui';
import { joinGroupWithCode } from '@/lib/queries';
import { colors } from '@/theme';

export default function JoinGroupScreen() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const group = await joinGroupWithCode(code);
      router.replace({ pathname: '/group/[id]', params: { id: group.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join that group.');
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-ink-950 px-5 pt-6"
    >
      <SectionTitle>Invite code</SectionTitle>
      <TextInput
        value={code}
        onChangeText={(next) => setCode(next.toUpperCase())}
        placeholder="AB3K9Z"
        placeholderTextColor={colors.ink['600']}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={6}
        autoFocus
        returnKeyType="go"
        onSubmitEditing={submit}
        className="h-16 rounded-2xl border border-ink-700 bg-ink-900 px-4 text-center text-3xl tracking-[6px] text-white"
      />

      <View className="mt-6">
        {error && <ErrorNotice message={error} />}
        <Button title="Join group" onPress={submit} loading={busy} disabled={code.length < 6} />
      </View>

      <Text className="mt-4 text-center text-xs leading-5 text-ink-600">
        Ask whoever set the group up — the code is on their group screen.
      </Text>
    </KeyboardAvoidingView>
  );
}
