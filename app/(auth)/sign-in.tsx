import { Link } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from '@/components/animated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DemoEntry } from '@/components/demo-entry';
import { EyeIcon } from '@/components/icons';
import { ContentWidth, Screen } from '@/components/screen';
import {
  Button,
  ErrorNotice,
  FieldGroup,
  PressableScale,
  TextField,
} from '@/components/ui';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { isValidEmail } from '@/lib/format';
import { useAuth } from '@/providers/auth-provider';
import { useColors } from '@/providers/theme-provider';
import { motion } from '@/theme';

export default function SignInScreen() {
  const { signIn, sendPasswordReset } = useAuth();
  const colors = useColors();
  const reduced = useReducedMotion();
  const passwordRef = useRef<TextInput>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ready = isValidEmail(email) && password.length > 0;

  async function submit() {
    if (!ready) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await signIn(email, password);
      // The root navigator takes it from here.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign you in.');
    } finally {
      setBusy(false);
    }
  }

  async function forgotPassword() {
    if (!isValidEmail(email)) {
      setError('Type your email address first, then tap this again.');
      return;
    }
    setError(null);
    try {
      await sendPasswordReset(email);
      setNotice('Password reset link sent. Check your inbox.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send a reset link.');
    }
  }

  const entering = (delay: number) =>
    reduced ? FadeIn.duration(motion.duration.fast) : FadeInDown.delay(delay).duration(420);

  return (
    <Screen ground="sunken">
      <SafeAreaView className="flex-1">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1"
        >
          <ScrollView
            contentContainerClassName="flex-grow justify-center px-gutter py-10"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <ContentWidth>
              <Animated.View entering={entering(0)} className="mb-8 items-center">
                <View className="mb-5 h-16 w-16 items-center justify-center rounded-[18px] bg-surface">
                  <Text className="text-2xl">🪷</Text>
                </View>
                <Text className="text-2xl font-bold text-primary">Lotus Bet</Text>
                <Text className="mt-2 max-w-[280px] text-center text-callout leading-5 text-secondary">
                  Bet your friends on anything. We keep score — you settle up however you like.
                </Text>
              </Animated.View>

              <Animated.View entering={entering(80)}>
                <FieldGroup>
                  <TextField
                    label="Email"
                    value={email}
                    onChangeText={setEmail}
                    placeholder="you@example.com"
                    keyboardType="email-address"
                    textContentType="username"
                    autoComplete="email"
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="next"
                    onSubmitEditing={() => passwordRef.current?.focus()}
                  />
                  <TextField
                    ref={passwordRef}
                    label="Password"
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Required"
                    secureTextEntry={!reveal}
                    textContentType="password"
                    autoComplete="current-password"
                    autoCapitalize="none"
                    returnKeyType="go"
                    onSubmitEditing={submit}
                    last
                    accessory={
                      <PressableScale
                        onPress={() => setReveal((value) => !value)}
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel={reveal ? 'Hide password' : 'Show password'}
                        className="p-1"
                      >
                        <EyeIcon size={19} active={reveal} color={colors.textTertiary} />
                      </PressableScale>
                    }
                  />
                </FieldGroup>
              </Animated.View>

              {error && (
                <Animated.View entering={FadeIn.duration(180)} className="mt-4">
                  <ErrorNotice message={error} />
                </Animated.View>
              )}

              {notice && (
                <Animated.View entering={FadeIn.duration(180)} className="mt-4">
                  <View className="rounded-2xl bg-accent-soft px-4 py-3">
                    <Text className="text-subhead text-accent">{notice}</Text>
                  </View>
                </Animated.View>
              )}

              <Animated.View entering={entering(140)} className="mt-6 gap-4">
                <Button title="Sign in" size="lg" onPress={submit} loading={busy} disabled={!ready} />

                <View className="flex-row items-center justify-center gap-1">
                  <Text className="text-subhead text-secondary">New here?</Text>
                  <Link href="/(auth)/sign-up" asChild>
                    <PressableScale hitSlop={8} className="px-1 py-1">
                      <Text className="text-subhead font-semibold text-accent">Create an account</Text>
                    </PressableScale>
                  </Link>
                </View>

                <PressableScale onPress={forgotPassword} hitSlop={8} className="self-center px-2 py-1">
                  <Text className="text-subhead text-secondary">Forgot your password?</Text>
                </PressableScale>
              </Animated.View>

              <View className="mt-10 items-center gap-5">
                <Text className="max-w-[300px] text-center text-xs leading-4 text-tertiary">
                  Lotus Bet never handles money. It only tracks who owes whom.
                </Text>
                <DemoEntry />
              </View>
            </ContentWidth>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Screen>
  );
}
