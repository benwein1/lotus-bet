import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from '@/components/animated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenBackdrop } from '@/components/screen';
import { Button, ErrorNotice, PressableScale } from '@/components/ui';
import { ChevronLeftIcon } from '@/components/icons';
import { useAuth } from '@/providers/auth-provider';
import { colors } from '@/theme';

const CODE_LENGTH = 6;

export default function VerifyScreen() {
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const { verifyOtp, sendOtp } = useAuth();
  const router = useRouter();
  const inputRef = useRef<TextInput>(null);

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);

  async function submit(value = code) {
    if (!phone) return;
    setError(null);
    setBusy(true);
    try {
      await verifyOtp(phone, value);
      // The root navigator takes it from here (tabs, or profile setup).
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code did not work.');
    } finally {
      setBusy(false);
    }
  }

  function onChange(next: string) {
    const digits = next.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(digits);
    // Submit the moment the last digit lands — nobody wants to reach for a
    // button after typing a code they just read off a screen.
    if (digits.length === CODE_LENGTH) void submit(digits);
  }

  async function resend() {
    if (!phone) return;
    setError(null);
    try {
      await sendOtp(phone);
      setResent(true);
      setTimeout(() => setResent(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend the code.');
    }
  }

  return (
    <View className="flex-1 bg-ink-950">
      <ScreenBackdrop />
      <SafeAreaView className="flex-1">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1 justify-between px-gutter pb-8 pt-4"
        >
          <View>
            <PressableScale
              onPress={() => router.back()}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Change number"
              className="mb-8 h-10 w-10 items-center justify-center rounded-full border border-ink-750 bg-ink-850"
            >
              <ChevronLeftIcon size={18} color={colors.ink['500']} />
            </PressableScale>

            <Animated.View entering={FadeInDown.duration(420)}>
              <Text className="font-display-bold text-3xl text-ink-50">Enter the code</Text>
              <Text className="mt-2.5 text-base text-ink-600">
                Sent to <Text className="font-display text-ink-400">{phone}</Text>
              </Text>
            </Animated.View>

            {/* A single hidden input behind six boxes: real OTP autofill still
                works, but the display is ours. */}
            <Animated.View entering={FadeInDown.delay(90).duration(420)} className="mt-9">
              <Pressable onPress={() => inputRef.current?.focus()} accessibilityLabel="Verification code">
                <View className="flex-row justify-between gap-2">
                  {Array.from({ length: CODE_LENGTH }, (_, i) => {
                    const char = code[i];
                    const isCursor = i === code.length;
                    return (
                      <View
                        key={i}
                        className={`h-16 flex-1 items-center justify-center rounded-2xl border ${
                          char
                            ? 'border-brass-500/60 bg-brass-900'
                            : isCursor
                              ? 'border-brass-500 bg-ink-900'
                              : 'border-ink-750 bg-ink-900'
                        }`}
                      >
                        <Text className="font-display-bold text-2xl text-ink-50">{char ?? ''}</Text>
                      </View>
                    );
                  })}
                </View>
              </Pressable>

              <TextInput
                ref={inputRef}
                value={code}
                onChangeText={onChange}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
                maxLength={CODE_LENGTH}
                autoFocus
                caretHidden
                className="absolute h-16 w-full opacity-0"
              />
            </Animated.View>

            {error && (
              <Animated.View entering={FadeIn.duration(200)} className="mt-5">
                <ErrorNotice message={error} />
              </Animated.View>
            )}

            <PressableScale onPress={resend} hitSlop={10} className="mt-7 self-center px-4 py-2">
              <Text className="font-display text-sm text-brass-300">
                {resent ? 'Code sent ✓' : 'Resend code'}
              </Text>
            </PressableScale>
          </View>

          <Button
            title="Verify"
            size="lg"
            onPress={() => submit()}
            loading={busy}
            disabled={code.length < CODE_LENGTH}
          />
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
