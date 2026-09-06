import { useState } from 'react';
import { Text, View } from 'react-native';

import { CameraIcon } from '@/components/icons';
import { Avatar, PressableScale, tap } from '@/components/ui';
import { pickAvatar, uploadAvatar, type PickedMedia } from '@/lib/media';
import { useColors } from '@/providers/theme-provider';

/**
 * A tappable avatar that picks, uploads and hands back the new URL.
 *
 * Profile and group pictures are the same interaction and the same bucket, so
 * they are the same control: the only difference is which path the file lands
 * under, which is what `owner` says.
 *
 * The upload can only happen once the row exists — the owner id is part of the
 * storage path. On the create-a-group screen there is no group yet, so it runs
 * in `deferred` mode: it keeps the picked file locally, shows it, and lets the
 * screen upload it after the insert.
 */
export function AvatarPicker({
  name,
  id,
  uri,
  size = 88,
  owner,
  onChange,
  onPick,
  disabled = false,
}: {
  /** Used for the initials and the tint while there is no picture. */
  name: string;
  id?: string;
  uri?: string | null;
  size?: number;
  /**
   * Where the file belongs. Omit to defer the upload — `onPick` then fires
   * with the local file and nothing is written.
   */
  owner?: { kind: 'users' | 'groups'; id: string };
  /** Called with the uploaded public URL. */
  onChange?: (url: string) => void | Promise<void>;
  /** Called with the local file when there is no `owner` yet. */
  onPick?: (media: PickedMedia) => void;
  disabled?: boolean;
}) {
  const colors = useColors();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localUri, setLocalUri] = useState<string | null>(null);

  async function choose() {
    if (busy || disabled) return;
    setError(null);
    try {
      const picked = await pickAvatar();
      if (!picked) return;

      // Show the local file straight away. Waiting for a round trip before the
      // picture appears makes the app feel like it did not register the tap.
      setLocalUri(picked.uri);

      if (!owner) {
        onPick?.(picked);
        return;
      }

      setBusy(true);
      const url = await uploadAvatar(owner, picked);
      await onChange?.(url);
    } catch (err) {
      setLocalUri(null);
      setError(err instanceof Error ? err.message : 'Could not set that picture.');
    } finally {
      setBusy(false);
    }
  }

  const shown = localUri ?? uri ?? null;

  return (
    <View className="items-center">
      <PressableScale
        onPress={() => {
          tap();
          void choose();
        }}
        disabled={disabled}
        scaleTo={0.95}
        accessibilityRole="button"
        accessibilityLabel={shown ? `Change ${name}'s picture` : `Add a picture for ${name}`}
        accessibilityState={{ busy }}
        className={busy ? 'opacity-60' : ''}
      >
        <Avatar name={name} id={id} uri={shown} size={size} />

        {/* The badge is what says this is a control and not decoration. */}
        <View
          style={{ width: size * 0.32, height: size * 0.32, borderRadius: size * 0.16 }}
          className="absolute bottom-0 right-0 items-center justify-center border-2 border-canvas bg-accent"
        >
          <CameraIcon size={size * 0.17} color={colors.accentInk} />
        </View>
      </PressableScale>

      <Text className="mt-2.5 text-sm text-secondary">
        {busy ? 'Uploading…' : shown ? 'Tap to change' : 'Add a photo'}
      </Text>

      {error && <Text className="mt-1 text-center text-sm text-negative">{error}</Text>}
    </View>
  );
}
