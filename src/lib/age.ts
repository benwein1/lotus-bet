/**
 * The minimum-age rule, as arithmetic.
 *
 * Betta is a 16+ app. That is a product requirement rather than a line of
 * small print, so the rule lives here — pure, dependency-free and tested —
 * and is applied in three places that must agree: the sign-up form, the
 * one-time check for an account whose age was never recorded, and
 * `meets_minimum_age()` in SQL, which is the copy that actually enforces it.
 *
 * **No `Date` anywhere in the comparison.** A date of birth is a calendar
 * fact, not an instant: `new Date('2010-03-01')` is parsed as UTC midnight and
 * then read back in the device's zone, so west of Greenwich it becomes the
 * 28th of February and somebody turns 16 a day late. Integer year/month/day
 * arithmetic has no zone to get wrong, which is why `ageInYears` takes parts
 * rather than dates.
 */

/** The floor, in whole years. Referenced by name everywhere rather than typed as 16. */
export const MINIMUM_AGE = 16;

/** The earliest year the form will accept. Below this it is a typo, not a birthday. */
const EARLIEST_YEAR = 1900;

export interface DateParts {
  year: number;
  month: number;
  day: number;
}

/**
 * Whole years elapsed between two calendar dates.
 *
 * Counts a birthday as reached *on* the day, which is the convention every
 * age check uses and the one a user expects on the morning of their birthday.
 */
export function ageInYears(birth: DateParts, today: DateParts): number {
  let age = today.year - birth.year;
  const beforeBirthday =
    today.month < birth.month || (today.month === birth.month && today.day < birth.day);
  if (beforeBirthday) age -= 1;
  return age;
}

/** Days in a month, with the Gregorian leap rule rather than the divisible-by-4 shortcut. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Today, as calendar parts in the device's own zone — which is the zone the user is in. */
export function todayParts(now: Date = new Date()): DateParts {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

/**
 * What is wrong with a date of birth, or null when nothing is.
 *
 * One function returning one sentence, because the form shows one line. The
 * order matters: an impossible date is reported as impossible rather than as
 * "too young", which would be both wrong and confusing on a mistyped year.
 */
export function dateOfBirthProblem(
  parts: Partial<DateParts>,
  today: DateParts = todayParts()
): string | null {
  const { day, month, year } = parts;

  // Absence, not falsiness. A typed `0` is a real answer to "which month?" and
  // a wrong one, so it has to reach the range check below rather than be
  // reported as an empty field — which is what `!month` did. Written out rather
  // than through a helper so TypeScript narrows the three to `number` here.
  if (day === undefined || month === undefined || year === undefined) {
    return 'Enter your date of birth.';
  }
  if (Number.isNaN(day) || Number.isNaN(month) || Number.isNaN(year)) {
    return 'Enter your date of birth.';
  }
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) {
    return 'Use numbers only.';
  }
  if (month < 1 || month > 12) return 'That month does not exist.';
  if (year < EARLIEST_YEAR || year > today.year) return 'Check the year.';
  if (day < 1 || day > daysInMonth(year, month)) return 'That day does not exist in that month.';

  const age = ageInYears({ year, month, day }, today);
  if (age < 0) return 'That date is in the future.';
  if (age < MINIMUM_AGE) return `You need to be ${MINIMUM_AGE} or older to use Betta.`;

  return null;
}

/** True when the parts are a real date and old enough. The form's gate. */
export function isOldEnough(parts: Partial<DateParts>, today: DateParts = todayParts()): boolean {
  return dateOfBirthProblem(parts, today) === null;
}

/**
 * `YYYY-MM-DD`, which is what Postgres takes for a `date` and what the
 * signup metadata carries.
 *
 * Zero-padded by hand rather than via `toISOString`, which would reintroduce
 * exactly the timezone shift this module exists to avoid.
 */
export function toISODate({ year, month, day }: DateParts): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}
