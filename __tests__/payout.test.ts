import {
  computeBetPayouts,
  previewShareAgorot,
  splitEvenly,
  type BetParticipant,
} from '@/lib/payout';

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

// Sorted ascending so tests can reason about who gets the leftover agorot.
const u = (n: number) => `user-${String(n).padStart(2, '0')}`;

describe('splitEvenly', () => {
  it('splits an exactly divisible amount with no remainder', () => {
    expect(splitEvenly(10000, [u(1), u(2)])).toEqual([
      { userId: u(1), amountAgorot: 5000 },
      { userId: u(2), amountAgorot: 5000 },
    ]);
  });

  it('hands leftover agorot to the lowest user ids, one each', () => {
    expect(splitEvenly(10000, [u(3), u(1), u(2)])).toEqual([
      { userId: u(1), amountAgorot: 3334 },
      { userId: u(2), amountAgorot: 3333 },
      { userId: u(3), amountAgorot: 3333 },
    ]);
  });

  it('is independent of input ordering', () => {
    const ids = [u(5), u(2), u(9), u(1)];
    const forwards = splitEvenly(1001, ids);
    const backwards = splitEvenly(1001, [...ids].reverse());
    expect(forwards).toEqual(backwards);
  });

  it('always sums back to the original total', () => {
    for (let total = 0; total <= 200; total++) {
      for (let n = 1; n <= 7; n++) {
        const ids = Array.from({ length: n }, (_, i) => u(i));
        const shares = splitEvenly(total, ids);
        expect(sum(shares.map((s) => s.amountAgorot))).toBe(total);
      }
    }
  });

  it('never lets two people differ by more than one agora', () => {
    const ids = Array.from({ length: 7 }, (_, i) => u(i));
    const amounts = splitEvenly(1000, ids).map((s) => s.amountAgorot);
    expect(Math.max(...amounts) - Math.min(...amounts)).toBeLessThanOrEqual(1);
  });

  it('returns nothing for an empty group', () => {
    expect(splitEvenly(500, [])).toEqual([]);
  });

  it('rejects duplicates and negative totals', () => {
    expect(() => splitEvenly(100, [u(1), u(1)])).toThrow(/duplicate/);
    expect(() => splitEvenly(-1, [u(1)])).toThrow(/non-negative/);
  });
});

