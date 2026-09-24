import Constants from 'expo-constants';
import { Link, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, ScrollView, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';

import { ChevronRightIcon, LogOutIcon } from '@/components/icons';
import { ContentWidth, Screen } from '@/components/screen';
import {
  Avatar,
  Button,
  ErrorNotice,
  ListGroup,
  PressableScale,
  Row,
  SectionTitle,
  Segmented,
  useConfirm,
} from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { SUPPORT_CONTACT_PUBLISHED, SUPPORT_EMAIL, SUPPORT_MAILTO } from '@/lib/legal';
import { clearPushToken } from '@/lib/notifications';
import { cancelDeadlineReminders } from '@/lib/reminders';
import { fetchBlockedUsers, unblockUser } from '@/lib/queries';
import { useAuth } from '@/providers/auth-provider';
import { useAppearance, useColors } from '@/providers/theme-provider';

/** The four notification columns, which one switch writes together. */
type NotifyKey =
  | 'notify_new_bets'
  | 'notify_resolutions'
  | 'notify_group_joins'
  | 'notify_deadlines';

/**
 * How the app works, and the account underneath it.
 *
 * Split out of Profile, which had become two screens in one scroll: who you
 * are and what you have bet, then appearance, notifications, blocked people,
 * the legal documents, sign out and delete. The line between them is the one
 * people already expect — a profile is *you*, settings are the *app* — and
 * Profile is a page you show someone, which is not a thing you can say of a
 * screen with "Delete account" at the bottom.
 *
 * Pushed from the root stack rather than living in the tabs, so it takes the
 * whole screen with no bar floating over it. There is one way back and it is
 * the one at the top.
 */
export default function SettingsScreen() {
  const { profile, updateProfile, signOut } = useAuth();
  const colors = useColors();
  const router = useRouter();
  const { preference, setPreference } = useAppearance();
  const { ask, dialog } = useConfirm();

  const blocked = useAsync(fetchBlockedUsers, [profile?.id ?? '']);
  const { reload: reloadBlocked } = blocked;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void reloadBlocked({ silent: true });
    }, [reloadBlocked])
  );

  // Spelled as a sentence rather than "1.0.0 · 12". A support request that
  // quotes the build is worth a great deal and this is the only place anybody
  // can read it, so it has to be legible rather than terse.
  const build = Constants.nativeBuildVersion;
  const version = Constants.expoConfig?.version ?? '—';
  const versionLabel = build ? `Version ${version} (build ${build})` : `Version ${version}`;

  // `undefined` rather than a boolean means the project has not had the
  // notification-prefs migration applied yet.
  const hasNewerPrefs = profile?.notify_group_joins !== undefined;

  /**
   * On if *any* kind is still on.
   *
   * Accounts made before this screen had one switch can be in a mixed state —
   * someone who turned off only "new bets" is still being notified, and a
   * switch reading "off" while their phone buzzes would be a lie. Toggling
   * either way writes all four, so a mixed state survives exactly one tap.
   */
  const notificationsOn =
    (profile?.notify_new_bets ?? true) ||
    (profile?.notify_resolutions ?? true) ||
    (profile?.notify_group_joins ?? true) ||
    (profile?.notify_deadlines ?? true);

  /**
   * One switch for the lot.
   *
   * The four columns stay. `push_targets_for_bet` and `push_targets_for_group`
   * read them per kind, and the reminder scheduler reads `notify_deadlines` on
   * its own — collapsing the *storage* would mean touching the push fan-out and
   * the SQL that decides who hears about what, to solve a problem that is
   * entirely in the UI. So the switch writes all four together and the backend
   * never learns anything changed.
   */
  async function toggleNotifications(value: boolean) {
    setError(null);
    setSaving(true);
    try {
      // Every key the project actually has. On a project without the prefs
      // migration, writing the two it does not know about would fail the whole
      // update.
      const patch: Partial<Record<NotifyKey, boolean>> = {
        notify_new_bets: value,
        notify_resolutions: value,
      };
      if (hasNewerPrefs) {
        patch.notify_group_joins = value;
        patch.notify_deadlines = value;
      }
      await updateProfile(patch);

      // Deadline reminders are scheduled on this device, so turning them off
      // has to take effect here and now rather than at the next feed refresh.
      if (!value) {
        await cancelDeadlineReminders();
        // Nothing left to send: drop the token rather than keep a stale one.
        await clearPushToken();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that setting.');
    } finally {
      setSaving(false);
    }
  }

  /**
   * Unblocking is not confirmed.
   *
   * Blocking is the destructive direction and asks first; undoing it puts
   * things back the way they were and costs one more tap to redo.
   */
  async function undoBlock(id: string) {
    setError(null);
    try {
      await unblockUser(id);
      await reloadBlocked({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not unblock that person.');
    }
  }

  function confirmSignOut() {
    ask({
      title: 'Sign out?',
      message: 'Your bets and balances stay exactly where they are.',
      cancelLabel: 'Stay',
      confirmLabel: 'Sign out',
      destructive: true,
      onConfirm: () => void signOut(),
    });
  }

  return (
    <Screen ground="sunken">
      <SafeAreaView edges={['bottom']} className="flex-1">
        <ScrollView contentContainerClassName="px-gutter pb-12 pt-4" showsVerticalScrollIndicator={false}>
          <ContentWidth>
            {error && <ErrorNotice message={error} />}

            <View className="mb-7">
              <SectionTitle>Appearance</SectionTitle>
              <View className="rounded-2xl border border-hairline bg-surface p-3">
                <Segmented
                  value={preference}
                  onChange={setPreference}
                  options={[
                    { value: 'system', label: 'System' },
                    { value: 'light', label: 'Light' },
                    { value: 'dark', label: 'Dark' },
                  ]}
                />
                <Text className="mt-2.5 px-1 text-sm text-secondary">
                  System follows your device between light and dark.
                </Text>
              </View>
            </View>

            <View className="mb-7">
              <SectionTitle>Notifications</SectionTitle>
              <ListGroup>
                <ToggleRow
                  label="Notify me"
                  hint="New bets, results, people joining, and a nudge before a bet you haven't answered closes."
                  value={notificationsOn}
                  disabled={saving}
                  onChange={(v) => void toggleNotifications(v)}
                  last
                />
              </ListGroup>
            </View>

            {/* Only rendered once there is something to undo. A permanently
                empty "Blocked" heading would be the app advertising a problem
                most groups do not have. */}
            {(blocked.data ?? []).length > 0 && (
              <View className="mb-7">
                <SectionTitle>Blocked</SectionTitle>
                <ListGroup>
                  {(blocked.data ?? []).map((person, i, all) => (
                    <View
                      key={person.id}
                      className={`flex-row items-center gap-3 px-4 py-3 ${
                        i < all.length - 1 ? 'border-b border-hairline' : ''
                      }`}
                    >
                      <Avatar
                        id={person.id}
                        name={person.display_name}
                        uri={person.avatar_url}
                        size={32}
                      />
                      <View className="flex-1">
                        <Text numberOfLines={1} className="text-subhead font-semibold text-primary">
                          {person.display_name}
                        </Text>
                        {person.username ? (
                          <Text numberOfLines={1} className="text-2xs text-tertiary">
                            @{person.username}
                          </Text>
                        ) : null}
                      </View>
                      <Button
                        title="Unblock"
                        variant="tinted"
                        size="sm"
                        onPress={() => void undoBlock(person.id)}
                      />
                    </View>
                  ))}
                </ListGroup>
                <Text className="mt-2 px-1 text-sm text-secondary">
                  Unblocking brings their comments back. It never changed who owes who.
                </Text>
              </View>
            )}

            {/* The two documents are screens rather than links out: the text
                ships with the build, so they open with no network and before
                any domain exists. */}
            <View className="mb-7">
              <SectionTitle>About</SectionTitle>
              <ListGroup>
                <Row
                  label="Terms of Service"
                  trailing={<ChevronRightIcon size={18} color={colors.textTertiary} />}
                  onPress={() => router.push('/legal/terms')}
                />
                <Row
                  label="Privacy Policy"
                  trailing={<ChevronRightIcon size={18} color={colors.textTertiary} />}
                  onPress={() => router.push('/legal/privacy')}
                />
                <Row
                  label="Support"
                  trailing={<ChevronRightIcon size={18} color={colors.textTertiary} />}
                  onPress={() => router.push('/legal/support')}
                  last={!SUPPORT_CONTACT_PUBLISHED}
                />
                {/* Only when there is an address to write to. A contact row
                    that opens a mail composer addressed at a placeholder is
                    worse than no row: it looks like the app answered you. */}
                {SUPPORT_CONTACT_PUBLISHED && (
                  <Row
                    label="Contact us"
                    value={SUPPORT_EMAIL}
                    onPress={() => void Linking.openURL(SUPPORT_MAILTO)}
                    last
                  />
                )}
              </ListGroup>
              <Text className="mt-2.5 px-1 text-sm text-tertiary">{versionLabel}</Text>
            </View>

            <Button
              title="Sign out"
              variant="destructive"
              icon={<LogOutIcon size={16} color={colors.negative} />}
              onPress={confirmSignOut}
            />

            {/* Guideline 5.1.1(v) requires deletion to be reachable in the app.
                It sits under Sign out, as a plain link rather than a fourth
                button: it has to be findable without being a thing you hit by
                accident next to the one you meant. */}
            <Link href="/delete-account" asChild>
              <PressableScale
                scaleTo={0.99}
                accessibilityRole="button"
                accessibilityLabel="Delete your account"
                className="mt-5 items-center py-2"
              >
                <Text className="text-subhead text-tertiary">Delete account</Text>
              </PressableScale>
            </Link>

            <Text className="mt-7 text-center text-xs leading-4 text-tertiary">
              Betta is a tracker. It holds no money, processes no payments, and sells no currency.
            </Text>
          </ContentWidth>
        </ScrollView>
      </SafeAreaView>
      {dialog}
    </Screen>
  );
}

/** A labelled switch with its explanation underneath. */
function ToggleRow({
  label,
  hint,
  value,
  disabled,
  onChange,
  last,
}: {
  label: string;
  hint?: string;
  value: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  last?: boolean;
}) {
  const colors = useColors();

  return (
    <View
      className={`flex-row items-center gap-4 px-4 py-3 ${
        last ? '' : 'border-b border-hairline'
      }`}
    >
      <View className="flex-1">
        <Text className="text-base text-primary">{label}</Text>
        {hint && <Text className="mt-1 text-sm leading-[18px] text-secondary">{hint}</Text>}
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ false: colors.surface3, true: colors.accent }}
        thumbColor={colors.canvas}
        ios_backgroundColor={colors.surface3}
      />
    </View>
  );
}
