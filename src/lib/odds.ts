/**
 * Turning headcounts into the percentages the odds bar draws.
 *
 * Dependency-free so it can be tested without mocking React Native, and
 * separate from the component because it is arithmetic, not rendering.
 */

/**
 * Whole percentages that always add to exactly 100.
 *
 * Rounding each share on its own does not add up: three equal options round
 * to 33/33/33 and leave a visible gap at the end of the bar, and eight of them
 * leave four. The leftover points go to the largest remainders — the same idea
 * as handing the leftover agorot to the lowest-sorting user id in the payout
 * maths. The parts have to make the whole.
 *
 * With nothing picked yet it returns an even split rather than all zeroes: a
 * bar of nothing reads as broken, and the caption above it already says that
 * nobody has picked.
 */
export function percentages(slices: readonly { count: number }[]): number[] {
  if (slices.length === 0) return [];

  const total = slices.reduce((sum, slice) => sum + slice.count, 0);

  if (total === 0) {
    const even = Math.floor(100 / slices.length);
    const shares = slices.map(() => even);
    let leftover = 100 - even * slices.length;
    for (let i = 0; leftover > 0; i = (i + 1) % slices.length, leftover--) {
      shares[i] = (shares[i] ?? 0) + 1;
    }
    return shares;
  }

  const exact = slices.map((slice) => (slice.count / total) * 100);
  const shares = exact.map(Math.floor);
  let leftover = 100 - shares.reduce((sum, value) => sum + value, 0);

  // Ties break by index, so the same counts always produce the same bar.
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  for (const { index } of byRemainder) {
    if (leftover <= 0) break;
    shares[index] = (shares[index] ?? 0) + 1;
    leftover--;
  }

  return shares;
}
