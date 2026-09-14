import { useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeIn } from '@/components/animated';

import { AuthShell } from '@/components/auth-shell';
import { Avatar, BlockField, Button, ErrorNotice, PressableScale } from '@/components/ui';
import { useAuth } from '@/providers/auth-provider';

export default function ProfileSetupScreen() {
  const { updateProfile, session, signOut } = useAuth();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const trimmed = name.trim();
  const ready = trimmed.length >= 2;

  async function submit() {
    if (!ready) return;
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
    <AuthShell
      title="One last thing."
      subtitle="Pick the name your friends will see on every bet. You can change it later."
      // Their avatar, not the app's mark: this screen is the moment the app
      // stops introducing itself and starts introducing them. The colour is
      // derived from their user id, so this is the one they actually get.
      hero={<Avatar name={trimmed || '?'} id={session?.user.id} size={84} />}
      footer={
        // The redirect gate pins you here until a name sticks, so this is the
        // only way out if you land on it by mistake.
        <PressableScale
          onPress={() => void signOut()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Sign out instead"
          className="self-center px-3 py-1"
        >
          <Text className="text-subhead text-secondary">Sign out instead</Text>
        </PressableScale>
      }
    >
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
        onSubmitEditing={() => void submit()}
      />
      <Text className="mt-2 px-1 text-sm text-secondary">
        {trimmed.length < 2 ? 'At least two characters.' : `${40 - trimmed.length} characters left`}
      </Text>

      {error && (
        <Animated.View entering={FadeIn.duration(180)} className="mt-5">
          <ErrorNotice message={error} />
        </Animated.View>
      )}

      <View className="mt-6">
        <Button
          title="Start betting"
          size="lg"
          elevated
          onPress={() => void submit()}
          loading={busy}
          disabled={!ready}
        />
      </View>
    </AuthShell>
  );
}
