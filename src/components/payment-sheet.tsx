import { useEffect, useState } from 'react';
import { Modal, Text, TextInput, View } from 'react-native';

import { Button, Money, PressableScale } from '@/components/ui';
import { formatAgorot, parseIlsToAgorot } from '@/lib/format';
import { useColors } from '@/providers/theme-provider';
import { elevation } from '@/theme';

export interface PendingPayment {
  fromUserId: string;
  toUserId: string;
  /** What the settle-up suggestion says is outstanding between these two. */
  amountAgorot: number;
  fromName: string;
  toName: string;
  iPay: boolean;
}

/**
 * Recording a payment that already happened, in whatever amount it happened.
 *
 * "Paid" used to mean "paid all of it", which is wrong about how people
 * actually settle up — you hand over what you have on you and square the rest
 * later. So the amount is editable, pre-filled with the full figure, and
 * anything less leaves the remainder outstanding.
 *
 * It is capped at the suggested amount. Paying more than you owe would flip
 * the balance and quietly make the *other* person the debtor, which is never
 * what somebody means when they type a number into this box; if they really do
 * overpay, the difference is a new debt going the other way and should be
 * recorded as one.
 *
 * Nothing here moves money. It writes down that money moved somewhere else.
 */
export function PaymentSheet({
  payment,
  saving,
  onCancel,
  onConfirm,
}: {
  payment: PendingPayment | null;
  saving: boolean;
  onCancel: () => void;
  onConfirm: (amountAgorot: number) => void;
}) {
  const colors = useColors();
  const [draft, setDraft] = useState('');

  // Re-prime whenever a different payment opens the sheet.
  useEffect(() => {
    if (payment) setDraft(shekelsFor(payment.amountAgorot));
  }, [payment]);

  if (!payment) {
    return <Modal visible={false} transparent onRequestClose={onCancel} />;
  }

  const parsed = parseIlsToAgorot(draft);
  const amount = parsed ?? 0;
  const tooMuch = amount > payment.amountAgorot;
  const valid = parsed !== null && amount > 0 && !tooMuch;
  const remainder = payment.amountAgorot - amount;

  const payer = payment.iPay ? 'You' : payment.fromName;
  const payee = payment.iPay ? payment.toName : 'you';

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      accessibilityViewIsModal
    >
      {/* Inert scrim, same as the confirm dialog: dismissal goes through the
          Cancel button so no absolutely positioned overlay can swallow presses
          meant for the card. */}
      <View className="flex-1 items-center justify-center bg-scrim px-8">
        <View
          style={elevation.sheet}
          className="w-full max-w-[340px] overflow-hidden rounded-3xl border border-hairline-strong bg-surface p-6"
        >
          <Text className="text-lg font-bold text-primary">How much was paid?</Text>
          <Text className="mt-2 text-subhead leading-5 text-secondary">
            {payer} owe{payment.iPay ? '' : 's'} {payee}{' '}
            {formatAgorot(payment.amountAgorot)}. Record whatever actually changed hands.
          </Text>

          <View className="mt-5 flex-row items-center gap-2 rounded-2xl border border-hairline bg-surface2 px-4">
            <Text className="text-2xl font-bold text-secondary">₪</Text>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              keyboardType="decimal-pad"
              selectTextOnFocus
              autoFocus
              editable={!saving}
              accessibilityLabel="Amount paid, in shekels"
              placeholder="0"
              placeholderTextColor={colors.textTertiary}
              className="flex-1 py-3 text-2xl font-bold text-primary"
              // `minWidth: 0` is load-bearing, not tidying. `flex-1` sets a
              // zero basis but leaves `min-width: auto`, so on the web the
              // input keeps its intrinsic width and the row cannot shrink —
              // this card measured 326px wide around 448px of content, and
              // `autoFocus` then scrolled it 73px sideways, cutting the title
              // in half. The overflow was invisible because the card clips.
              style={{ color: colors.text, minWidth: 0 }}
            />
            {amount !== payment.amountAgorot && (
              <PressableScale
                onPress={() => setDraft(shekelsFor(payment.amountAgorot))}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Fill in the full amount"
                className="rounded-full bg-accent-soft px-3 py-1.5"
              >
                <Text className="text-sm font-semibold text-accent">All of it</Text>
              </PressableScale>
            )}
          </View>

          {tooMuch ? (
            <Text className="mt-2.5 px-1 text-sm text-negative">
              That is more than is outstanding. The most you can record here is{' '}
              {formatAgorot(payment.amountAgorot)}.
            </Text>
          ) : valid && remainder > 0 ? (
            <View className="mt-2.5 flex-row items-center gap-1.5 px-1">
              <Text className="text-sm text-secondary">Still outstanding after this:</Text>
              <Money agorot={remainder} size="sm" tone="neutral" />
            </View>
          ) : (
            <Text className="mt-2.5 px-1 text-sm text-tertiary">
              Settles this up completely.
            </Text>
          )}

          <View className="mt-6 gap-3">
            <Button
              title={saving ? 'Saving' : 'Record it'}
              variant="primary"
              size="lg"
              loading={saving}
              disabled={!valid || saving}
              onPress={() => onConfirm(amount)}
            />
            <Button
              title="Cancel"
              variant="plain"
              size="lg"
              disabled={saving}
              onPress={onCancel}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/**
 * Agorot to an editable shekel string. Whole amounts lose the `.00` — most
 * settle-ups are round numbers and `40` is easier to edit than `40.00`.
 */
function shekelsFor(agorot: number): string {
  return agorot % 100 === 0 ? String(agorot / 100) : (agorot / 100).toFixed(2);
}
