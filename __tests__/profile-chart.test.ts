import { buildSeries, dominantCurrency, normalise } from '@/lib/profile-chart';

const AT = (days: number) => new Date(Date.UTC(2026, 0, 1 + days)).toISOString();
const NOW = Date.UTC(2026, 1, 20);

describe('buildSeries', () => {
  it('runs a total through the entries oldest first', () => {
    const series = buildSeries(
      [
        { amountAgorot: -500, at: AT(2), currency: 'USD' },
        { amountAgorot: 1200, at: AT(1), currency: 'USD' },
      ],
      'USD',
      NOW
    );
    expect(series.points).toEqual([1200, 700]);
    expect(series.net).toBe(700);
    expect(series.count).toBe(2);
  });

  it('never mixes two currencies into one line', () => {
    const series = buildSeries(
      [
        { amountAgorot: 1000, at: AT(1), currency: 'USD' },
        { amountAgorot: 9999, at: AT(2), currency: 'EUR' },
      ],
      'USD',
      NOW
    );
    expect(series.points).toEqual([1000]);
    expect(series.net).toBe(1000);
  });

  it('counts only the last thirty days as recent', () => {
    const series = buildSeries(
      [
        { amountAgorot: 400, at: AT(0), currency: 'USD' },
        { amountAgorot: 100, at: new Date(NOW - 5 * 86400000).toISOString(), currency: 'USD' },
      ],
      'USD',
      NOW
    );
    expect(series.net).toBe(500);
    expect(series.recent).toBe(100);
  });

  it('is empty when nothing has settled', () => {
    expect(buildSeries([], 'USD', NOW)).toEqual({
      points: [],
      net: 0,
      recent: 0,
      currency: 'USD',
      count: 0,
    });
  });
});

describe('dominantCurrency', () => {
  it('picks the currency with the most settled bets, not the biggest total', () => {
    const entries = [
      { amountAgorot: 100000, at: AT(1), currency: 'EUR' },
      { amountAgorot: 100, at: AT(2), currency: 'USD' },
      { amountAgorot: 100, at: AT(3), currency: 'USD' },
    ];
    expect(dominantCurrency(entries)).toBe('USD');
  });

  it('falls back when there is nothing to go on', () => {
    expect(dominantCurrency([], 'ILS')).toBe('ILS');
  });
});

describe('normalise', () => {
  it('keeps zero on the scale so a winning line still climbs', () => {
    const shape = normalise([100, 200]);
    expect(shape[0]).toEqual({ x: 0, y: 0.5 });
    expect(shape[1]).toEqual({ x: 1, y: 0 });
  });

  it('draws one settled bet flat rather than as a spike', () => {
    expect(normalise([4200])).toEqual([
      { x: 0, y: 0.5 },
      { x: 1, y: 0.5 },
    ]);
  });

  it('has nothing to draw when there are no points', () => {
    expect(normalise([])).toEqual([]);
  });
});
