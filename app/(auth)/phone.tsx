import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from '@/components/animated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DemoEntry } from '@/components/demo-entry';
import { ScreenGround } from '@/components/screen';
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
      <ScreenGround />
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
              <Animated.View entering={FadeIn.duration(600)}>
                <Text className="mb-8 text-3xl">🪷</Text>
              </Animated.View>

              <Animated.View entering={FadeInDown.delay(90).duration(460)}>
                <Text className="font-display-bold text-6xl leading-[62px] text-ink-50">
                  Lotus{'\n'}Bet
                </Text>
                <View className="mt-6 h-px w-12 bg-ink-700" />
                <Text className="mt-6 max-w-[300px] text-base leading-7 text-ink-500">
                  Bet your friends on anything. We keep score — you settle up however you like.
                </Text>
              </Animated.View>

              <Animated.View entering={FadeInDown.delay(160).duration(420)} className="mt-10">
                <Text className="mb-3 font-display text-xs text-ink-600">Phone number</Text>
                <View
                  className={`h-16 flex-row items-center border-b-2 px-1 ${
                    focused ? 'border-ink-50' : 'border-ink-750'
                  }`}
                >
                  <Text className="mr-3 font-display text-xl text-ink-600">+972</Text>
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
                    className="h-full flex-1 font-display text-xl text-ink-50"
                  />
                </View>
                <Text className="mt-3 text-xs text-ink-600">
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
              <Text className="text-center text-xs leading-5 text-ink-650">
                Lotus Bet never handles money. It only tracks who owes whom.
              </Text>

              <DemoEntry />
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
