import { View, useWindowDimensions } from 'react-native';

import { Skeleton } from '@/components/ui';

/**
 * Screen-shaped placeholders.
 *
 * These mirror the real layout closely enough that content does not jump when
 * it lands — which is the whole point of a skeleton over a spinner.
 */

/** One full-height feed card, the shape the Home tab actually scrolls. */
export function FeedCardSkeleton({ height }: { height: number }) {
  return (
    <View
      style={{ height }}
      className="mb-4 justify-end overflow-hidden rounded-4xl border border-hairline bg-surface p-5"
    >
      <View className="flex-row items-center gap-2.5">
        <Skeleton width={26} height={26} radius={13} />
        <Skeleton width={130} height={12} />
      </View>
      <View className="mt-5 gap-2.5">
        <Skeleton height={24} />
        <Skeleton width="70%" height={24} />
      </View>
      <View className="mt-6 flex-row items-end justify-between">
        <Skeleton width={70} height={26} />
        <Skeleton width={70} height={26} />
      </View>
      <View className="mt-3">
        <Skeleton height={6} radius={3} />
      </View>
      <View className="mt-5 flex-row gap-3">
        <Skeleton height={48} radius={16} />
      </View>
    </View>
  );
}

export function BetFeedSkeleton({ cardHeight }: { cardHeight?: number }) {
  const { height } = useWindowDimensions();
  const size = cardHeight ?? height * 0.68;

  return (
    <View>
      <FeedCardSkeleton height={size} />
      <FeedCardSkeleton height={size} />
    </View>
  );
}

/** The compact card used inside a group, not the feed. */
export function BetCardSkeleton() {
  return (
    <View className="mb-3 rounded-3xl border border-hairline bg-surface px-4 py-4">
      <View className="mb-3 flex-row items-center justify-between">
        <Skeleton width={110} height={11} />
        <Skeleton width={58} height={18} radius={9} />
      </View>
      <Skeleton height={16} />
      <View className="mt-2">
        <Skeleton width="65%" height={16} />
      </View>
      <View className="mt-4 flex-row items-end justify-between">
        <Skeleton width={62} height={24} />
        <Skeleton width={62} height={24} />
      </View>
      <View className="mt-2.5">
        <Skeleton height={6} radius={3} />
      </View>
    </View>
  );
}

export function GroupRowSkeleton() {
  return (
    <View className="mb-3 rounded-3xl border border-hairline bg-surface p-4">
      <View className="flex-row items-center gap-4">
        <Skeleton width={52} height={52} radius={18} />
        <View className="flex-1 gap-2">
          <Skeleton width="60%" height={16} />
          <Skeleton width={78} height={11} />
        </View>
        <View className="items-end gap-2">
          <Skeleton width={62} height={20} />
          <Skeleton width={48} height={10} />
        </View>
      </View>
    </View>
  );
}

export function GroupListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }, (_, i) => (
        <GroupRowSkeleton key={i} />
      ))}
    </View>
  );
}

export function SettleSkeleton() {
  return (
    <View>
      <View className="mb-5 items-center rounded-3xl border border-hairline bg-surface py-7">
        <Skeleton width={120} height={11} />
        <View className="mt-3">
          <Skeleton width={160} height={40} radius={12} />
        </View>
      </View>
      {Array.from({ length: 2 }, (_, i) => (
        <View
          key={i}
          className="mb-2.5 flex-row items-center gap-3 rounded-3xl border border-hairline bg-surface p-4"
        >
          <Skeleton width={38} height={38} radius={19} />
          <View className="flex-1 gap-2">
            <Skeleton width="55%" height={14} />
            <Skeleton width={70} height={20} />
          </View>
          <Skeleton width={96} height={34} radius={17} />
        </View>
      ))}
    </View>
  );
}

export function ProfileSkeleton() {
  return (
    <View>
      <View className="mb-5 items-center rounded-3xl border border-hairline bg-surface py-7">
        <Skeleton width={76} height={76} radius={38} />
        <View className="mt-4">
          <Skeleton width={150} height={20} />
        </View>
        <View className="mt-2.5">
          <Skeleton width={110} height={12} />
        </View>
      </View>
      <View className="flex-row gap-3">
        {Array.from({ length: 3 }, (_, i) => (
          <View key={i} className="flex-1 rounded-2xl border border-hairline bg-surface px-3.5 py-4">
            <Skeleton width="75%" height={20} />
            <View className="mt-2.5">
              <Skeleton width={44} height={10} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}
