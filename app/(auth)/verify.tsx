import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, ErrorNotice } from '@/components/ui';
import { useAuth } from '@/providers/auth-provider';
import { colors } from '@/theme';

export default function VerifyScreen() {
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const { verifyOtp, sendOtp } = useAuth();
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!phone) return;
    setError(null);
    setBusy(true);
    try {
      await verifyOtp(phone, code);
      // The root navigator takes it from here (tabs, or profile setup).
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code did not work.');
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!phone) return;
    setError(null);
    try {
      await sendOtp(phone);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend the code.');
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-ink-950">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-between px-6 pb-8 pt-16"
      >
        <View>
          <Pressable onPress={() => router.back()} className="mb-8 self-start">
            <Text className="text-sm text-ink-600">← Change number</Text>
          </Pressable>

          <Text className="mb-2 text-3xl font-bold text-white">Enter the code</Text>
          <Text className="mb-10 text-base text-ink-600">Sent to {phone}</Text>

          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder="123456"
            placeholderTextColor={colors.ink['600']}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="sms-otp"
            maxLength={8}
            autoFocus
            className="h-16 rounded-2xl border border-ink-700 bg-ink-900 px-4 text-center text-3xl tracking-[8px] text-white"
          />

          {error && (
            <View className="mt-4">
              <ErrorNotice message={error} />
            </View>
          )}

          <Pressable onPress={resend} className="mt-6 self-center">
            <Text className="text-sm text-lotus-400">Resend code</Text>
          </Pressable>
        </View>

        <Button title="Verify" onPress={submit} loading={busy} disabled={code.length < 4} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
