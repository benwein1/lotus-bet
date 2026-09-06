import { Alert, Platform } from 'react-native';

/**
 * A yes/no confirmation before something irreversible.
 *
 * This exists because `Alert.alert` is a no-op on react-native-web — the
 * implementation is literally `static alert() {}`. Every confirm in the app
 * therefore did nothing at all in a browser: sign out, resolve, cancel and
 * "mark as paid" were dead controls on the one platform the design loop
 * actually runs on. On web this falls through to the browser's own confirm;
 * on native it is the system alert, unchanged.
 *
 * Only two buttons, and the cancel is always the one a stray tap lands on.
 */
export function confirm({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Marks the action red on iOS. Does not change what it does. */
  destructive?: boolean;
  onConfirm: () => void;
}): void {
  if (Platform.OS === 'web') {
    // `window.confirm` blocks the thread and returns a boolean — no callback,
    // and no way to label the buttons. The title carries the question so the
    // dialog still reads as the same decision.
    if (globalThis.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }

  Alert.alert(title, message, [
    { text: cancelLabel, style: 'cancel' },
    { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
  ]);
}
