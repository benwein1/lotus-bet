import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AlertIcon, CheckIcon } from '@/components/icons';
import { ContentWidth, Screen } from '@/components/screen';
import { Button, ErrorNotice } from '@/components/ui';
import { deleteAccount } from '@/lib/queries';
import { useAuth } from '@/providers/auth-provider';
import { useColors } from '@/providers/theme-provider';

/** Typed to confirm. Short enough to type, specific enough not to be a reflex. */
const PHRASE = 'DELETE';

/**
 * Deleting your account.
 *
 * Guideline 5.1.1(v) requires this to exist in the app, and requires it to be
 * findable rather than buried. What it does **not** require is that the app
 * lie about what happens, and the honest version here is unusual enough to be
 * worth a whole screen.
 *
 * Betta's job is recording who owes whom. A bet that has been called wrote
 * one signed row per person, and `group_balances` sums those to work out what
 * *everyone else* owes. Deleting this person's rows would not erase one
 * person's data — it would silently change what four other people owe each
 * other, in a direction that happens to favour whoever left. So the balances
 * stay, under the name "Deleted account", and this screen says so before you
 * press anything rather than after.
 *
 * Everything that is genuinely yours alone — your name, your photo, your email
 * address, your comments — is gone, and the account cannot sign in again.
 */
export default function DeleteAccountScreen() {
  const router = useRouter();
  const colors = useColors();
  const { signOut } = useAuth();

  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmed = typed.trim().toUpperCase() === PHRASE;

  async function run() {
    if (!confirmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAccount();
      // The JWT outlives the account it was issued for, so signing out is not
      // tidying — it is what actually ends the session.
      await signOut();
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the account.');
      setBusy(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Delete account', headerBackTitle: 'Back' }} />
      <Screen ground="sunken">
        <SafeAreaView edges={['bottom']} className="flex-1">
          <ScrollView
            contentContainerClassName="px-gutter pb-10 pt-4"
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <ContentWidth>
              <View className="items-center py-2">
                <View className="h-14 w-14 items-center justify-center rounded-full bg-negative-soft">
                  <AlertIcon size={28} color={colors.negative} />
                </View>
                <Text className="mt-4 text-center text-2xl font-bold text-primary">
                  Delete your account
                </Text>
                <Text className="mt-2 text-center text-callout leading-[22px] text-secondary">
                  This cannot be undone. Read what stays before you do it.
                </Text>
              </View>

              {error && (
                <View className="mt-5">
                  <ErrorNotice message={error} />
                </View>
              )}

              <View className="mt-7 rounded-3xl border border-hairline bg-surface p-5">
                <Text className="text-base font-semibold text-primary">What is deleted</Text>
                <View className="mt-3 gap-2.5">
                  <Bullet>Your name, photo, handle and email address.</Bullet>
                  <Bullet>Every comment you have written.</Bullet>
                  <Bullet>Your likes, your blocks, and any photos you uploaded.</Bullet>
                  <Bullet>Your sides on bets that are still open.</Bullet>
                  <Bullet>
                    The account itself. You will not be able to sign in, and the email
                    address is free to use again.
                  </Bullet>
                </View>
              </View>

              <View className="mt-4 rounded-3xl border border-hairline bg-surface p-5">
                <Text className="text-base font-semibold text-primary">What stays</Text>
                <Text className="mt-2 text-subhead leading-5 text-secondary">
                  Bets that have already been called keep their result, under the name
                  &ldquo;Deleted account&rdquo;.
                </Text>
                <Text className="mt-3 text-subhead leading-5 text-secondary">
                  That is not us keeping your data. A settled bet wrote down what each
                  person ended up owing, and your friends&apos; balances are worked out from
                  those lines. Removing yours would quietly change what{' '}
                  <Text className="font-semibold text-primary">they</Text> owe each other.
                </Text>
              </View>

              <View className="mt-4 rounded-3xl border border-hairline bg-surface p-5">
                <Text className="text-base font-semibold text-primary">
                  Bets you created and never called
                </Text>
                <Text className="mt-2 text-subhead leading-5 text-secondary">
                  They are cancelled, because nobody else can call them. Nothing is owed on
                  a cancelled bet.
                </Text>
              </View>

              <View className="mt-7">
                <Text className="mb-2 px-1 text-subhead text-secondary">
                  Type {PHRASE} to confirm.
                </Text>
                <View className="flex-row items-center gap-2 rounded-2xl border border-hairline bg-surface px-4">
                  <TextInput
                    value={typed}
                    onChangeText={setTyped}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    editable={!busy}
                    placeholder={PHRASE}
                    placeholderTextColor={colors.textTertiary}
                    accessibilityLabel={`Type ${PHRASE} to confirm`}
                    className="flex-1 py-3.5 text-lg font-semibold"
                    // See the PaymentSheet note in CLAUDE.md §4 — `flex-1`
                    // alone leaves `min-width: auto` and the row cannot shrink.
                    style={{ color: colors.text, minWidth: 0 }}
                  />
                  {confirmed && <CheckIcon size={20} color={colors.negative} />}
                </View>
              </View>

              <View className="mt-6 gap-3">
                <Button
                  title={busy ? 'Deleting' : 'Delete my account'}
                  variant="destructive"
                  size="lg"
                  loading={busy}
                  disabled={!confirmed || busy}
                  onPress={() => void run()}
                />
                <Button
                  title="Keep my account"
                  variant="plain"
                  size="lg"
                  disabled={busy}
                  onPress={() => router.back()}
                />
              </View>
            </ContentWidth>
          </ScrollView>
        </SafeAreaView>
      </Screen>
    </>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <View className="flex-row gap-2.5">
      <Text className="text-subhead text-tertiary">•</Text>
      <Text className="flex-1 text-subhead leading-5 text-secondary">{children}</Text>
    </View>
  );
}
