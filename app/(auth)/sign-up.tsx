import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import Animated, { FadeIn } from '@/components/animated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthShell, AuthSwitch } from '@/components/auth-shell';
import { AuthDivider, SocialAuthButtons } from '@/components/social-auth';
import { EyeIcon, MailIcon } from '@/components/icons';
import { ContentWidth, Screen } from '@/components/screen';
import { Button, ErrorNotice, FieldGroup, PressableScale, TextField } from '@/components/ui';
import { CheckIcon } from '@/components/icons';
import { isValidEmail, passwordProblem } from '@/lib/format';
import type { OAuthProvider } from '@/lib/oauth-rules';
import { useAuth } from '@/providers/auth-provider';
import { useColors } from '@/providers/theme-provider';

export default function SignUpScreen() {
  const { signUp, signInWithProvider } = useAuth();
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
  const [agreed, setAgreed] = useState(false);
  const [social, setSocial] = useState<OAuthProvider | null>(null);

  const trimmedName = name.trim();
  const problem = passwordProblem(password);
  // Agreement gates the button rather than being a line of small print under
  // it. Guideline 1.2 wants people to have agreed to the rules, and a checkbox
  // that is ticked by default is not an agreement.
  const ready =
    trimmedName.length >= 2 && isValidEmail(email) && problem === null && agreed;
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

  async function continueWith(provider: OAuthProvider) {
    setError(null);
    setSocial(provider);
    try {
      await signInWithProvider(provider);
      // Same destination as a finished email signup: the root navigator sees a
      // session and routes on. A provider that gave us a name skips profile
      // setup; one that did not lands there, which is the screen for it.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign you up.');
    } finally {
      setSocial(null);
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
      {/* A social sign-in creates the account too, so it belongs on this
          screen as much as on sign-in — and it is the faster of the two paths,
          so it goes first. The agreement travels with the buttons: it is their
          own label that carries it, since there is no form here to tick. */}
      <SocialAuthButtons onPress={(p) => void continueWith(p)} busy={social} disabled={busy} />

      <AuthDivider label="or sign up with email" />

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

      {/* Above the error, not below: it is part of the form, and a control that
          gates the button belongs next to the fields rather than after the
          thing that tells you the form failed.

          Both links open a screen inside the app rather than a URL. The text is
          bundled with the build, so the one place where somebody agrees to the
          rules works with no domain, no hosting and no network — it used to
          point at a placeholder host and open nothing at all. */}
      <PressableScale
        scaleTo={0.99}
        onPress={() => setAgreed((v) => !v)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: agreed }}
        accessibilityLabel="I agree to the Terms and the Privacy Policy"
        className="mt-5 flex-row items-start gap-3 px-1 py-1"
      >
        <View
          className={`mt-0.5 h-[22px] w-[22px] items-center justify-center rounded-md border-2 ${
            agreed ? 'border-accent bg-accent' : 'border-hairline-strong'
          }`}
        >
          {agreed && <CheckIcon size={14} color={colors.accentInk} />}
        </View>
        <Text className="flex-1 text-sm leading-[18px] text-secondary">
          I agree to the{' '}
          <Text
            className="font-semibold text-accent"
            onPress={() => router.push('/legal/terms')}
          >
            Terms
          </Text>{' '}
          and the{' '}
          <Text
            className="font-semibold text-accent"
            onPress={() => router.push('/legal/privacy')}
          >
            Privacy Policy
          </Text>
          , including that abusive or objectionable content is not tolerated and
          accounts posting it are removed.
        </Text>
      </PressableScale>

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
