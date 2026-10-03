import { LinearGradient } from 'expo-linear-gradient';
import { ScrollView, Text, View } from 'react-native';

import { PressableScale, selectionTap } from '@/components/ui';
import { useColors } from '@/providers/theme-provider';

/**
 * A row of tabs with the mark's ramp under the selected one.
 *
 * Underlines rather than a segmented control because there are four of them
 * and one is called "Live Bets": four equal slots give each label about 85px
 * and that one needs most of it. A row that scrolls can let every label keep
 * its own width, and the ramp says which is current without a filled pill
 * competing with the content below.
 */
export function UnderlineTabs<T extends string>({
  tabs,
  value,
  onChange,
  variant = 'ramp',
}: {
  tabs: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
  /**
   * `ramp` is the group's: labels at their own width, scrolling, with the
   * mark's gradient under the current one. `even` is the profile's: three
   * equal columns under a plain white rule. Two shapes because the group has
   * four tabs and one of them is called "Live Bets", while the profile has
   * three short words that divide the width cleanly.
   */
  variant?: 'ramp' | 'even';
}) {
  const colors = useColors();

  const even = variant === 'even';
  const Row = even ? View : ScrollView;

  // The rule belongs to the row, not to the labels: on the scrolling variant
  // it was on the scroll *content*, so it stopped wherever the four words
  // happened to end rather than running the width of the page as drawn.
  const row = (
    <Row
      {...(even
        ? { className: 'flex-row gap-1.5' }
        : {
            horizontal: true,
            showsHorizontalScrollIndicator: false,
            contentContainerClassName: 'gap-[22px] pr-6',
          })}
    >
      {tabs.map((tab) => {
        const active = tab.key === value;
        return (
          <PressableScale
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            aria-selected={active}
            accessibilityLabel={tab.label}
            scaleTo={0.97}
            onPress={() => {
              if (active) return;
              selectionTap();
              onChange(tab.key);
            }}
            style={
              even && active
                ? { borderBottomWidth: 2, borderBottomColor: colors.text }
                : even
                  ? { borderBottomWidth: 2, borderBottomColor: 'transparent' }
                  : undefined
            }
            className={`min-h-[44px] justify-center pb-[11px] ${
              even ? 'flex-1 items-center' : ''
            }`}
          >
            <Text
              className={`text-subhead ${
                active ? 'font-semibold text-primary' : 'font-medium text-secondary'
              }`}
            >
              {tab.label}
            </Text>
            {active && !even && (
              // A point below the label's own box, so the ramp covers the
              // hairline rather than sitting on a shelf above it.
              <LinearGradient
                colors={[colors.markFrom, colors.markTo]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ position: 'absolute', left: 0, right: 0, bottom: -1, height: 2 }}
              />
            )}
          </PressableScale>
        );
      })}
    </Row>
  );

  return <View className="border-b border-hairline">{row}</View>;
}
