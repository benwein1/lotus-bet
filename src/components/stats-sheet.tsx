import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { formatMoney } from '@/lib/currency';
import type { ChartSeries } from '@/lib/profile-chart';
import type { MyStatsRow } from '@/lib/database.types';

/**
 * Everything the chart is a summary of.
 *
 * A sheet rather than a screen: it is a detail of the thing you pressed, you
 * are going straight back, and a push would put a header and a back button in
 * front of four numbers.
 *
 * Cards rather than a list, because these are figures and a figure wants to be
 * read at a size, not scanned down a column of labels.
 */
export function StatsSheet({
  open,
  onClose,
  stats,
  series,
  totals,
}: {
  open: boolean;
  onClose: () => void;
  stats: MyStatsRow | null | undefined;
  series: ChartSeries;
  /** One line per currency: this app never adds two together. */
  totals: { currency: string; netAgorot: number }[];
}) {
  const won = stats?.bets_won ?? 0;
  const lost = stats?.bets_lost ?? 0;
  const decided = won + lost;
  const rate = decided > 0 ? Math.round((won / decided) * 100) : null;

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end bg-scrim" onPress={onClose} accessibilityLabel="Close">
        <View className="max-h-[80%] rounded-t-[30px] border-t border-hairline-strong bg-surface2 px-gutter pb-10 pt-3">
          <View className="mb-5 h-1 w-9 self-center rounded-full bg-hairline-strong" />
          <Text className="text-2xl font-bold text-primary">Your record</Text>

          <ScrollView showsVerticalScrollIndicator={false} className="mt-5">
            <View className="flex-row gap-3">
              <Card value={String(won)} label="won" tone="positive" />
              <Card value={String(lost)} label="lost" tone="negative" />
              <Card value={rate === null ? '—' : `${rate}%`} label="win rate" />
            </View>

            <View className="mt-3 flex-row gap-3">
              <Card value={String(series.count)} label="bets settled" />
              <Card
                value={formatMoney(series.recent, series.currency)}
                label="last 30 days"
                tone={series.recent >= 0 ? 'positive' : 'negative'}
              />
            </View>

            {/* One row per currency, never a total. There is no exchange rate
                in this app and there must not be one: a rate would make a debt
                two friends agreed on drift between the day it was recorded and
                the day it is paid. */}
            <Text className="mb-2.5 mt-7 text-subhead font-semibold text-secondary">
              Lifetime, per currency
            </Text>
            <View className="overflow-hidden rounded-2xl border border-hairline bg-surface">
              {totals.length === 0 ? (
                <Text className="px-4 py-4 text-subhead text-secondary">
                  Nothing has settled yet.
                </Text>
              ) : (
                totals.map((row, i) => (
                  <View
                    key={row.currency}
                    className={`flex-row items-center justify-between px-4 py-3.5 ${
                      i < totals.length - 1 ? 'border-b border-hairline' : ''
                    }`}
                  >
                    <Text className="text-base text-primary">{row.currency}</Text>
                    <Text
                      className={`text-base font-bold ${
                        row.netAgorot > 0
                          ? 'text-positive'
                          : row.netAgorot < 0
                            ? 'text-negative'
                            : 'text-secondary'
                      }`}
                    >
                      {formatMoney(row.netAgorot, row.currency)}
                    </Text>
                  </View>
                ))
              )}
            </View>
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
}

function Card({
  value,
  label,
  tone,
}: {
  value: string;
  label: string;
  tone?: 'positive' | 'negative';
}) {
  const color =
    tone === 'positive' ? 'text-positive' : tone === 'negative' ? 'text-negative' : 'text-primary';

  return (
    <View className="flex-1 rounded-2xl border border-hairline bg-surface px-4 py-3.5">
      <Text numberOfLines={1} className={`text-2xl font-bold ${color}`}>
        {value}
      </Text>
      <Text className="mt-1 text-xs text-tertiary">{label}</Text>
    </View>
  );
}
