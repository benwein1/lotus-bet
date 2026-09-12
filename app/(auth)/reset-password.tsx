import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import Animated, { FadeInDown } from '@/components/animated';

import { LotusMark } from '@/components/lotus-mark';
import { ContentWidth, Screen } from '@/components/screen';
import { Button, ErrorNotice, FieldGroup, TextField } from '@/components/ui';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useAuth } from '@/providers/auth-provider';
import { motion } from '@/theme';

/** Supabase's own floor. Anything shorter is refused server-side anyway. */
const MIN_LENGTH = 6;

/**
 * The second half of "forgot password", which never existed until now.
 *
 * The first half — send a link — was already here and looked fine. What was
 * missing is everything after the tap: a `redirectTo` so the link opens
 * something, a `PASSWORD_RECOVERY` branch so the app knows why it suddenly has
 * a session, and this screen to actually call `updateUser`. Without them you
 * clicked the link, landed signed-in on the feed, and still did not know your
 * password.
 *
 * There is no "current password" field and there should not be: clicking a
 * link in an inbox you control *is* the proof. Asking for the password you
 * forgot would be a good joke and a dead end.
 */
export default function ResetPasswordScreen() {
  const router = useRouter();
  const { updatePassword, recovering, session } = useAuth();
  const reduced = useReducedMotion();

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

  const entering = (delay: number) =>
    reduced ? undefined : FadeInDown.delay(delay).duration(motion.duration.base);

  return (
    <Screen ground="sunken">
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
              <View className="mb-5">
                <LotusMark size={64} />
              </View>
              <Text className="text-2xl font-bold text-primary">
                {linkDead ? 'That link has expired' : 'Pick a new password'}
              </Text>
              <Text className="mt-2 max-w-[300px] text-center text-callout leading-5 text-secondary">
                {linkDead
                  ? 'Reset links only last an hour. Ask for a fresh one and it will work.'
                  : 'Type it twice. You will be signed in as soon as it saves.'}
              </Text>
            </Animated.View>

            {error && (
              <View className="mb-4">
                <ErrorNotice message={error} />
              </View>
            )}

            {linkDead ? (
              <Animated.View entering={entering(60)}>
                <Button
                  title="Back to sign in"
                  variant="primary"
                  size="lg"
                  onPress={() => router.replace('/(auth)/sign-in')}
                />
              </Animated.View>
            ) : (
              <Animated.View entering={entering(60)}>
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

                {/* One line, and only once there is something to say about.
                    A validation message under an empty field is noise. */}
                {tooShort ? (
                  <Text className="mt-2.5 px-1 text-sm text-negative">
                    A bit longer — {MIN_LENGTH} characters minimum.
                  </Text>
                ) : mismatch ? (
                  <Text className="mt-2.5 px-1 text-sm text-negative">
                    Those two don&apos;t match yet.
                  </Text>
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
              </Animated.View>
            )}
          </ContentWidth>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
