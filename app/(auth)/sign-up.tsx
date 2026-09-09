import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from '@/components/animated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChevronLeftIcon, EyeIcon, MailIcon } from '@/components/icons';
import { ContentWidth, Screen } from '@/components/screen';
import {
  Button,
  ErrorNotice,
  FieldGroup,
  PressableScale,
  TextField,
} from '@/components/ui';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { isValidEmail, passwordProblem } from '@/lib/format';
import { useAuth } from '@/providers/auth-provider';
import { useColors } from '@/providers/theme-provider';
import { motion } from '@/theme';

export default function SignUpScreen() {
  const { signUp } = useAuth();
  const router = useRouter();
  const colors = useColors();
  const reduced = useReducedMotion();

  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);

  const trimmedName = name.trim();
  const problem = passwordProblem(password);
  const ready = trimmedName.length >= 2 && isValidEmail(email) && problem === null;

  async function submit() {
    if (!ready) return;
    setError(null);
    setBusy(true);
    try {
      const { needsEmailConfirmation } = await signUp(email, password, trimmedName);
      // With confirmation on there is no session yet, so the redirect gate has
      // nothing to act on — say so rather than leaving them on a dead form.
      if (needsEmailConfirmation) setConfirmationSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create your account.');
    } finally {
      setBusy(false);
    }
  }

  const entering = (delay: number) =>
    reduced ? FadeIn.duration(motion.duration.fast) : FadeInDown.delay(delay).duration(420);

  if (confirmationSent) {
    return (
      <Screen ground="sunken">
        <SafeAreaView className="flex-1 justify-center px-gutter">
          <ContentWidth className="items-center">
            <View className="mb-6 h-16 w-16 items-center justify-center rounded-full bg-accent-soft">
              <MailIcon size={28} color={colors.accent} />
            </View>
            <Text className="text-2xl font-bold text-primary">Check your inbox</Text>
            <Text className="mt-3 max-w-[300px] text-center text-callout leading-5 text-secondary">
              We sent a confirmation link to{' '}
              <Text className="font-semibold text-primary">{email.trim().toLowerCase()}</Text>. Open
              it, then come back and sign in.
            </Text>
            <Button
              title="Back to sign in"
              variant="tinted"
              size="lg"
              className="mt-8 self-stretch"
              onPress={() => router.replace('/(auth)/sign-in')}
            />
          </ContentWidth>
        </SafeAreaView>
      </Screen>
    );
  }

  return (
    <Screen ground="sunken">
      <SafeAreaView className="flex-1">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1"
        >
          <ScrollView
            contentContainerClassName="flex-grow px-gutter pb-10 pt-2"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <ContentWidth>
              <PressableScale
                onPress={() => router.back()}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Go back"
                className="mb-8 h-10 w-10 items-center justify-center rounded-full bg-surface"
              >
                <ChevronLeftIcon size={18} color={colors.text} />
              </PressableScale>

              <Animated.View entering={entering(0)} className="mb-8">
                <Text className="text-3xl font-bold text-primary">Create your account</Text>
                <Text className="mt-2 text-callout leading-5 text-secondary">
                  Your name is what friends see on every bet.
                </Text>
              </Animated.View>

              <Animated.View entering={entering(80)}>
                <FieldGroup footer="Your name is visible to everyone in your groups. Your email is not.">
                  <TextField
                    label="Name"
                    value={name}
                    onChangeText={setName}
                    placeholder="Dor Levi"
                    autoCapitalize="words"
                    autoComplete="name"
                    textContentType="name"
                    maxLength={40}
                    returnKeyType="next"
                    onSubmitEditing={() => emailRef.current?.focus()}
                  />
                  <TextField
                    ref={emailRef}
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
                    placeholder="8 characters or more"
                    secureTextEntry={!reveal}
                    textContentType="newPassword"
                    autoComplete="new-password"
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

              <Animated.View entering={entering(140)} className="mt-6">
                <Button
                  title="Create account"
                  size="lg"
                  onPress={submit}
                  loading={busy}
                  disabled={!ready}
                />
                <Text className="mt-6 text-center text-xs leading-4 text-tertiary">
                  Lotus Bet never handles money. It only tracks who owes whom.
                </Text>
              </Animated.View>
            </ContentWidth>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Screen>
  );
}
