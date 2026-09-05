import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { cssInterop } from 'nativewind';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, View, type LayoutChangeEvent } from 'react-native';

import { PlayIcon } from '@/components/icons';
import type { BetMedia } from '@/lib/database.types';

// Neither of these is a component NativeWind knows, so `className` would be
// dropped silently on both. Register them once, here.
cssInterop(Image, { className: 'style' });
cssInterop(VideoView, { className: 'style' });

/**
 * The photo or video attached to a bet.
 *
 * Media is the loudest thing on a feed card, so it gets the whole frame and
 * everything else sits over it. Several attachments become a horizontal pager
 * with a dot row — the same shape as a photo post anywhere else, which is
 * exactly why it needs no explaining.
 */
export function BetMediaView({
  media,
  active = false,
  className = '',
  radius = 0,
}: {
  media: BetMedia[];
  /** True when this card is the one on screen. Only the active card plays. */
  active?: boolean;
  className?: string;
  radius?: number;
}) {
  const [page, setPage] = useState(0);
  const [width, setWidth] = useState(0);

  if (media.length === 0) return null;

  function onLayout(event: LayoutChangeEvent) {
    setWidth(event.nativeEvent.layout.width);
  }

  if (media.length === 1) {
    return (
      <View className={className} style={{ borderRadius: radius, overflow: 'hidden' }}>
        <MediaItem item={media[0]!} active={active} />
      </View>
    );
  }

  return (
    <View className={className} style={{ borderRadius: radius, overflow: 'hidden' }} onLayout={onLayout}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        // Tracking is 1:1 with the finger the whole way; the page only lands
        // once the gesture ends.
        onMomentumScrollEnd={(event) => {
          if (width > 0) setPage(Math.round(event.nativeEvent.contentOffset.x / width));
        }}
        className="flex-1"
      >
        {media.map((item, index) => (
          <View key={item.id} style={{ width: width || undefined }} className="h-full">
            <MediaItem item={item} active={active && index === page} />
          </View>
        ))}
      </ScrollView>

      <View className="absolute inset-x-0 bottom-3 flex-row justify-center gap-1.5">
        {media.map((item, index) => (
          <View
            key={item.id}
            className={`h-1.5 rounded-full ${
              index === page ? 'w-4 bg-on-media' : 'w-1.5 bg-on-media-faint'
            }`}
          />
        ))}
      </View>
    </View>
  );
}

function MediaItem({ item, active }: { item: BetMedia; active: boolean }) {
  if (item.kind === 'video') return <VideoItem item={item} active={active} />;

  return (
    <Image
      source={{ uri: item.url }}
      contentFit="cover"
      transition={220}
      className="h-full w-full"
      accessibilityLabel="Attached photo"
    />
  );
}

/**
 * Feed video plays silently and loops, and only on the card you are actually
 * looking at — anything else is a battery drain and a surprise noise.
 */
function VideoItem({ item, active }: { item: BetMedia; active: boolean }) {
  const player = useVideoPlayer({ uri: item.url }, (instance) => {
    instance.loop = true;
    instance.muted = true;
  });

  // Guard the first run: calling play() before the player has a source is a
  // no-op, but calling it on every render is a stutter.
  const playing = useRef(false);

  useEffect(() => {
    if (active === playing.current) return;
    playing.current = active;
    if (active) player.play();
    else player.pause();
  }, [active, player]);

  return (
    <View className="h-full w-full">
      <VideoView
        player={player}
        contentFit="cover"
        nativeControls={false}
        playsInline
        className="h-full w-full"
      />
      {!active && (
        <View className="absolute inset-0 items-center justify-center">
          <View className="h-12 w-12 items-center justify-center rounded-full bg-scrim">
            <PlayIcon size={20} color="#FFFFFF" />
          </View>
        </View>
      )}
    </View>
  );
}
