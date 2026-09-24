import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { cssInterop } from 'nativewind';
import { useMemo, useState } from 'react';
import { Text, View, type LayoutChangeEvent } from 'react-native';

import { LockIcon, TrophyIcon } from '@/components/icons';
import { PressableScale } from '@/components/ui';
import type { BetWithPositions } from '@/lib/database.types';
import { splitMedia } from '@/lib/media-rules';
import { useColors } from '@/providers/theme-provider';

// `Image` is from expo-image, which NativeWind does not know, so `className`
// would be dropped silently. `bet-media.tsx` registers it too and cssInterop is
// idempotent — this file registers it as well so it does not depend on which
// module happened to load first.
cssInterop(Image, { className: 'style' });

/** Three across, the proportion every photo grid has settled on. */
const COLUMNS = 3;

/** Hairline gutters, so the grid reads as one surface rather than as cards. */
// 5pt between tiles and a 10pt corner on each, as the board draws it: the
// grid reads as a wall of separate bets rather than one mosaic sheet.
const GAP = 5;
const TILE_RADIUS = 10;

/**
 * The bets somebody posted, as a grid.
 *
 * Authorship is the organising idea: this is what you put up, not what you
 * joined. That distinction is why it sits apart from the history list, which
 * answers the other question.
 *
 * **Two kinds of tile, because half of these bets have no photo.** A photo grid
 * that only draws bets with media would be mostly holes, and a placeholder
 * image would be worse — so a bet without an attachment shows its own question
 * instead. The question is the bet; a tile carrying it is not a fallback, it is
 * the honest representation of what was posted.
 *
 * A bet that is no longer running is dimmed and marked, the same treatment
 * `OptionCard` gives a losing side — so "what of mine is still live" reads at a
 * glance, which is the only question a grid like this can usefully answer.
 */
export function BetGrid({ bets }: { bets: BetWithPositions[] }) {
  const router = useRouter();
  const [width, setWidth] = useState<number | null>(null);

  // Measured rather than computed from the window: this sits inside the
  // profile's content column, which is narrower than the screen on a tablet.
  const tile = width === null ? null : (width - GAP * (COLUMNS - 1)) / COLUMNS;

  function onLayout(event: LayoutChangeEvent) {
    const next = event.nativeEvent.layout.width;
    if (next > 0 && next !== width) setWidth(next);
  }

  return (
    <View
      onLayout={onLayout}
      className="flex-row flex-wrap"
      style={{ gap: GAP }}
    >
      {tile !== null &&
        bets.map((bet) => (
          <BetTile
            key={bet.id}
            bet={bet}
            size={tile}
            onPress={() => router.push({ pathname: '/bet/[id]', params: { id: bet.id } })}
          />
        ))}
    </View>
  );
}

function BetTile({
  bet,
  size,
  onPress,
}: {
  bet: BetWithPositions;
  size: number;
  onPress: () => void;
}) {
  const colors = useColors();

  // The bet's own illustration, never its proof of outcome. Proof is a receipt
  // somebody added after the result; letting it become the bet's face in a grid
  // is exactly the permissive mistake `splitMedia` exists to prevent.
  const cover = useMemo(() => {
    const { attachments } = splitMedia(bet.media ?? []);
    return attachments.find((item) => item.kind === 'image' && item.url) ?? null;
  }, [bet.media]);

  const closed = bet.status === 'resolved' || bet.status === 'cancelled';
  const locked = bet.status === 'locked';
  const marked = closed || locked;

  return (
    <PressableScale
      scaleTo={0.97}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={describeTile(bet)}
      style={{ width: size, height: size }}
    >
      <View
        style={{ borderRadius: TILE_RADIUS }}
        className="h-full w-full overflow-hidden bg-sunken"
      >
        {cover ? (
          <Image
            source={{ uri: cover.url }}
            contentFit="cover"
            transition={120}
            className="h-full w-full"
          />
        ) : (
          // No photo, so the question gets the tile. Clamped rather than shrunk
          // to fit — a title that ends in an ellipsis still reads as a question,
          // one set at 9pt does not.
          // The ground stays the same whatever the state. Dropping a closed
          // tile to `sunken` made it disappear in dark mode, where sunken *is*
          // the page ground — the tile stopped reading as a tile and became a
          // hole with text floating in it. A tile is a tile; it is the content
          // that recedes.
          // The question sits at the foot of the tile, the way a caption sits
          // over a photo in the tiles beside it — so a grid of both kinds
          // reads as one wall rather than two.
          <View className="h-full w-full justify-end bg-surface2 p-[9px]">
            <Text
              numberOfLines={5}
              className={`text-2xs font-semibold leading-[14px] ${
                marked ? 'text-tertiary' : 'text-primary'
              }`}
            >
              {bet.title}
            </Text>
          </View>
        )}

        {/* A bet that is no longer running steps back, so the live ones carry
            the eye — the same move `OptionCard` makes on a losing side.

            How it steps back depends on what is underneath. Over a photo a
            scrim is the only thing that works. Over a text tile a scrim would
            put grey on grey and make the question unreadable, so that tile
            recedes through its own ground and label colour instead, set above.
            One intention, two materials. */}
        {marked && (
          <View
            className={`absolute inset-0 items-end justify-start p-1.5 ${
              cover ? 'bg-scrim' : ''
            }`}
          >
            {closed ? (
              <TrophyIcon size={14} color={cover ? colors.onMedia : colors.textTertiary} />
            ) : (
              <LockIcon size={14} color={cover ? colors.onMedia : colors.textTertiary} />
            )}
          </View>
        )}
      </View>
    </PressableScale>
  );
}

/**
 * What a screen reader hears.
 *
 * The tile is a photo or four words of a question, neither of which says what
 * the thing is — so the label carries the title and the state in a sentence,
 * the same way `OptionCard` names its roster rather than leaving the avatars to
 * speak for themselves.
 */
function describeTile(bet: BetWithPositions): string {
  const state =
    bet.status === 'resolved'
      ? 'called'
      : bet.status === 'cancelled'
        ? 'cancelled'
        : bet.status === 'locked'
          ? 'locked'
          : 'still open';
  return `${bet.title}, ${state}`;
}
