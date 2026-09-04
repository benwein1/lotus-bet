import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, ErrorNotice } from '@/components/ui';
import { useAuth } from '@/providers/auth-provider';
import { colors } from '@/theme';

export default function PhoneScreen() {
  const { sendOtp } = useAuth();
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function submit() {
    setError(null);
    setSending(true);
    try {
      const { phone: normalised } = await sendOtp(phone);
      router.push({ pathname: '/(auth)/verify', params: { phone: normalised } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the code.');
    } finally {
      setSending(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-ink-950">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-between px-6 pb-8 pt-16"
      >
        <View>
          <Text className="mb-2 text-5xl">🪷</Text>
          <Text className="mb-2 text-3xl font-bold text-white">Lotus Bet</Text>
          <Text className="mb-10 text-base leading-6 text-ink-600">
            Bet your friends on anything. We keep score — you settle up however you like.
          </Text>

          <Text className="mb-2 text-xs font-semibold uppercase tracking-widest text-ink-600">
            Phone number
          </Text>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder="054 123 4567"
            placeholderTextColor={colors.ink['600']}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
            returnKeyType="go"
            onSubmitEditing={submit}
            className="h-14 rounded-2xl border border-ink-700 bg-ink-900 px-4 text-lg text-white"
          />
          <Text className="mt-2 text-xs text-ink-600">
            Israeli numbers can skip the country code.
          </Text>

          {error && (
            <View className="mt-4">
              <ErrorNotice message={error} />
            </View>
          )}
        </View>

        <View className="gap-4">
          <Button title="Send code" onPress={submit} loading={sending} disabled={phone.length < 6} />
          <Text className="text-center text-2xs leading-4 text-ink-600">
            Lotus Bet never handles money. It only tracks who owes whom.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
