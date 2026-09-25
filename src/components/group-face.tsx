import { Image } from 'expo-image';
import { cssInterop } from 'nativewind';
import { View } from 'react-native';

import { GroupsIcon } from '@/components/icons';
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
}: {
  avatarUrl?: string | null;
  size?: number;
  radius?: number;
}) {
  const colors = useColors();

  if (avatarUrl) {
    return (
      <Image
        source={{ uri: avatarUrl }}
        style={{ width: size, height: size, borderRadius: radius }}
        contentFit="cover"
        transition={140}
      />
    );
  }

  return (
    <View
      style={{ width: size, height: size, borderRadius: radius }}
      className="items-center justify-center bg-surface3"
    >
      <GroupsIcon size={Math.round(size * 0.46)} color={colors.textTertiary} />
    </View>
  );
}
