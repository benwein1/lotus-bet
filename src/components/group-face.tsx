import { Image } from 'expo-image';
import { cssInterop } from 'nativewind';
import { View } from 'react-native';

import { GroupsIcon, ProfileIcon } from '@/components/icons';
import { useColors } from '@/providers/theme-provider';

// `className` is silently dropped on expo-image without registration.
cssInterop(Image, { className: 'style' });

/**
 * A group's face: its photo, or a placeholder where it has none.
 *
 * The placeholder used to be a huddle of the members' own avatars. It read as
 * a crowd rather than as the group's face, and — worse — it made every row in
 * a list a different shape, because a group of two drew two circles and a
 * group of six drew two circles and a number. One glyph on `surface3` is the
 * same object at every size and in every row, which is what a placeholder is
 * for. Who is in the group is said properly elsewhere, as a row of faces
 * under the name.
 */
export function GroupFace({
  avatarUrl,
  size = 40,
  radius = 12,
  round = false,
}: {
  avatarUrl?: string | null;
  size?: number;
  radius?: number;
  /**
   * A circle instead of a square, and a person instead of a group glyph.
   *
   * A duel's face is one other human, so it takes the shape every other
   * avatar in the app has. Passing `radius: 999` would round the box but
   * leave the wrong placeholder inside it.
   */
  round?: boolean;
}) {
  const colors = useColors();
  const corner = round ? 999 : radius;

  if (avatarUrl) {
    return (
      <Image
        source={{ uri: avatarUrl }}
        style={{ width: size, height: size, borderRadius: corner }}
        contentFit="cover"
        transition={140}
      />
    );
  }

  return (
    <View
      style={{ width: size, height: size, borderRadius: corner }}
      className="items-center justify-center bg-surface3"
    >
      {round ? (
        <ProfileIcon size={Math.round(size * 0.5)} color={colors.textTertiary} />
      ) : (
        <GroupsIcon size={Math.round(size * 0.46)} color={colors.textTertiary} />
      )}
    </View>
  );
}
