import { Image } from 'expo-image';
import { View } from 'react-native';

import { AvatarStack } from '@/components/ui';

/**
 * A group's face in a list: the photo it was given, or the faces of the people
 * in it.
 *
 * There is no third case on purpose. A group with no photo used to get an
 * emoji, and an emoji is a guess — it renders differently on every platform
 * and it tells you nothing the name does not. The members are real data and
 * they answer the only question the slot is there to answer: whose group is
 * this. Nothing is invented, and the slot is never empty, which is what lets
 * it also be the way in to the group's profile.
 */
export function GroupFace({
  avatarUrl,
  members,
  size = 40,
  radius = 12,
}: {
  avatarUrl?: string | null;
  members: { id?: string; name: string; avatarUrl?: string | null }[];
  size?: number;
  radius?: number;
}) {
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
      <AvatarStack people={members} max={2} size={Math.round(size * 0.52)} />
    </View>
  );
}
