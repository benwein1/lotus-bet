import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from '@/components/animated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenGround } from '@/components/screen';
import { Avatar, Button, ErrorNotice } from '@/components/ui';
import { useAuth } from '@/providers/auth-provider';
import { colors } from '@/theme';

export default function ProfileSetupScreen() {
  const { updateProfile, session } = useAuth();
  const [name, setName] = useState('');
  const [focused, setFocused] = useState(false);
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

  return (
    <View className="flex-1 bg-ink-950">
      <ScreenGround />
      <SafeAreaView className="flex-1">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1 justify-between px-gutter pb-8 pt-14"
        >
          <View>
            <Animated.View entering={FadeInDown.duration(420)}>
              <Text className="font-display-bold text-5xl leading-[54px] text-ink-50">
                What should{'\n'}we call you?
              </Text>
              <Text className="mt-5 text-base leading-7 text-ink-500">
                This is the name your friends see on every bet.
              </Text>
            </Animated.View>

            {/* The avatar previews live as they type — the colour is derived
                from their user id, so it is the one they will actually get. */}
            <Animated.View
              entering={FadeInDown.delay(90).duration(420)}
              className="my-10"
            >
              <Avatar name={trimmed || '?'} id={session?.user.id} size={72} />
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(150).duration(420)}>
              <TextInput
                value={name}
                onChangeText={setName}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                placeholder="Dor Levi"
                placeholderTextColor={colors.ink['650']}
                autoCapitalize="words"
                autoComplete="name"
                maxLength={40}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={submit}
                className={`h-16 border-b-2 px-1 font-display text-2xl text-ink-50 ${
                  focused ? 'border-ink-50' : 'border-ink-750'
                }`}
              />
              <Text className="mt-3 text-xs text-ink-600">
                {trimmed.length < 2
                  ? 'At least two characters.'
                  : `${40 - trimmed.length} characters left`}
              </Text>
            </Animated.View>

            {error && (
              <Animated.View entering={FadeIn.duration(200)} className="mt-5">
                <ErrorNotice message={error} />
              </Animated.View>
            )}
          </View>

          <Button
            title="Start betting"
            size="lg"
            onPress={submit}
            loading={busy}
            disabled={trimmed.length < 2}
          />
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
