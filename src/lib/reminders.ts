/**
 * "This closes soon and you haven't answered it."
 *
 * Deadline reminders are **local**, not push. The other three notifications
 * are things that happen on the server to other people's data, so the server
 * has to send them; this one is a deadline the phone already knows about, for
 * a bet the phone already has, aimed at the person holding it. Making it local
 * means it needs no cron job, no push credentials and no delivery guesswork,
 * it fires with the app closed, and — unlike remote push — it works in Expo Go.
 *
 * The whole schedule is rebuilt rather than diffed: cancel everything this
 * module owns, then schedule what is currently true. A bet you have since
 * answered, or that was locked, cancelled or resolved, simply doesn't come
 * back. Diffing would be cheaper and would eventually leave a reminder for a
 * bet that no longer exists.
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { isDemoMode } from './demo';
import type { BetWithPositions } from './database.types';
import { dueReminders, reminderBody, type ReminderBet } from './reminder-rules';

export { dueReminders, reminderBody, REMINDER_LEAD_MS } from './reminder-rules';
export type { ReminderBet } from './reminder-rules';

/**
 * Marks the notifications this module owns, so cancelling ours never touches
 * a notification scheduled by anything else.
 */
const OWNED = 'bet-deadline';

/** Convert a bet row into the shape `dueReminders` wants. */
export function toReminderBet(bet: BetWithPositions, userId: string | null): ReminderBet {
  const positions = bet.positions ?? [];
  return {
    id: bet.id,
    title: bet.title,
    closeAt: bet.close_at,
    answered: userId !== null && positions.some((p) => p.user_id === userId),
    open: bet.status === 'open',
  };
}

/**
 * Rebuild the scheduled reminders to match `bets`.
 *
 * Silent about everything: no permission, no device, demo mode, a platform
 * without local notifications — all no-ops. A missed reminder is a small loss;
 * an error thrown into a feed refresh is a bigger one.
 */
export async function syncDeadlineReminders(
  bets: ReminderBet[],
  enabled: boolean
): Promise<number> {
  if (Platform.OS === 'web' || isDemoMode()) return 0;

  try {
    await cancelDeadlineReminders();
    if (!enabled) return 0;

    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return 0;

    const due = dueReminders(bets);
    for (const { bet, fireAt } of due) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: bet.title,
          body: reminderBody(bet.closeAt as string, fireAt),
          data: { type: OWNED, betId: bet.id },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(fireAt),
        },
      });
    }
    return due.length;
  } catch (err) {
    console.warn('Could not schedule deadline reminders', err);
    return 0;
  }
}

/** Drop every reminder this module scheduled, leaving anything else alone. */
export async function cancelDeadlineReminders(): Promise<void> {
  if (Platform.OS === 'web' || isDemoMode()) return;
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((n) => (n.content.data as { type?: string } | null)?.type === OWNED)
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))
    );
  } catch (err) {
    console.warn('Could not clear deadline reminders', err);
  }
}
