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
}: {
  tabs: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
}) {
  const colors = useColors();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="gap-6 border-b border-hairline pr-6"
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
            className="min-h-[44px] justify-center pb-2.5"
          >
            <Text
              className={`text-subhead ${
                active ? 'font-semibold text-primary' : 'text-secondary'
              }`}
            >
              {tab.label}
            </Text>
            {active && (
              <LinearGradient
                colors={[colors.markFrom, colors.markTo]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 2 }}
              />
            )}
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}
