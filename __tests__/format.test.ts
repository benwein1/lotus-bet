import {
  formatAgorot,
  formatCountdown,
  initials,
  isValidEmail,
  passwordProblem,
  parseIlsToAgorot,
  positionPercentages,
} from '@/lib/format';

describe('formatAgorot', () => {
  it('drops the decimals on whole shekels', () => {
    expect(formatAgorot(10000)).toBe('₪100');
    expect(formatAgorot(0)).toBe('₪0');
  });

  it('keeps agorot when there are any', () => {
    expect(formatAgorot(3334)).toBe('₪33.34');
  });

  it('marks debts with a minus sign', () => {
    expect(formatAgorot(-5000)).toBe('−₪50');
  });

  it('can force an explicit sign', () => {
    expect(formatAgorot(5000, { sign: true })).toBe('+₪50');
    expect(formatAgorot(-5000, { sign: true })).toBe('−₪50');
  });
});

describe('parseIlsToAgorot', () => {
  it('accepts plain and decorated amounts', () => {
    expect(parseIlsToAgorot('100')).toBe(10000);
    expect(parseIlsToAgorot('₪100')).toBe(10000);
    expect(parseIlsToAgorot('12.5')).toBe(1250);
    expect(parseIlsToAgorot('1,000')).toBe(100000);
  });

  it('rejects anything that is not a positive amount', () => {
    expect(parseIlsToAgorot('')).toBeNull();
    expect(parseIlsToAgorot('0')).toBeNull();
    expect(parseIlsToAgorot('-5')).toBeNull();
    expect(parseIlsToAgorot('12.345')).toBeNull();
    expect(parseIlsToAgorot('abc')).toBeNull();
  });
});

describe('positionPercentages', () => {
  it('splits by headcount', () => {
    expect(positionPercentages(3, 2)).toEqual({ a: 60, b: 40 });
  });

  it('always totals 100 even when rounding', () => {
    const { a, b } = positionPercentages(1, 2);
    expect(a + b).toBe(100);
  });

  it('shows an untouched bet as an even split', () => {
    expect(positionPercentages(0, 0)).toEqual({ a: 50, b: 50 });
  });
});

describe('formatCountdown', () => {
  const now = new Date('2026-09-04T12:00:00Z').getTime();

  it('is null when the bet has no deadline', () => {
    expect(formatCountdown(null, now)).toBeNull();
  });

  it('counts down in the largest sensible unit', () => {
    expect(formatCountdown('2026-09-06T15:00:00Z', now)).toBe('Closes in 2d 3h');
    expect(formatCountdown('2026-09-04T14:30:00Z', now)).toBe('Closes in 2h 30m');
    expect(formatCountdown('2026-09-04T12:45:00Z', now)).toBe('Closes in 45m');
  });

  it('reports a passed deadline as closed', () => {
    expect(formatCountdown('2026-09-04T11:59:00Z', now)).toBe('Closed');
  });
});

describe('initials', () => {
  it('uses first and last name', () => {
    expect(initials('Dor Levi')).toBe('DL');
    expect(initials('Noa')).toBe('NO');
    expect(initials('  ')).toBe('?');
  });
});

describe('isValidEmail', () => {
  it('accepts ordinary addresses', () => {
    expect(isValidEmail('dor@example.com')).toBe(true);
    expect(isValidEmail('  dor.levi+bets@mail.co.il ')).toBe(true);
  });

  it('rejects anything without a domain', () => {
    expect(isValidEmail('dor@example')).toBe(false);
    expect(isValidEmail('dor')).toBe(false);
    expect(isValidEmail('dor @example.com')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });
});

describe('passwordProblem', () => {
  it('requires eight characters', () => {
    expect(passwordProblem('short')).toContain('8');
    expect(passwordProblem('longenough')).toBeNull();
  });
});
