import { useEffect, useState } from 'react';
import { Modal, Text, View } from 'react-native';

import { BellIcon } from '@/components/icons';
import { Button, PressableScale } from '@/components/ui';
import {
  pushPermissionIsUndetermined,
  registerForPushNotifications,
} from '@/lib/notifications';
import { useColors } from '@/providers/theme-provider';
import { elevation } from '@/theme';

/**
 * Asked once, before the system dialog.
 *
 * Guideline 4.5.4 requires push to be opt-in, and APP_STORE.md §2.6 flags the
 * cold prompt as P1 for a reason that is practical rather than legal: on iOS
 * the system dialog appears **once**. Decline it and the only way back is
 * Settings, which nobody finds. Firing it the instant a session exists asks
 * for a permission before the user has seen a single bet, so the honest answer
 * is "I don't know yet" and the answer the OS records is "no", permanently.
 *
 * So this sheet does the explaining, the system dialog only appears after
 * somebody has said yes to *this*, and "Not now" leaves the OS permission
 * untouched — still `undetermined`, still askable later from the Profile
 * switch. Declining here costs nothing; declining the system dialog costs
 * everything.
 */
export function NotificationPrimer({
  /** Only shown once the user has something to be notified about. */
  ready,
}: {
  ready: boolean;
}) {
  const colors = useColors();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ready) return;
    let active = true;

    // Only when the OS would actually show its dialog. Somebody who already
    // granted or already declined must never see this — for them it would be
    // a sheet that either changes nothing or cannot deliver what it offers.
    void pushPermissionIsUndetermined().then((undetermined) => {
      if (active && undetermined) setVisible(true);
    });

    return () => {
      active = false;
    };
  }, [ready]);

  async function allow() {
    setBusy(true);
    try {
      // The one call in the app that may trigger the system dialog.
      await registerForPushNotifications({ promptBeforeAsking: true });
    } finally {
      setBusy(false);
      setVisible(false);
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => setVisible(false)}
      accessibilityViewIsModal
    >
      <View className="flex-1 items-center justify-center bg-scrim px-8">
        <View
          style={elevation.sheet}
          className="w-full max-w-[340px] overflow-hidden rounded-3xl border border-hairline-strong bg-surface p-6"
        >
          <View className="items-center">
            <View className="h-14 w-14 items-center justify-center rounded-full bg-accent-soft">
              <BellIcon size={26} color={colors.accent} />
            </View>
            <Text className="mt-4 text-center text-lg font-bold text-primary">
              Want to know when a bet is called?
            </Text>
            <Text className="mt-2 text-center text-subhead leading-5 text-secondary">
              We&apos;ll tell you when somebody posts a bet in your group, when one you
              took a side on is settled, and once before a bet you haven&apos;t answered
              closes. Nothing else.
            </Text>
          </View>

          <View className="mt-6 gap-3">
            <Button
              title="Turn them on"
              variant="primary"
              size="lg"
              loading={busy}
              disabled={busy}
              onPress={() => void allow()}
            />
            {/* Not a Button: the quiet option should read as quiet. Choosing it
                leaves the OS permission untouched, so the Profile switch can
                still ask properly later. */}
            <PressableScale
              scaleTo={1}
              onPress={() => setVisible(false)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Not now"
              className="items-center py-2"
            >
              <Text className="text-subhead text-secondary">Not now</Text>
            </PressableScale>
          </View>
        </View>
      </View>
    </Modal>
  );
}
