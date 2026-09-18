import { useState } from 'react';
import { Modal, Text, View } from 'react-native';

import { AlertIcon, CloseIcon } from '@/components/icons';
import { Button, PressableScale, tap, useConfirm } from '@/components/ui';
import type { ReportReason, ReportTargetKind } from '@/lib/database.types';
import { blockUser, reportContent } from '@/lib/queries';
import { useColors } from '@/providers/theme-provider';
import { elevation } from '@/theme';

/**
 * The thing being reported, and who wrote it.
 *
 * `authorId` is carried separately from `targetId` because reporting and
 * blocking are two different actions on the same sheet: you report a comment,
 * but you block the person who wrote it.
 */
export interface ReportTarget {
  kind: ReportTargetKind;
  id: string;
  authorId: string;
  authorName: string;
  /** What the sheet calls it — "this comment", "this bet". */
  noun: string;
}

/**
 * A short fixed list, in the order people actually pick from.
 *
 * Deliberately no free-text box. A text field on a report form is a message
 * aimed at whoever reads the queue, written by somebody already angry — it is
 * an abuse vector wearing the costume of a feature. These six map exactly to
 * the check constraint on `reports.reason`.
 */
const REASONS: { value: ReportReason; label: string; hint: string }[] = [
  { value: 'harassment', label: 'Harassment or bullying', hint: 'Aimed at someone, repeatedly or cruelly' },
  { value: 'hate', label: 'Hate speech', hint: 'Attacks a group of people' },
  { value: 'sexual', label: 'Sexual content', hint: 'Nudity or sexual material' },
  { value: 'violence', label: 'Violence or threats', hint: 'Threatens harm to someone' },
  { value: 'spam', label: 'Spam', hint: 'Advertising, scams or repetition' },
  { value: 'other', label: 'Something else', hint: 'Breaks the rules another way' },
];

/**
 * Reporting and blocking, in one sheet.
 *
 * They belong together because they are the two halves of one intention —
 * "this should not be here" and "I do not want to hear from this person" —
 * and somebody reaching for either usually wants both. Separating them into
 * two menus means the angrier half of that pair is the one people never find.
 *
 * What the sheet promises is what actually happens. Reporting sends the
 * complaint to a queue a person reads; it does not remove anything on the spot,
 * and saying otherwise would be a lie the next screen refuses.
 */
export function ReportSheet({
  target,
  onClose,
  onBlocked,
}: {
  target: ReportTarget | null;
  onClose: () => void;
  /** Fired after a successful block, so the caller can refresh. */
  onBlocked?: () => void;
}) {
  return (
    <Modal
      visible={target !== null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      {target !== null && (
        <SheetBody key={target.id} target={target} onClose={onClose} onBlocked={onBlocked} />
      )}
    </Modal>
  );
}

function SheetBody({
  target,
  onClose,
  onBlocked,
}: {
  target: ReportTarget;
  onClose: () => void;
  onBlocked?: () => void;
}) {
  const colors = useColors();
  const { ask, dialog } = useConfirm();

  const [reason, setReason] = useState<ReportReason | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function send() {
    if (!reason || busy) return;
    setBusy(true);
    setError(null);
    try {
      await reportContent(target.kind, target.id, reason);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that.');
    } finally {
      setBusy(false);
    }
  }

  function confirmBlock() {
    ask({
      title: `Block ${target.authorName}?`,
      message:
        'You stop seeing their comments and they stop seeing yours. You both stay in the group, and any money between you is unaffected.',
      confirmLabel: 'Block',
      destructive: true,
      onConfirm: () => {
        void (async () => {
          setBusy(true);
          setError(null);
          try {
            await blockUser(target.authorId);
            onBlocked?.();
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not block them.');
          } finally {
            setBusy(false);
          }
        })();
      },
    });
  }

  return (
    <View className="flex-1 items-center justify-center bg-scrim px-6">
      <View
        style={elevation.sheet}
        className="w-full max-w-[380px] overflow-hidden rounded-3xl border border-hairline-strong bg-surface"
      >
        <View className="flex-row items-start gap-3 px-6 pb-4 pt-6">
          <View className="mt-0.5 h-9 w-9 items-center justify-center rounded-full bg-negative-soft">
            <AlertIcon size={19} color={colors.negative} />
          </View>
          <View className="flex-1">
            <Text className="text-lg font-bold text-primary">
              {sent ? 'Thanks — that is with us' : `Report ${target.noun}`}
            </Text>
            <Text className="mt-1 text-sm leading-[18px] text-secondary">
              {sent
                ? 'Someone reads every report. We will not tell them who sent it.'
                : 'Tell us what is wrong with it. Nobody is told you reported it.'}
            </Text>
          </View>
          <PressableScale
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close"
            className="h-8 w-8 items-center justify-center rounded-full bg-surface3"
          >
            <CloseIcon size={15} color={colors.textSecondary} />
          </PressableScale>
        </View>

        {error && (
          <Text className="px-6 pb-3 text-sm text-negative">{error}</Text>
        )}

        {!sent && (
          <View className="border-t border-hairline">
            {REASONS.map((r, i) => (
              <PressableScale
                key={r.value}
                scaleTo={0.995}
                onPress={() => {
                  tap();
                  setReason(r.value);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: reason === r.value }}
                accessibilityLabel={`${r.label}. ${r.hint}`}
                className={`flex-row items-center gap-3 px-6 py-3.5 ${
                  i > 0 ? 'border-t border-hairline' : ''
                } ${reason === r.value ? 'bg-accent-soft' : ''}`}
              >
                <View
                  className={`h-[18px] w-[18px] rounded-full border-2 ${
                    reason === r.value ? 'border-accent bg-accent' : 'border-hairline-strong'
                  }`}
                />
                <View className="flex-1">
                  <Text
                    className={`text-subhead font-semibold ${
                      reason === r.value ? 'text-accent' : 'text-primary'
                    }`}
                  >
                    {r.label}
                  </Text>
                  <Text className="mt-0.5 text-2xs text-tertiary">{r.hint}</Text>
                </View>
              </PressableScale>
            ))}
          </View>
        )}

        <View className="gap-3 border-t border-hairline px-6 py-5">
          {!sent && (
            <Button
              title={busy ? 'Sending' : 'Send report'}
              variant="primary"
              size="lg"
              loading={busy}
              disabled={!reason || busy}
              onPress={() => void send()}
            />
          )}

          {/* Offered whether or not a report was sent: the two are separate
              decisions, and somebody who just reported a comment very often
              wants the second one too. */}
          <Button
            title={`Block ${target.authorName}`}
            variant="destructive"
            size="lg"
            disabled={busy}
            onPress={confirmBlock}
          />
          <Button title={sent ? 'Done' : 'Cancel'} variant="plain" size="lg" onPress={onClose} />
        </View>
      </View>

      {dialog}
    </View>
  );
}
