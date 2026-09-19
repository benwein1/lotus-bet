import {
  MINIMUM_AGE,
  ageInYears,
  dateOfBirthProblem,
  daysInMonth,
  isOldEnough,
  toISODate,
  todayParts,
} from '@/lib/age';

// A fixed "today" so these never start failing on a particular calendar day,
// which is the classic way an age test rots.
const TODAY = { year: 2026, month: 9, day: 19 };

describe('ageInYears', () => {
  it('counts whole years', () => {
    expect(ageInYears({ year: 2000, month: 9, day: 19 }, TODAY)).toBe(26);
  });

  it('counts a birthday as reached on the day itself', () => {
    expect(ageInYears({ year: 2010, month: 9, day: 19 }, TODAY)).toBe(16);
  });

  it('does not count it the day before', () => {
    expect(ageInYears({ year: 2010, month: 9, day: 20 }, TODAY)).toBe(15);
  });

  it('handles a birthday later in the same month', () => {
    expect(ageInYears({ year: 2010, month: 9, day: 30 }, TODAY)).toBe(15);
  });

  it('handles a birthday in a later month', () => {
    expect(ageInYears({ year: 2010, month: 12, day: 1 }, TODAY)).toBe(15);
  });

  it('handles a birthday in an earlier month', () => {
    expect(ageInYears({ year: 2010, month: 1, day: 1 }, TODAY)).toBe(16);
  });

  it('is negative for a future date', () => {
    expect(ageInYears({ year: 2027, month: 1, day: 1 }, TODAY)).toBeLessThan(0);
  });
});

describe('daysInMonth', () => {
  it('knows the short months', () => {
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 6)).toBe(30);
    expect(daysInMonth(2026, 9)).toBe(30);
    expect(daysInMonth(2026, 11)).toBe(30);
  });

  it('knows the long months', () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it('applies the full Gregorian leap rule, not divisible-by-four', () => {
    expect(daysInMonth(2024, 2)).toBe(29); // divisible by 4
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(1900, 2)).toBe(28); // century, not divisible by 400
    expect(daysInMonth(2000, 2)).toBe(29); // divisible by 400
  });
});

describe('dateOfBirthProblem', () => {
  it('accepts somebody comfortably old enough', () => {
    expect(dateOfBirthProblem({ year: 1995, month: 6, day: 12 }, TODAY)).toBeNull();
  });

  it('accepts somebody who turns 16 today', () => {
    expect(dateOfBirthProblem({ year: 2010, month: 9, day: 19 }, TODAY)).toBeNull();
  });

  it('rejects somebody who turns 16 tomorrow', () => {
    expect(dateOfBirthProblem({ year: 2010, month: 9, day: 20 }, TODAY)).toMatch(/16 or older/);
  });

  it('asks for the date when it is incomplete', () => {
    expect(dateOfBirthProblem({ year: 2000, month: 1 }, TODAY)).toMatch(/Enter your date of birth/);
    expect(dateOfBirthProblem({}, TODAY)).toMatch(/Enter your date of birth/);
  });

  it('rejects an impossible month', () => {
    expect(dateOfBirthProblem({ year: 2000, month: 13, day: 1 }, TODAY)).toMatch(/month/);
    expect(dateOfBirthProblem({ year: 2000, month: 0, day: 1 }, TODAY)).toMatch(/month/);
  });

  it('rejects a day that does not exist in that month', () => {
    expect(dateOfBirthProblem({ year: 2001, month: 2, day: 29 }, TODAY)).toMatch(/day/);
    expect(dateOfBirthProblem({ year: 2000, month: 4, day: 31 }, TODAY)).toMatch(/day/);
  });

  it('accepts 29 February in a leap year', () => {
    expect(dateOfBirthProblem({ year: 2000, month: 2, day: 29 }, TODAY)).toBeNull();
  });

  it('reports an impossible date as impossible rather than as too young', () => {
    // A mistyped year that is also in the future: the date is the real problem.
    const problem = dateOfBirthProblem({ year: 2030, month: 1, day: 1 }, TODAY);
    expect(problem).toMatch(/year/);
    expect(problem).not.toMatch(/16 or older/);
  });

  it('rejects a typo in the distant past', () => {
    expect(dateOfBirthProblem({ year: 1799, month: 1, day: 1 }, TODAY)).toMatch(/year/);
  });

  it('rejects non-integers', () => {
    expect(dateOfBirthProblem({ year: 2000, month: 1, day: 1.5 }, TODAY)).toMatch(/numbers only/);
  });
});

describe('isOldEnough', () => {
  it('agrees with dateOfBirthProblem', () => {
    expect(isOldEnough({ year: 1990, month: 1, day: 1 }, TODAY)).toBe(true);
    expect(isOldEnough({ year: 2015, month: 1, day: 1 }, TODAY)).toBe(false);
  });

  it('holds across the whole boundary year', () => {
    // Every day of the year somebody born in 2010 turns 16 on: before their
    // birthday they are out, on and after it they are in. This is the property
    // the sign-up gate rests on, so it is checked exhaustively rather than at
    // two sample points.
    for (let month = 1; month <= 12; month += 1) {
      for (let day = 1; day <= daysInMonth(2010, month); day += 1) {
        const birthdayPassed =
          month < TODAY.month || (month === TODAY.month && day <= TODAY.day);
        expect(isOldEnough({ year: 2010, month, day }, TODAY)).toBe(birthdayPassed);
      }
    }
  });
});

describe('toISODate', () => {
  it('zero-pads to the shape Postgres takes for a date', () => {
    expect(toISODate({ year: 2010, month: 3, day: 7 })).toBe('2010-03-07');
    expect(toISODate({ year: 1999, month: 12, day: 31 })).toBe('1999-12-31');
  });

  it('does not shift the day across a timezone, the way toISOString would', () => {
    // The bug this module exists to avoid: parsing as UTC and reading back
    // locally moves the date west of Greenwich.
    expect(toISODate({ year: 2010, month: 1, day: 1 })).toBe('2010-01-01');
  });
});

describe('todayParts', () => {
  it('reads local calendar parts, not UTC ones', () => {
    const now = new Date(2026, 8, 19, 1, 30); // 19 Sep 2026, 01:30 local
    expect(todayParts(now)).toEqual({ year: 2026, month: 9, day: 19 });
  });
});

describe('MINIMUM_AGE', () => {
  it('is 16, which the legal text and the SQL both restate', () => {
    expect(MINIMUM_AGE).toBe(16);
  });
});
