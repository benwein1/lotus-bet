import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { cssInterop } from 'nativewind';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { LockIcon, TrophyIcon } from '@/components/icons';
import { PressableScale } from '@/components/ui';
import type { BetWithPositions } from '@/lib/database.types';
import { tileCover } from '@/lib/bet-cover';
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

  const tile = useMemo(() => tileCover(bet.id, colors), [bet.id, colors]);
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
          // A ground of its own, not a grey box.
          //
          // The question sits at the foot of the tile, the way a caption sits
          // over a photo in the tiles beside it — so a grid of both kinds
          // reads as one wall rather than two. Behind it is a teal off the
          // mark's own green-to-blue ramp, a different stretch of the ramp per
          // bet, because `surface2` here was the same grey as the page and
          // made a bet without a picture look like a tile that failed to load.
          // See `tileCover`.
          <View className="h-full w-full">
            {/* A closed bet recedes by losing its colour rather than by
                taking a scrim on top of it: the scrim the photo tiles get is
                built for a photograph, and over an already-dark teal it went
                to near-black. */}
            <LinearGradient
              colors={tile.colors}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[StyleSheet.absoluteFill, marked ? { opacity: 0.38 } : null]}
            />
            {/* The same foot-of-the-tile darkening the photo tiles get, so a
                white caption is legible on the lighter end of the ramp. */}
            <LinearGradient
              colors={['rgba(0,0,0,0.05)', 'rgba(0,0,0,0.55)']}
              style={StyleSheet.absoluteFill}
            />
            {/* `zIndex` on the box, not on the text: the gradients above are
                absolutely positioned and CSS paints those over static content
                whatever the DOM order, so on the web the caption disappeared
                under its own background. Same trap as the tab bar's glyph. */}
            <View style={{ zIndex: 1 }} className="flex-1 justify-end p-[9px]">
              <Text
                numberOfLines={5}
                className={`text-2xs font-semibold leading-[14px] ${
                  marked ? 'text-on-media-soft' : 'text-on-media'
                }`}
              >
                {bet.title}
              </Text>
            </View>
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
              <TrophyIcon size={14} color={colors.onMedia} />
            ) : (
              <LockIcon size={14} color={colors.onMedia} />
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
