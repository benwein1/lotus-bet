import { Image } from 'expo-image';
import { Text, View } from 'react-native';

/**
 * A group's face: its photo if it has one, otherwise the emoji it was made
 * with.
 *
 * A group appears in four places — the groups list, the group screen, and both
 * shapes of bet card — and each of them used to render `emoji ?? '🎲'` by
 * hand. One component means adding photos was one change rather than four, and
 * that the fallback can never drift between them.
 *
 * Square with a rounded corner rather than a circle, so a group never reads as
 * a person at a glance.
 */
export function GroupGlyph({
  emoji,
  avatarUrl,
  name,
  size = 48,
  radius,
}: {
  emoji?: string | null;
  avatarUrl?: string | null;
  name?: string;
  size?: number;
  radius?: number;
}) {
  const corner = radius ?? Math.round(size * 0.32);

  return (
    <View
      style={{ width: size, height: size, borderRadius: corner, overflow: 'hidden' }}
      // Decorative in every place it is used: the group's name is always right
      // next to it, so announcing "soccer ball, Sunday League Degenerates"
      // just puts a noise in front of the thing you wanted to hear.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="items-center justify-center bg-surface2"
    >
      {avatarUrl ? (
        <Image
          source={{ uri: avatarUrl }}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
          transition={160}
          accessibilityLabel={name}
        />
      ) : (
        <Text style={{ fontSize: size * 0.44 }}>{emoji ?? '🎲'}</Text>
      )}
    </View>
  );
}
