import { useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeIn } from '@/components/animated';

import { AuthShell } from '@/components/auth-shell';
import { AGE_FOOTNOTE, DateOfBirthField } from '@/components/date-of-birth-field';
import { Button, ErrorNotice, FieldGroup, PressableScale, useConfirm } from '@/components/ui';
import { MINIMUM_AGE, dateOfBirthProblem, toISODate, type DateParts } from '@/lib/age';
import { useAuth } from '@/providers/auth-provider';

/**
 * The one-time 16+ check, for every account the sign-up form did not cover.
 *
 * Two kinds of person land here and only two: somebody who signed in with
 * Apple or Google — neither provider returns a date of birth, so there was
 * nothing to check at the time — and somebody whose account predates the rule.
 * An email signup is verified by `handle_new_auth_user` before the account
 * exists and never sees this screen.
 *
 * **It is a gate, not a wall.** `require_age_verified()` blocks writes and
 * leaves reads alone, so an account that has not answered can still be signed
 * in and look around; what it cannot do is post. That is why the way out is
 * "sign out" rather than a dead end, and why nothing is deleted for not
 * answering — see the end of `…_minimum_age.sql`, where that remains a
 * product decision rather than a technical one.
 *
 * Reuses `AuthShell` so the mark, the keyboard handling and the money
 * disclaimer are the same as every other pre-tabs screen. There is no bespoke
 * chrome here on purpose.
 */
export default function AgeCheckScreen() {
  const { confirmAge, signOut } = useAuth();
  // The app's own dialog, not `Alert.alert` — that is a no-op on
  // react-native-web. CLAUDE.md §4 gotcha 6.
  const { ask, dialog } = useConfirm();

  const [birth, setBirth] = useState<Partial<DateParts>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const problem = dateOfBirthProblem(birth);
  const ready = problem === null;
  const showProblem = birth.year !== undefined && problem !== null;

  async function submit() {
    if (!ready || busy) return;
    setError(null);
    setBusy(true);
    try {
      await confirmAge(toISODate(birth as DateParts));
      // No navigation here. The root gate watches `needsAgeCheck`, which
      // `confirmAge` clears by reloading the profile — so the screen leaves
      // itself. Pushing a route as well would race that.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not confirm your date of birth.');
    } finally {
      setBusy(false);
    }
  }

  function leave() {
    ask({
      title: 'Sign out?',
      message: 'You can come back and confirm your date of birth at any time.',
      cancelLabel: 'Stay',
      confirmLabel: 'Sign out',
      destructive: true,
      onConfirm: () => void signOut(),
    });
  }

  return (
    <AuthShell
      title="One quick thing."
      subtitle={`Betta is for ages ${MINIMUM_AGE} and over. Tell us when you were born and you are in — we check it and do not keep it.`}
      footer={
        <PressableScale
          onPress={leave}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Sign out instead"
          className="px-1 py-1"
        >
          <Text className="text-subhead font-semibold text-accent">Sign out</Text>
        </PressableScale>
      }
    >
      <FieldGroup footer={AGE_FOOTNOTE}>
        <DateOfBirthField value={birth} onChange={setBirth} onComplete={() => void submit()} last />
      </FieldGroup>

      {showProblem && (
        <Animated.View entering={FadeIn.duration(160)}>
          <Text className="mt-2.5 px-1 text-sm text-negative" accessibilityRole="alert">
            {problem}
          </Text>
        </Animated.View>
      )}

      {error && (
        <Animated.View entering={FadeIn.duration(180)} className="mt-4">
          <ErrorNotice message={error} />
        </Animated.View>
      )}

      <View className="mt-6">
        <Button
          title="Confirm"
          size="lg"
          onPress={() => void submit()}
          loading={busy}
          disabled={!ready}
        />
      </View>

      {dialog}
    </AuthShell>
  );
}
