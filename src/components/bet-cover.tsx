import { LinearGradient } from 'expo-linear-gradient';
import { View } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';

import { COVER_PETAL, betCover } from '@/lib/bet-cover';
import { useColors } from '@/providers/theme-provider';

/**
 * The background a bet gets when nobody attached a photo.
 *
 * ---------------------------------------------------------------------------
 * Why a cover rather than a text-only card
 * ---------------------------------------------------------------------------
 * The feed used to give a bet with no media a different layout entirely: the
 * question at Large Title over the card's own surface, taking the space the
 * photo would have had. That reads well on its own and badly in a column —
 * scrolling alternates between full-bleed photographs and pages of type, and
 * the feed stops feeling like one stream.
 *
 * A generated cover makes every card the same shape. It also fixes the clipping
 * bug for free: the text-only layout centred a 6-line Large Title inside a
 * fixed-height box, so a long question ran out of room and lost its last lines
 * with nothing to show it had. Over a cover the title is the same size as it is
 * over a photo, in a row that sizes to its content.
 *
 * ---------------------------------------------------------------------------
 * Drawn, not shipped
 * ---------------------------------------------------------------------------
 * Six image files would be six bundle assets, six things to redo when the
 * palette moves, and recognisably The Stock Photos by the third scroll. This is
 * a two-stop gradient from the app's own tokens with one large, faint petal
 * from the mark — so the covers are varied, always on-brand, and follow a
 * palette change automatically.
 *
 * `lib/bet-cover.ts` picks which of the six by hashing the bet id, so a bet
 * keeps its face on every device and across every re-render. See there for why
 * that is not `Math.random()`.
 */
export function BetCoverView({ betId, className = '' }: { betId: string; className?: string }) {
  const colors = useColors();
  const cover = betCover(betId, colors);

  // The petal is deliberately larger than the card and hangs off one corner.
  // Contained inside the frame it reads as a logo somebody pasted on; bled off
  // the edge it reads as texture, which is what a cover wants to be.
  const anchor =
    cover.anchor === 'top-right'
      ? { top: '-18%' as const, right: '-22%' as const }
      : { bottom: '-24%' as const, left: '-20%' as const };

  return (
    <View className={`overflow-hidden ${className}`} pointerEvents="none">
      <LinearGradient
        colors={cover.colors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      <View style={{ position: 'absolute', width: '86%', aspectRatio: 1, ...anchor }}>
        <Svg width="100%" height="100%" viewBox="0 0 512 512">
          <G transform={`rotate(${cover.rotation} 256 256)`}>
            {/*
              Flat white at low opacity rather than a second gradient stop.
              A gradient here would need eight-digit hex alpha to fade out, and
              CLAUDE.md §4 records that leaving a hard seam wherever a stop does
              not truly reach zero. `fillOpacity` has no such problem.

              White rather than a token because this sits on a coloured ground in
              both schemes — the same reason text over media is the one place a
              literal is allowed.
            */}
            <Path d={COVER_PETAL} fill="#FFFFFF" fillOpacity={0.14} />
          </G>
        </Svg>
      </View>
    </View>
  );
}
