import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar, Button, ErrorNotice } from '@/components/ui';
import { useAuth } from '@/providers/auth-provider';
import { colors } from '@/theme';

export default function ProfileSetupScreen() {
  const { updateProfile } = useAuth();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const trimmed = name.trim();

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await updateProfile({ display_name: trimmed });
      // The root navigator redirects to the tabs once the name sticks.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your name.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-ink-950">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-between px-6 pb-8 pt-16"
      >
        <View>
          <Text className="mb-2 text-3xl font-bold text-white">What should we call you?</Text>
          <Text className="mb-10 text-base text-ink-600">
            This is the name your friends see on every bet.
          </Text>

          <View className="mb-6 items-center">
            <Avatar name={trimmed || '?'} size={72} />
          </View>

          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Dor Levi"
            placeholderTextColor={colors.ink['600']}
            autoCapitalize="words"
            autoComplete="name"
            maxLength={40}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={submit}
            className="h-14 rounded-2xl border border-ink-700 bg-ink-900 px-4 text-lg text-white"
          />

          {error && (
            <View className="mt-4">
              <ErrorNotice message={error} />
            </View>
          )}
        </View>

        <Button title="Start betting" onPress={submit} loading={busy} disabled={trimmed.length < 2} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
