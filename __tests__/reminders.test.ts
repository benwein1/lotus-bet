import {
  MAX_SCHEDULED,
  REMINDER_LEAD_MS,
  dueReminders,
  reminderBody,
  type ReminderBet,
} from '../src/lib/reminder-rules';

const NOW = Date.parse('2026-09-09T12:00:00Z');
const HOUR = 60 * 60 * 1000;

function bet(overrides: Partial<ReminderBet> = {}): ReminderBet {
  return {
    id: 'bet-1',
    title: 'Will it rain?',
    closeAt: new Date(NOW + 6 * HOUR).toISOString(),
    answered: false,
    open: true,
    ...overrides,
  };
}

describe('dueReminders', () => {
  it('schedules one lead time before a bet closes', () => {
    const due = dueReminders([bet()], NOW);
    expect(due).toHaveLength(1);
    expect(due[0]!.fireAt).toBe(NOW + 6 * HOUR - REMINDER_LEAD_MS);
  });

  it('skips a bet you have already answered', () => {
    expect(dueReminders([bet({ answered: true })], NOW)).toEqual([]);
  });

  it('skips a bet that is not open', () => {
    expect(dueReminders([bet({ open: false })], NOW)).toEqual([]);
  });

  it('skips a bet with no deadline', () => {
    expect(dueReminders([bet({ closeAt: null })], NOW)).toEqual([]);
  });

  it('skips a deadline that has already passed', () => {
    expect(dueReminders([bet({ closeAt: new Date(NOW - HOUR).toISOString() })], NOW)).toEqual([]);
  });

  it('ignores an unparseable deadline rather than scheduling at NaN', () => {
    expect(dueReminders([bet({ closeAt: 'not a date' })], NOW)).toEqual([]);
  });

  it('still nudges a bet closing sooner than the lead time', () => {
    // Posted with 30 minutes on the clock: an hour before is in the past, so
    // the reminder moves up rather than being dropped.
    const closeAt = new Date(NOW + 30 * 60 * 1000).toISOString();
    const due = dueReminders([bet({ closeAt })], NOW);
    expect(due).toHaveLength(1);
    expect(due[0]!.fireAt).toBeGreaterThan(NOW);
    expect(due[0]!.fireAt).toBeLessThan(Date.parse(closeAt));
  });

  it('drops a bet closing so soon there is no notice to give', () => {
    const closeAt = new Date(NOW + 60 * 1000).toISOString();
    expect(dueReminders([bet({ closeAt })], NOW)).toEqual([]);
  });

  it('puts the soonest deadline first', () => {
    const far = bet({ id: 'far', closeAt: new Date(NOW + 20 * HOUR).toISOString() });
    const near = bet({ id: 'near', closeAt: new Date(NOW + 3 * HOUR).toISOString() });
    expect(dueReminders([far, near], NOW).map((d) => d.bet.id)).toEqual(['near', 'far']);
  });

  it('caps the schedule, keeping the nearest deadlines', () => {
    const many = Array.from({ length: MAX_SCHEDULED + 12 }, (_, i) =>
      bet({ id: `bet-${i}`, closeAt: new Date(NOW + (i + 2) * HOUR).toISOString() })
    );
    const due = dueReminders(many, NOW);
    expect(due).toHaveLength(MAX_SCHEDULED);
    expect(due[0]!.bet.id).toBe('bet-0');
    expect(due.at(-1)!.bet.id).toBe(`bet-${MAX_SCHEDULED - 1}`);
  });
});

describe('reminderBody', () => {
  const closeAt = new Date(NOW + 6 * HOUR).toISOString();

  it('says "about an hour" at the standard lead time', () => {
    expect(reminderBody(closeAt, Date.parse(closeAt) - HOUR)).toBe(
      'Closes in about an hour. Pick a side.'
    );
  });

  it('counts hours when the reminder lands further out', () => {
    expect(reminderBody(closeAt, Date.parse(closeAt) - 3 * HOUR)).toBe(
      'Closes in about 3 hours. Pick a side.'
    );
  });

  it('counts minutes for a short-notice bet', () => {
    expect(reminderBody(closeAt, Date.parse(closeAt) - 20 * 60 * 1000)).toBe(
      'Closes in 20 minutes. Pick a side.'
    );
  });

  it('never claims time that is not there', () => {
    expect(reminderBody(closeAt, Date.parse(closeAt))).toBe('Closing now. Pick a side.');
  });
});
