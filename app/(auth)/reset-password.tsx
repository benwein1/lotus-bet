import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeIn } from '@/components/animated';

import { AuthShell } from '@/components/auth-shell';
import { Button, ErrorNotice, FieldGroup, TextField } from '@/components/ui';
import { useAuth } from '@/providers/auth-provider';

/** Supabase's own floor. Anything shorter is refused server-side anyway. */
const MIN_LENGTH = 6;

/**
 * The second half of "forgot password".
 *
 * There is no "current password" field and there should not be: clicking a
 * link in an inbox you control *is* the proof. Asking for the password you
 * forgot would be a good joke and a dead end.
 */
export default function ResetPasswordScreen() {
  const router = useRouter();
  const { updatePassword, recovering, session } = useAuth();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = password.length >= MIN_LENGTH && confirm === password && !busy;

  async function submit() {
    if (!ready) return;
    setError(null);
    setBusy(true);
    try {
      await updatePassword(password);
      // `recovering` is now false, so the gate stops holding us here and the
      // session — already a real one — lands on the tabs.
      router.replace('/(tabs)');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set that password.');
      setBusy(false);
    }
  }

  // Arriving here without a recovery session means the link was never opened,
  // or it expired before it got here. Say so rather than showing a form whose
  // submit would fail with something cryptic.
  const linkDead = !recovering && !session;

  return (
    <AuthShell
      title={linkDead ? 'That link expired.' : 'Pick a new password.'}
      subtitle={
        linkDead
          ? 'Reset links only last an hour. Ask for a fresh one and it will work.'
          : 'Type it twice. You will be signed in as soon as it saves.'
      }
    >
      {error && (
        <View className="mb-4">
          <ErrorNotice message={error} />
        </View>
      )}

      {linkDead ? (
        <Button
          title="Back to sign in"
          variant="primary"
          size="lg"
          onPress={() => router.replace('/(auth)/sign-in')}
        />
      ) : (
        <>
          <FieldGroup>
            <TextField
              label="New password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
              placeholder={`At least ${MIN_LENGTH} characters`}
              editable={!busy}
            />
            <TextField
              label="Again"
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
              placeholder="Same thing"
              editable={!busy}
              onSubmitEditing={() => void submit()}
              last
            />
          </FieldGroup>

          {/* One line, and only once there is something to say about. A
              validation message under an empty field is noise. */}
          {tooShort ? (
            <Animated.View entering={FadeIn.duration(160)}>
              <Text className="mt-2.5 px-1 text-sm text-negative">
                A bit longer — {MIN_LENGTH} characters minimum.
              </Text>
            </Animated.View>
          ) : mismatch ? (
            <Animated.View entering={FadeIn.duration(160)}>
              <Text className="mt-2.5 px-1 text-sm text-negative">
                Those two don&apos;t match yet.
              </Text>
            </Animated.View>
          ) : null}

          <View className="mt-6">
            <Button
              title={busy ? 'Saving' : 'Save and sign in'}
              variant="primary"
              size="lg"
              loading={busy}
              disabled={!ready}
              onPress={() => void submit()}
            />
          </View>
        </>
      )}
    </AuthShell>
  );
}
