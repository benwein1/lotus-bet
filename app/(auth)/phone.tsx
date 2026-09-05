import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from '@/components/animated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DemoEntry } from '@/components/demo-entry';
import { ScreenBackdrop } from '@/components/screen';
import { Button, ErrorNotice } from '@/components/ui';
import { useAuth } from '@/providers/auth-provider';
import { colors } from '@/theme';

export default function PhoneScreen() {
  const { sendOtp } = useAuth();
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [focused, setFocused] = useState(false);
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
    <View className="flex-1 bg-ink-950">
      <ScreenBackdrop />
      <SafeAreaView className="flex-1">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1"
        >
          <ScrollView
            contentContainerClassName="flex-grow justify-between px-gutter pb-8 pt-10"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View>
              <Animated.View entering={FadeIn.duration(500)}>
                <View className="mb-7 h-16 w-16 items-center justify-center rounded-3xl border border-brass-500/30 bg-brass-900">
                  <Text className="text-3xl">🪷</Text>
                </View>
              </Animated.View>

              <Animated.View entering={FadeInDown.delay(80).duration(420)}>
                <Text className="font-display-bold text-4xl text-ink-50">Lotus Bet</Text>
                <Text className="mt-3 max-w-[300px] text-base leading-6 text-ink-600">
                  Bet your friends on anything. We keep score — you settle up however you like.
                </Text>
              </Animated.View>

              <Animated.View entering={FadeInDown.delay(160).duration(420)} className="mt-10">
                <Text className="mb-2.5 font-display text-2xs uppercase tracking-[1.4px] text-ink-600">
                  Phone number
                </Text>
                <View
                  className={`h-16 flex-row items-center rounded-2xl border bg-ink-900 px-4 ${
                    focused ? 'border-brass-500' : 'border-ink-750'
                  }`}
                >
                  <Text className="mr-3 font-display text-lg text-ink-600">+972</Text>
                  <View className="mr-3 h-6 w-px bg-ink-750" />
                  <TextInput
                    value={phone}
                    onChangeText={setPhone}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    placeholder="54 123 4567"
                    placeholderTextColor={colors.ink['650']}
                    keyboardType="phone-pad"
                    textContentType="telephoneNumber"
                    autoComplete="tel"
                    returnKeyType="go"
                    onSubmitEditing={submit}
                    className="h-full flex-1 font-display text-lg text-ink-50"
                  />
                </View>
                <Text className="mt-2.5 text-xs text-ink-600">
                  Type a local number, or paste a full one with its country code.
                </Text>
              </Animated.View>

              {error && (
                <Animated.View entering={FadeIn.duration(200)} className="mt-5">
                  <ErrorNotice message={error} />
                </Animated.View>
              )}
            </View>

            <Animated.View entering={FadeInDown.delay(240).duration(420)} className="mt-10 gap-5">
              <Button
                title="Send code"
                size="lg"
                onPress={submit}
                loading={sending}
                disabled={phone.replace(/\D/g, '').length < 6}
              />
              <Text className="text-center text-xs leading-5 text-ink-600">
                Lotus Bet never handles money.{'\n'}It only tracks who owes whom.
              </Text>

              <DemoEntry />
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
