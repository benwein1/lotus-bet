import { Link } from 'expo-router';
import { useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import Animated, { FadeIn } from '@/components/animated';
import { Text } from 'react-native';

import { AuthNotice, AuthShell, AuthSwitch } from '@/components/auth-shell';
import { EyeIcon } from '@/components/icons';
import { AuthDivider, SocialAuthButtons } from '@/components/social-auth';
import { Button, ErrorNotice, FieldGroup, PressableScale, TextField } from '@/components/ui';
import { DEMO_AVAILABLE } from '@/lib/demo';
import { isValidEmail } from '@/lib/format';
import type { OAuthProvider } from '@/lib/oauth-rules';
import { useAuth } from '@/providers/auth-provider';
import { useColors } from '@/providers/theme-provider';

export default function SignInScreen() {
  const { signIn, sendPasswordReset, signInWithProvider } = useAuth();
  const colors = useColors();
  const passwordRef = useRef<TextInput>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [social, setSocial] = useState<OAuthProvider | null>(null);

  const ready = isValidEmail(email) && password.length > 0;

  async function continueWith(provider: OAuthProvider) {
    setError(null);
    setNotice(null);
    setSocial(provider);
    try {
      await signInWithProvider(provider);
      // The root navigator takes it from here, exactly as for a password
      // sign-in. A cancelled sheet resolves false and leaves the screen alone,
      // which is the right amount of feedback for "I changed my mind".
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign you in.');
    } finally {
      setSocial(null);
    }
  }

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
      setNotice('Reset link sent. Check your inbox — it is good for one hour.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send a reset link.');
    }
  }

  return (
    <AuthShell
      title="Settle it."
      // Says what the app is for and what it pointedly is not, in one breath.
      // "Keeps score" rather than "place bets": this is a scoreboard between
      // friends, not a sportsbook, and the first sentence is where that has to
      // be unmistakable.
      subtitle="Bet your friends on anything. Betta keeps score and remembers who owes whom — you settle up however you already do."
      showDemoEntry={DEMO_AVAILABLE}
      footer={
        <View className="w-full gap-4">
          <AuthSwitch prompt="New here?">
            <Link href="/(auth)/sign-up" asChild>
              <PressableScale
                hitSlop={8}
                accessibilityRole="link"
                accessibilityLabel="Create an account"
                className="px-1 py-1"
              >
                <Text className="text-subhead font-semibold text-accent">Create an account</Text>
              </PressableScale>
            </Link>
          </AuthSwitch>

          <PressableScale
            onPress={() => void forgotPassword()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Email me a password reset link"
            className="self-center px-2 py-1"
          >
            <Text className="text-subhead text-secondary">Forgot your password?</Text>
          </PressableScale>
        </View>
      }
    >
      {/* Above the form, because one tap beats two fields and a password —
          and because on iOS the Apple button is the one Apple looks for. */}
      <SocialAuthButtons onPress={(p) => void continueWith(p)} busy={social} disabled={busy} />

      <AuthDivider />

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

      {error && (
        <Animated.View entering={FadeIn.duration(180)} className="mt-4">
          <ErrorNotice message={error} />
        </Animated.View>
      )}

      {notice && <AuthNotice message={notice} />}

      <View className="mt-6">
        <Button
          title="Sign in"
          size="lg"
          onPress={() => void submit()}
          loading={busy}
          disabled={!ready}
        />
      </View>
    </AuthShell>
  );
}
