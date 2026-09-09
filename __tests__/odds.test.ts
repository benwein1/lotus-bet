import { percentages } from '../src/lib/odds';

/**
 * Whole percentages that add to 100.
 *
 * Rounding each share on its own does not: three equal options give 33/33/33
 * and leave a visible gap at the end of the bar. Same idea as the leftover
 * agorot in the payout maths — the parts have to add up to the whole.
 */
describe('percentages', () => {
  const sum = (values: number[]) => values.reduce((total, v) => total + v, 0);

  it('splits two options the obvious way', () => {
    expect(percentages([{ count: 1 }, { count: 2 }])).toEqual([33, 67]);
  });

  it('always adds to 100, however the counts fall', () => {
    const cases: number[][] = [
      [1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1],
      [2, 3, 4],
      [1, 0, 0],
      [5, 5, 5, 1],
      [7, 11, 13, 17, 19],
      [1, 2, 3, 4, 5, 6, 7, 8],
    ];
    for (const counts of cases) {
      const shares = percentages(counts.map((count) => ({ count })));
      expect(sum(shares)).toBe(100);
      expect(shares).toHaveLength(counts.length);
    }
  });

  it('gives the leftover points to the largest remainders', () => {
    // 1/3 each is 33.33; the three leftover points cannot all be handed out,
    // so exactly one option gets the extra and it is the first by index.
    expect(percentages([{ count: 1 }, { count: 1 }, { count: 1 }])).toEqual([34, 33, 33]);
  });

  it('shows an even split before anyone has picked', () => {
    // A blank bar reads as broken; an even one reads as "nobody yet", which
    // is what the caption above it already says.
    expect(percentages([{ count: 0 }, { count: 0 }])).toEqual([50, 50]);
    expect(sum(percentages([{ count: 0 }, { count: 0 }, { count: 0 }]))).toBe(100);
  });

  it('never returns a negative or a share above 100', () => {
    const shares = percentages([{ count: 100 }, { count: 0 }, { count: 0 }]);
    expect(Math.min(...shares)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...shares)).toBeLessThanOrEqual(100);
  });
});
