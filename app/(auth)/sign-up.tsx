import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import Animated, { FadeIn } from '@/components/animated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthShell, AuthSwitch } from '@/components/auth-shell';
import { EyeIcon, MailIcon } from '@/components/icons';
import { ContentWidth, Screen } from '@/components/screen';
import { Button, ErrorNotice, FieldGroup, PressableScale, TextField } from '@/components/ui';
import { isValidEmail, passwordProblem } from '@/lib/format';
import { useAuth } from '@/providers/auth-provider';
import { useColors } from '@/providers/theme-provider';

export default function SignUpScreen() {
  const { signUp } = useAuth();
  const router = useRouter();
  const colors = useColors();

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
  // Only once they have typed enough for the rule to be about *their* password
  // rather than a scolding for an empty field.
  const showProblem = password.length > 0 && problem !== null;

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

  if (confirmationSent) {
    return (
      <Screen>
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
    <AuthShell
      title="Start something."
      subtitle="Your name is what your friends see on every bet. Nothing else about you is visible to them."
      footer={
        <AuthSwitch prompt="Already have an account?">
          <PressableScale
            onPress={() => router.replace('/(auth)/sign-in')}
            hitSlop={8}
            accessibilityRole="link"
            accessibilityLabel="Sign in instead"
            className="px-1 py-1"
          >
            <Text className="text-subhead font-semibold text-accent">Sign in</Text>
          </PressableScale>
        </AuthSwitch>
      }
    >
      <FieldGroup>
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
          onSubmitEditing={() => void submit()}
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

      {/* One line, and only once there is something to say about. A rule shown
          under an empty field is noise; shown under a short one it is help. */}
      {showProblem && (
        <Animated.View entering={FadeIn.duration(160)}>
          <Text className="mt-2.5 px-1 text-sm text-secondary">{problem}</Text>
        </Animated.View>
      )}

      {error && (
        <Animated.View entering={FadeIn.duration(180)} className="mt-4">
          <ErrorNotice message={error} />
        </Animated.View>
      )}

      <View className="mt-6">
        <Button
          title="Create account"
          size="lg"
          onPress={() => void submit()}
          loading={busy}
          disabled={!ready}
        />
      </View>
    </AuthShell>
  );
}
