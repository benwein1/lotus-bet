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
   * The two differ in *layout only*: `ramp` lets labels keep their own width
   * and scrolls, because the group has four tabs and one is called "Live
   * Bets"; `even` divides the width into equal columns, because the profile
   * has three short words. The selected marker is the mark's ramp in both —
   * `even` used to draw a plain white rule instead, which read as a stray
   * line under the row rather than as an indicator attached to a label.
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
            // Three equal columns is a claim about this tab's share of the
            // ROW, and the row sees the outer box — everything in `className`
            // lands on the inner one. Without this the three labels bunch at
            // the left instead of dividing the width.
            grow={even}
            onPress={() => {
              if (active) return;
              selectionTap();
              onChange(tab.key);
            }}
            className={`min-h-[44px] justify-center pb-[11px] ${
              even ? 'items-center' : ''
            }`}
          >
            <Text
              className={`text-subhead ${
                active ? 'font-semibold text-primary' : 'font-medium text-secondary'
              }`}
            >
              {tab.label}
            </Text>
            {active && (
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
