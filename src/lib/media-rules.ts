/**
 * The pure half of `media.ts`.
 *
 * `media.ts` imports expo-file-system and expo-image-picker, so nothing in it
 * can be unit-tested without a simulator. This is the part worth asserting, so
 * it lives where a test can reach it — the same split as
 * `reminders.ts` / `reminder-rules.ts`, for the same reason.
 */
import type { BetMediaPurpose } from './database.types';

/**
 * Split a bet's media into its illustration and its receipts.
 *
 * Rows written before `purpose` existed have no value for it, and they are all
 * attachments — the creator posting a bet was the only way a row could be
 * made. So the fallback is not a guess, it is the only thing those rows can be.
 */
export function splitMedia<T extends { purpose?: BetMediaPurpose }>(
  media: T[]
): { attachments: T[]; proof: T[] } {
  const attachments: T[] = [];
  const proof: T[] = [];
  for (const item of media) {
    if (item.purpose === 'proof') proof.push(item);
    else attachments.push(item);
  }
  return { attachments, proof };
}
