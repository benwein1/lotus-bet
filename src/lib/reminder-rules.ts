/**
 * Which bets deserve a deadline reminder, and what the reminder says.
 *
 * Dependency-free on purpose. `reminders.ts` needs `expo-notifications` and
 * `react-native`, neither of which loads under jest, and this is the half with
 * the rules in it — so it lives on its own where it can actually be tested.
 * Same reason `odds.ts` and `postgrest.ts` are separate from their callers.
 */

/** How long before `close_at` the reminder fires. */
export const REMINDER_LEAD_MS = 60 * 60 * 1000;

/** Below this there is no useful gap between "reminded" and "closed". */
export const MIN_NOTICE_MS = 2 * 60 * 1000;

/**
 * iOS caps an app at 64 pending local notifications and silently drops the
 * rest, so the nearest deadlines win. Anything past this is far enough out
 * that the next launch will schedule it anyway.
 */
export const MAX_SCHEDULED = 40;

export interface ReminderBet {
  id: string;
  title: string;
  closeAt: string | null;
  /** Answered bets are not reminders; you already did the thing. */
  answered: boolean;
  open: boolean;
}

/** Reduce a feed of bets to the ones worth a reminder, soonest first. */
export function dueReminders(
  bets: ReminderBet[],
  now: number = Date.now(),
  leadMs: number = REMINDER_LEAD_MS
): { bet: ReminderBet; fireAt: number }[] {
  return bets
    .filter((bet) => bet.open && !bet.answered && bet.closeAt !== null)
    .map((bet) => ({ bet, closeAt: Date.parse(bet.closeAt as string) }))
    .filter(({ closeAt }) => Number.isFinite(closeAt) && closeAt > now)
    .map(({ bet, closeAt }) => ({
      bet,
      // A bet posted with less than an hour on the clock still gets a nudge,
      // just a later one: firing in the past would mean no reminder at all.
      fireAt: Math.max(closeAt - leadMs, now + MIN_NOTICE_MS),
      closeAt,
    }))
    // Nothing left to warn about: the reminder would land after the close.
    .filter(({ fireAt, closeAt }) => fireAt < closeAt)
    .sort((a, b) => a.fireAt - b.fireAt)
    .slice(0, MAX_SCHEDULED)
    .map(({ bet, fireAt }) => ({ bet, fireAt }));
}

/** The sentence a reminder says. */
export function reminderBody(closeAt: string, fireAt: number): string {
  const minutes = Math.round((Date.parse(closeAt) - fireAt) / 60000);
  if (minutes >= 90) return `Closes in about ${Math.round(minutes / 60)} hours. Pick a side.`;
  if (minutes >= 45) return 'Closes in about an hour. Pick a side.';
  if (minutes > 1) return `Closes in ${minutes} minutes. Pick a side.`;
  return 'Closing now. Pick a side.';
}
