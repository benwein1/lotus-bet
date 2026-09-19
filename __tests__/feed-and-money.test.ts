import { feedBand, orderFeed } from '@/lib/feed-order';
import {
  CURRENCIES,
  DEFAULT_CURRENCY,
  asCurrency,
  currencySymbol,
  formatMoney,
  parseMoneyToMinor,
} from '@/lib/currency';
import { COVER_COUNT, coverIndex } from '@/lib/bet-cover';

const NOW = Date.parse('2026-09-19T12:00:00Z');
const bet = (over: Partial<Parameters<typeof feedBand>[0]> = {}) => ({
  status: 'open',
  close_at: null,
  created_at: '2026-09-19T10:00:00Z',
  ...over,
});

describe('feedBand', () => {
  it('puts an open bet with no deadline in the live band', () => {
    expect(feedBand(bet(), NOW)).toBe(0);
  });

  it('keeps an open bet inside its deadline live', () => {
    expect(feedBand(bet({ close_at: '2026-09-19T18:00:00Z' }), NOW)).toBe(0);
  });

  it('demotes an open bet past its deadline', () => {
    expect(feedBand(bet({ close_at: '2026-09-19T09:00:00Z' }), NOW)).toBe(1);
  });

  it('demotes a locked bet regardless of deadline', () => {
    expect(feedBand(bet({ status: 'locked' }), NOW)).toBe(1);
    expect(feedBand(bet({ status: 'locked', close_at: '2026-09-30T00:00:00Z' }), NOW)).toBe(1);
  });

  it('sends resolved and cancelled to the bottom rather than interleaving them', () => {
    expect(feedBand(bet({ status: 'resolved' }), NOW)).toBe(2);
    expect(feedBand(bet({ status: 'cancelled' }), NOW)).toBe(2);
    // A status nobody has invented yet must not scatter through the feed.
    expect(feedBand(bet({ status: 'something_new' }), NOW)).toBe(2);
  });

  it('treats a deadline exactly now as passed', () => {
    expect(feedBand(bet({ close_at: '2026-09-19T12:00:00Z' }), NOW)).toBe(1);
  });

  it('treats an unparseable deadline as no deadline, not as expired', () => {
    // A parse failure should not quietly retire a running bet.
    expect(feedBand(bet({ close_at: 'not-a-date' }), NOW)).toBe(0);
  });
});

