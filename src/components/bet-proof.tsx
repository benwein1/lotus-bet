import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn } from '@/components/animated';

import { BetMediaView } from '@/components/bet-media';
import { CameraIcon, CloseIcon, PhotoIcon } from '@/components/icons';
import {
  Avatar,
  Button,
  ErrorNotice,
  PressableScale,
  SectionTitle,
  useConfirm,
} from '@/components/ui';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import type { BetMedia, BetRow, UserRow } from '@/lib/database.types';
import {
  captureProofMedia,
  MAX_PROOF,
  pickProofMedia,
  type PickedMedia,
} from '@/lib/media';
import { addBetProof, deleteBetMedia } from '@/lib/queries';
import { useColors } from '@/providers/theme-provider';

/**
 * Proof of outcome — the photo that actually ends the argument.
 *
 * A bet's own attachment is the creator's illustration, posted before anyone
 * knows the answer. This is the receipt, and it belongs to whoever was in the
 * bet rather than to whoever started it: the person holding the evidence is
 * usually the one who won, not the one who asked the question.
 *
 * It only exists on a resolved bet. Before that there is nothing to prove, and
 * a "add proof" button on an open bet would be an invitation to argue about the
 * result in a place the result is not yet recorded.
 */
export function BetProof({
  bet,
  proof,
  currentUserId,
  canAdd,
  usersById,
  onChanged,
}: {
  bet: BetRow;
  proof: BetMedia[];
  currentUserId: string;
  /** Creator or somebody who took a side — the same rule the RLS policy uses. */
  canAdd: boolean;
  usersById: Map<string, Pick<UserRow, 'display_name' | 'avatar_url'>>;
  onChanged: () => void | Promise<void>;
}) {
  const colors = useColors();
  const reduced = useReducedMotion();
  const { ask, dialog } = useConfirm();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remaining = MAX_PROOF - proof.length;
  const full = remaining <= 0;

  async function add(pick: () => Promise<PickedMedia[]>) {
    if (busy || full) return;
    setError(null);
    try {
      const picked = await pick();
      if (picked.length === 0) return;

      setBusy(true);
      // `proof.length` is the position to continue from — appending rather than
      // renumbering keeps everybody else's photos where they were.
      await addBetProof(bet, picked, currentUserId, proof.length);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that.');
    } finally {
      setBusy(false);
    }
  }

  function confirmRemove(item: BetMedia) {
    ask({
      title: 'Remove this?',
      message: 'It disappears for everyone who can see the bet.',
      confirmLabel: 'Remove',
      destructive: true,
      onConfirm: () => {
        void (async () => {
          try {
            await deleteBetMedia(item.id);
            await onChanged();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not remove that.');
          }
        })();
      },
    });
  }

  // Nothing to show and nothing you may add: the section is absent rather than
  // rendered empty. A spectator does not need to be told there is a thing they
  // cannot do.
  if (proof.length === 0 && !canAdd) return null;

  return (
    <View className="mt-7">
      <SectionTitle>
        {proof.length === 0
          ? 'Proof of outcome'
          : proof.length === 1
            ? '1 piece of proof'
            : `${proof.length} pieces of proof`}
      </SectionTitle>

      {error && <ErrorNotice message={error} />}

      {proof.length === 0 ? (
        <View className="items-center gap-2 rounded-3xl border border-hairline bg-surface px-6 py-8">
          <PhotoIcon size={22} color={colors.textTertiary} />
          <Text className="text-center text-sm leading-5 text-secondary">
            Settle it for good. Add the photo or clip that shows how it went.
          </Text>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-3 pr-gutter"
        >
          {proof.map((item, index) => {
            const author = usersById.get(item.uploaded_by);
            return (
              <Animated.View
                key={item.id}
                entering={reduced ? undefined : FadeIn.delay(Math.min(index, 5) * 40)}
              >
                <View className="w-56">
                  <View className="overflow-hidden rounded-3xl border border-hairline">
                    <BetMediaView media={[item]} active={false} className="h-56 w-full" />
                  </View>

                  <View className="mt-2 flex-row items-center gap-2 px-1">
                    <Avatar
                      id={item.uploaded_by}
                      name={author?.display_name ?? 'Someone'}
                      uri={author?.avatar_url ?? null}
                      size={20}
                    />
                    <Text numberOfLines={1} className="flex-1 text-sm text-secondary">
                      {item.uploaded_by === currentUserId
                        ? 'You'
                        : (author?.display_name ?? 'Someone')}
                    </Text>
                    {item.uploaded_by === currentUserId && (
                      <PressableScale
                        onPress={() => confirmRemove(item)}
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel="Remove your proof"
                        className="h-6 w-6 items-center justify-center rounded-full bg-surface3"
                      >
                        <CloseIcon size={12} color={colors.textSecondary} />
                      </PressableScale>
                    )}
                  </View>
                </View>
              </Animated.View>
            );
          })}
        </ScrollView>
      )}

      {canAdd && (
        <View className="mt-3 flex-row gap-2.5">
          <View className="flex-1">
            <Button
              title={busy ? 'Uploading' : 'Add from library'}
              variant="tinted"
              size="md"
              loading={busy}
              disabled={busy || full}
              icon={<PhotoIcon size={17} color={colors.accent} />}
              onPress={() => void add(() => pickProofMedia(remaining))}
            />
          </View>
          <Button
            title="Camera"
            variant="secondary"
            size="md"
            disabled={busy || full}
            icon={<CameraIcon size={17} color={colors.text} />}
            onPress={() =>
              void add(async () => {
                const one = await captureProofMedia();
                return one ? [one] : [];
              })
            }
          />
        </View>
      )}

      {full && (
        <Text className="mt-2 px-1 text-sm text-tertiary">
          That&apos;s {MAX_PROOF} — enough to settle anything.
        </Text>
      )}

      {dialog}
    </View>
  );
}
