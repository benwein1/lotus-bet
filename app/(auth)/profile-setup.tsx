import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from '@/components/animated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ContentWidth, Screen } from '@/components/screen';
import { Avatar, BlockField, Button, ErrorNotice } from '@/components/ui';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useAuth } from '@/providers/auth-provider';
import { motion } from '@/theme';

export default function ProfileSetupScreen() {
  const { updateProfile, session } = useAuth();
  const reduced = useReducedMotion();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const trimmed = name.trim();

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await updateProfile({ display_name: trimmed });
      // The root navigator redirects to the tabs once the name sticks.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your name.');
    } finally {
      setBusy(false);
    }
  }

  const entering = (delay: number) =>
    reduced ? FadeIn.duration(motion.duration.fast) : FadeInDown.delay(delay).duration(420);

  return (
    <Screen ground="sunken">
      <SafeAreaView className="flex-1">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1 justify-between px-gutter pb-8 pt-14"
        >
          <ContentWidth>
            <Animated.View entering={entering(0)}>
              <Text className="text-3xl font-bold text-primary">What should we call you?</Text>
              <Text className="mt-3 text-callout leading-5 text-secondary">
                This is the name your friends see on every bet.
              </Text>
            </Animated.View>

            {/* The avatar previews live as they type — the colour is derived
                from their user id, so it is the one they will actually get. */}
            <Animated.View entering={entering(90)} className="my-9 items-center">
              <Avatar name={trimmed || '?'} id={session?.user.id} size={84} />
            </Animated.View>

            <Animated.View entering={entering(150)}>
              <BlockField
                label="Display name"
                value={name}
                onChangeText={setName}
                placeholder="Dor Levi"
                autoCapitalize="words"
                autoComplete="name"
                maxLength={40}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={submit}
              />
              <Text className="mt-2 px-1 text-sm text-secondary">
                {trimmed.length < 2
                  ? 'At least two characters.'
                  : `${40 - trimmed.length} characters left`}
              </Text>
            </Animated.View>

            {error && (
              <Animated.View entering={FadeIn.duration(180)} className="mt-5">
                <ErrorNotice message={error} />
              </Animated.View>
            )}
          </ContentWidth>

          <ContentWidth>
            <Button
              title="Start betting"
              size="lg"
              onPress={submit}
              loading={busy}
              disabled={trimmed.length < 2}
            />
          </ContentWidth>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Screen>
  );
}
