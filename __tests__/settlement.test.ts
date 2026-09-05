import {
  netBalances,
  simplifyDebts,
  transactionKey,
  type BalanceLine,
} from '@/lib/settlement';

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

describe('netBalances', () => {
  it('sums ledger lines per user', () => {
    expect(
      netBalances([
        { userId: 'a', amountAgorot: 3334 },
        { userId: 'b', amountAgorot: -5000 },
        { userId: 'a', amountAgorot: -1000 },
      ])
    ).toEqual([
      { userId: 'a', amountAgorot: 2334 },
      { userId: 'b', amountAgorot: -5000 },
    ]);
  });

  it('cancels debt once a payment is confirmed', () => {
    const ledger: BalanceLine[] = [
      { userId: 'ariel', amountAgorot: -4000 },
      { userId: 'dor', amountAgorot: 4000 },
    ];

    expect(
      netBalances(ledger, [
        { fromUserId: 'ariel', toUserId: 'dor', amountAgorot: 4000 },
      ])
    ).toEqual([
      { userId: 'ariel', amountAgorot: 0 },
      { userId: 'dor', amountAgorot: 0 },
    ]);
  });

  it('applies partial payments', () => {
    const balances = netBalances(
      [
        { userId: 'ariel', amountAgorot: -4000 },
        { userId: 'dor', amountAgorot: 4000 },
      ],
      [{ fromUserId: 'ariel', toUserId: 'dor', amountAgorot: 1500 }]
    );

    expect(balances).toEqual([
      { userId: 'ariel', amountAgorot: -2500 },
      { userId: 'dor', amountAgorot: 2500 },
    ]);
  });

  it('keeps the group at zero sum after payments', () => {
    const balances = netBalances(
      [
        { userId: 'a', amountAgorot: -3000 },
        { userId: 'b', amountAgorot: -2000 },
        { userId: 'c', amountAgorot: 5000 },
      ],
      [{ fromUserId: 'b', toUserId: 'c', amountAgorot: 2000 }]
    );

    expect(sum(balances.map((b) => b.amountAgorot))).toBe(0);
  });
});

describe('simplifyDebts', () => {
  it('produces a single transaction for a two-person debt', () => {
    expect(
      simplifyDebts([
        { userId: 'ariel', amountAgorot: -4000 },
        { userId: 'dor', amountAgorot: 4000 },
      ])
    ).toEqual([{ fromUserId: 'ariel', toUserId: 'dor', amountAgorot: 4000 }]);
  });

  it('nets a circular debt down to nothing', () => {
    // a owes b, b owes c, c owes a — all for the same amount.
    expect(
      simplifyDebts([
        { userId: 'a', amountAgorot: 0 },
        { userId: 'b', amountAgorot: 0 },
        { userId: 'c', amountAgorot: 0 },
      ])
    ).toEqual([]);
  });

  it('splits one debtor across several creditors', () => {
    const txns = simplifyDebts([
      { userId: 'debtor', amountAgorot: -10000 },
      { userId: 'big', amountAgorot: 7000 },
      { userId: 'small', amountAgorot: 3000 },
    ]);

    expect(txns).toEqual([
      { fromUserId: 'debtor', toUserId: 'big', amountAgorot: 7000 },
      { fromUserId: 'debtor', toUserId: 'small', amountAgorot: 3000 },
    ]);
  });

  it('never needs more than n-1 transactions', () => {
    const balances: BalanceLine[] = [
      { userId: 'a', amountAgorot: -5000 },
      { userId: 'b', amountAgorot: -3000 },
      { userId: 'c', amountAgorot: -1000 },
      { userId: 'd', amountAgorot: 4000 },
      { userId: 'e', amountAgorot: 5000 },
    ];

    const txns = simplifyDebts(balances);

    expect(txns.length).toBeLessThanOrEqual(balances.length - 1);
  });

  it('settles everyone to zero', () => {
    const balances: BalanceLine[] = [
      { userId: 'a', amountAgorot: -3334 },
      { userId: 'b', amountAgorot: -1666 },
      { userId: 'c', amountAgorot: 2500 },
      { userId: 'd', amountAgorot: 1500 },
      { userId: 'e', amountAgorot: 1000 },
    ];

    const after = netBalances(
      balances,
      simplifyDebts(balances).map((t) => ({
        fromUserId: t.fromUserId,
        toUserId: t.toUserId,
        amountAgorot: t.amountAgorot,
      }))
    );

    expect(after.every((b) => b.amountAgorot === 0)).toBe(true);
  });

  it('settles randomised zero-sum groups to zero', () => {
    let seed = 42;
    const rand = (max: number) => {
      // Deterministic LCG so a failure is reproducible.
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % max;
    };

    for (let round = 0; round < 200; round++) {
      const size = 2 + rand(7);
      const balances: BalanceLine[] = Array.from({ length: size }, (_, i) => ({
        userId: `u${i}`,
        amountAgorot: rand(20001) - 10000,
      }));
      // Force zero sum by absorbing the residual into the first member.
      balances[0]!.amountAgorot -= sum(balances.map((b) => b.amountAgorot));

      const txns = simplifyDebts(balances);
      const after = netBalances(balances, txns);

      expect(after.every((b) => b.amountAgorot === 0)).toBe(true);
      expect(txns.every((t) => t.amountAgorot > 0)).toBe(true);
      expect(txns.every((t) => t.fromUserId !== t.toUserId)).toBe(true);
    }
  });

  it('ignores members who are already square', () => {
    const txns = simplifyDebts([
      { userId: 'a', amountAgorot: 0 },
      { userId: 'b', amountAgorot: -100 },
      { userId: 'c', amountAgorot: 100 },
    ]);

    expect(txns).toEqual([
      { fromUserId: 'b', toUserId: 'c', amountAgorot: 100 },
    ]);
  });

  it('does not mutate the balances it is given', () => {
    const balances: BalanceLine[] = [
      { userId: 'a', amountAgorot: -100 },
      { userId: 'b', amountAgorot: 100 },
    ];

    simplifyDebts(balances);

    expect(balances).toEqual([
      { userId: 'a', amountAgorot: -100 },
      { userId: 'b', amountAgorot: 100 },
    ]);
  });

  it('is deterministic when several balances tie', () => {
    const balances: BalanceLine[] = [
      { userId: 'z', amountAgorot: -1000 },
      { userId: 'y', amountAgorot: -1000 },
      { userId: 'x', amountAgorot: 1000 },
      { userId: 'w', amountAgorot: 1000 },
    ];

    expect(simplifyDebts(balances)).toEqual(
      simplifyDebts([...balances].reverse())
    );
  });
});

describe('transactionKey', () => {
  it('is stable for the same suggested transaction', () => {
    expect(
      transactionKey({ fromUserId: 'a', toUserId: 'b', amountAgorot: 500 })
    ).toBe('a:b:500');
  });
});