describe('orderFeed', () => {
  it('puts live before closed, newest first inside each band', () => {
    const rows = [
      { id: 'old-live', status: 'open', close_at: null, created_at: '2026-09-18T10:00:00Z' },
      { id: 'closed-new', status: 'locked', close_at: null, created_at: '2026-09-19T11:00:00Z' },
      { id: 'new-live', status: 'open', close_at: null, created_at: '2026-09-19T09:00:00Z' },
      { id: 'closed-old', status: 'locked', close_at: null, created_at: '2026-09-01T10:00:00Z' },
    ];
    expect(orderFeed(rows, NOW).map((r) => r.id)).toEqual([
      'new-live',
      'old-live',
      'closed-new',
      'closed-old',
    ]);
  });

  it('demotes an expired open bet below a live one created earlier', () => {
    const rows = [
      { id: 'expired', status: 'open', close_at: '2026-09-19T08:00:00Z', created_at: '2026-09-19T07:00:00Z' },
      { id: 'live', status: 'open', close_at: null, created_at: '2026-09-10T07:00:00Z' },
    ];
    expect(orderFeed(rows, NOW).map((r) => r.id)).toEqual(['live', 'expired']);
  });

  it('does not mutate the input', () => {
    const rows = [
      { id: 'a', status: 'locked', close_at: null, created_at: '2026-09-01T00:00:00Z' },
      { id: 'b', status: 'open', close_at: null, created_at: '2026-09-02T00:00:00Z' },
    ];
    const before = rows.map((r) => r.id);
    orderFeed(rows, NOW);
    expect(rows.map((r) => r.id)).toEqual(before);
  });

  it('is stable rather than random when timestamps will not parse', () => {
    const rows = [
      { id: 'a', status: 'open', close_at: null, created_at: 'rubbish' },
      { id: 'b', status: 'open', close_at: null, created_at: '2026-09-02T00:00:00Z' },
    ];
    // The real one sorts above the unparseable one, and the result is the same
    // every run — NaN comparisons are all false, which is how a sort goes
    // non-deterministic.
    expect(orderFeed(rows, NOW).map((r) => r.id)).toEqual(['b', 'a']);
    expect(orderFeed(rows, NOW).map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('handles an empty feed', () => {
    expect(orderFeed([], NOW)).toEqual([]);
  });
});

describe('currency', () => {
  it('defaults to USD for anything it does not recognise', () => {
    expect(asCurrency(null)).toBe(DEFAULT_CURRENCY);
    expect(asCurrency(undefined)).toBe(DEFAULT_CURRENCY);
    expect(asCurrency('')).toBe(DEFAULT_CURRENCY);
    expect(asCurrency('XYZ')).toBe(DEFAULT_CURRENCY);
    // A row written by a newer client must not crash a screen that only wanted
    // to print a number.
    expect(asCurrency('bitcoin')).toBe(DEFAULT_CURRENCY);
  });

  it('accepts the supported set, case-insensitively', () => {
    for (const code of CURRENCIES) {
      expect(asCurrency(code)).toBe(code);
      expect(asCurrency(code.toLowerCase())).toBe(code);
      expect(asCurrency(` ${code} `)).toBe(code);
    }
  });

  it('formats with the right symbol', () => {
    expect(formatMoney(4000, 'USD')).toBe('$40');
    expect(formatMoney(4000, 'EUR')).toBe('€40');
    expect(formatMoney(4000, 'GBP')).toBe('£40');
    expect(formatMoney(4000, 'ILS')).toBe('₪40');
  });

  it('drops decimals on whole amounts and keeps them otherwise', () => {
    expect(formatMoney(4000, 'USD')).toBe('$40');
    expect(formatMoney(4050, 'USD')).toBe('$40.50');
    expect(formatMoney(1, 'USD')).toBe('$0.01');
  });

  it('signs both directions when asked', () => {
    expect(formatMoney(500, 'USD', { sign: true })).toBe('+$5');
    expect(formatMoney(-500, 'USD', { sign: true })).toBe('−$5');
    expect(formatMoney(-500, 'USD')).toBe('−$5');
  });

  it('parses back to minor units', () => {
    expect(parseMoneyToMinor('40', 'USD')).toBe(4000);
    expect(parseMoneyToMinor('40.50', 'USD')).toBe(4050);
    expect(parseMoneyToMinor('0.01', 'USD')).toBe(1);
  });

  it('strips any supported symbol, not just the active currency', () => {
    // People paste amounts. "€40" typed into a dollar group is 40 dollars —
    // the group's currency wins, never the symbol's.
    expect(parseMoneyToMinor('€40', 'USD')).toBe(4000);
    expect(parseMoneyToMinor('₪40', 'USD')).toBe(4000);
    expect(parseMoneyToMinor('$1,200', 'GBP')).toBe(120000);
  });

  it('refuses anything that is not a usable amount', () => {
    expect(parseMoneyToMinor('', 'USD')).toBeNull();
    expect(parseMoneyToMinor('.', 'USD')).toBeNull();
    expect(parseMoneyToMinor('0', 'USD')).toBeNull();
    expect(parseMoneyToMinor('-5', 'USD')).toBeNull();
    expect(parseMoneyToMinor('4.005', 'USD')).toBeNull();
    expect(parseMoneyToMinor('abc', 'USD')).toBeNull();
  });

  it('round-trips through format and parse', () => {
    for (const code of CURRENCIES) {
      for (const minor of [1, 99, 100, 4050, 123456]) {
        expect(parseMoneyToMinor(formatMoney(minor, code), code)).toBe(minor);
      }
    }
  });

  it('exposes a symbol for every supported currency', () => {
    for (const code of CURRENCIES) expect(currencySymbol(code)).toHaveLength(1);
  });
});

describe('bet covers', () => {
  it('gives the same bet the same cover every time', () => {
    // The feed re-renders on every like and realtime event. A random pick
    // would make a card visibly change colour while you looked at it.
    const id = '3f2a8c10-0000-4000-8000-000000000001';
    expect(coverIndex(id)).toBe(coverIndex(id));
  });

  it('stays inside the recipe range', () => {
    for (let i = 0; i < 500; i += 1) {
      const idx = coverIndex(`bet-${i}-0000-4000-8000-00000000abcd`);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(COVER_COUNT);
    }
  });

  it('spreads across all six rather than favouring one', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i += 1) seen.add(coverIndex(`${i}-aaaa-bbbb-cccc-dddddddddddd`));
    expect(seen.size).toBe(COVER_COUNT);
  });
});