describe('computeBetPayouts', () => {
  it('matches the worked example from the spec', () => {
    // 100 ILS pot, 2 on side A, 3 on side B, side B wins.
    const participants: BetParticipant[] = [
      { userId: u(1), side: 'a' },
      { userId: u(2), side: 'a' },
      { userId: u(3), side: 'b' },
      { userId: u(4), side: 'b' },
      { userId: u(5), side: 'b' },
    ];

    const result = computeBetPayouts(10000, participants, 'b');

    expect(result.paidOut).toBe(true);
    expect(result.winnerCount).toBe(3);
    expect(result.loserCount).toBe(2);
    expect(result.entries).toEqual([
      { userId: u(1), amountAgorot: -5000 },
      { userId: u(2), amountAgorot: -5000 },
      // floor(10000 / 3) = 3333, and the single leftover agora goes to the
      // lowest-sorting winner.
      { userId: u(3), amountAgorot: 3334 },
      { userId: u(4), amountAgorot: 3333 },
      { userId: u(5), amountAgorot: 3333 },
    ]);
  });

  it('nets to exactly zero across all participants', () => {
    const participants: BetParticipant[] = [
      { userId: u(1), side: 'a' },
      { userId: u(2), side: 'a' },
      { userId: u(3), side: 'a' },
      { userId: u(4), side: 'b' },
      { userId: u(5), side: 'b' },
      { userId: u(6), side: 'b' },
      { userId: u(7), side: 'b' },
    ];

    const result = computeBetPayouts(9999, participants, 'a');
    const amounts = result.entries.map((e) => e.amountAgorot);

    expect(sum(amounts)).toBe(0);
    expect(sum(amounts.filter((n) => n > 0))).toBe(9999);
    expect(sum(amounts.filter((n) => n < 0))).toBe(-9999);
  });

  it('nets to zero for every plausible split of a pot', () => {
    for (const pot of [1, 7, 100, 9999, 10000, 123457]) {
      for (let winners = 1; winners <= 6; winners++) {
        for (let losers = 1; losers <= 6; losers++) {
          const participants: BetParticipant[] = [
            ...Array.from({ length: winners }, (_, i) => ({
              userId: u(i),
              side: 'a' as const,
            })),
            ...Array.from({ length: losers }, (_, i) => ({
              userId: u(100 + i),
              side: 'b' as const,
            })),
          ];
          const { entries } = computeBetPayouts(pot, participants, 'a');
          const amounts = entries.map((e) => e.amountAgorot);
          expect(sum(amounts)).toBe(0);
          expect(sum(amounts.filter((n) => n > 0))).toBe(pot);
          expect(sum(amounts.filter((n) => n < 0))).toBe(-pot);
        }
      }
    }
  });

  it('pays out nothing when nobody backed the winning side', () => {
    const participants: BetParticipant[] = [
      { userId: u(1), side: 'a' },
      { userId: u(2), side: 'a' },
    ];

    const result = computeBetPayouts(10000, participants, 'b');

    expect(result).toEqual({
      paidOut: false,
      winnerCount: 0,
      loserCount: 2,
      entries: [],
    });
  });

  it('pays out nothing when nobody backed the losing side', () => {
    const participants: BetParticipant[] = [
      { userId: u(1), side: 'a' },
      { userId: u(2), side: 'a' },
    ];

    const result = computeBetPayouts(10000, participants, 'a');

    expect(result.paidOut).toBe(false);
    expect(result.entries).toEqual([]);
  });

  it('pays out nothing when nobody joined at all', () => {
    expect(computeBetPayouts(10000, [], 'a')).toEqual({
      paidOut: false,
      winnerCount: 0,
      loserCount: 0,
      entries: [],
    });
  });

  it('handles a pot smaller than the number of winners', () => {
    // 2 agorot split across 3 winners: two get 1, one gets 0 and is dropped.
    const participants: BetParticipant[] = [
      { userId: u(1), side: 'a' },
      { userId: u(2), side: 'a' },
      { userId: u(3), side: 'a' },
      { userId: u(4), side: 'b' },
    ];

    const { entries } = computeBetPayouts(2, participants, 'a');

    expect(entries).toEqual([
      { userId: u(1), amountAgorot: 1 },
      { userId: u(2), amountAgorot: 1 },
      { userId: u(4), amountAgorot: -2 },
    ]);
  });

  it('is order-independent for identical participant sets', () => {
    const participants: BetParticipant[] = [
      { userId: u(4), side: 'b' },
      { userId: u(1), side: 'a' },
      { userId: u(3), side: 'b' },
      { userId: u(2), side: 'a' },
      { userId: u(5), side: 'b' },
    ];
    const shuffled = [...participants].reverse();

    expect(computeBetPayouts(777, participants, 'b')).toEqual(
      computeBetPayouts(777, shuffled, 'b')
    );
  });

  it('rejects invalid pots, sides and duplicate positions', () => {
    expect(() => computeBetPayouts(0, [], 'a')).toThrow(/positive integer/);
    expect(() => computeBetPayouts(1.5, [], 'a')).toThrow(/positive integer/);
    expect(() =>
      computeBetPayouts(100, [], 'c' as unknown as 'a')
    ).toThrow(/winningSide/);
    expect(() =>
      computeBetPayouts(
        100,
        [
          { userId: u(1), side: 'a' },
          { userId: u(1), side: 'b' },
        ],
        'a'
      )
    ).toThrow(/more than one side/);
  });
});

describe('previewShareAgorot', () => {
  it('shows the base share a joiner would get', () => {
    expect(previewShareAgorot(10000, 3)).toBe(3333);
    expect(previewShareAgorot(10000, 1)).toBe(10000);
  });

  it('is zero when nobody is on the side yet', () => {
    expect(previewShareAgorot(10000, 0)).toBe(0);
  });
});
