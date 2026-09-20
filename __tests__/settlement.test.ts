import {
  netBalances,
  personBalances,
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

describe('personBalances', () => {
  const ME = 'user-me';
  const DANA = 'user-dana';
  const ITAI = 'user-itai';

  it('reports nothing when everyone is square', () => {
    expect(
      personBalances(
        [{ groupId: 'g1', groupName: 'Flat 4B', balances: [
          { userId: ME, amountAgorot: 0 },
          { userId: DANA, amountAgorot: 0 },
        ] }],
        ME
      )
    ).toEqual([]);
  });

  it('says who owes you, and how much', () => {
    const totals = personBalances(
      [{ groupId: 'g1', groupName: 'Flat 4B', balances: [
        { userId: ME, amountAgorot: 4000 },
        { userId: DANA, amountAgorot: -4000 },
      ] }],
      ME
    );
    expect(totals).toEqual([
      { userId: DANA, amountAgorot: 4000, currency: 'USD', groupNames: ['Flat 4B'] },
    ]);
  });

  it('signs what you owe as negative', () => {
    const totals = personBalances(
      [{ groupId: 'g1', groupName: 'Flat 4B', balances: [
        { userId: ME, amountAgorot: -2500 },
        { userId: DANA, amountAgorot: 2500 },
      ] }],
      ME
    );
    expect(totals[0]).toEqual({
      userId: DANA,
      amountAgorot: -2500,
      currency: 'USD',
      groupNames: ['Flat 4B'],
    });
  });

  it('cancels the same person across two groups, and names both', () => {
    const totals = personBalances(
      [
        { groupId: 'g1', groupName: 'Flat 4B', balances: [
          { userId: ME, amountAgorot: 3000 },
          { userId: DANA, amountAgorot: -3000 },
        ] },
        { groupId: 'g2', groupName: 'Sunday League', balances: [
          { userId: ME, amountAgorot: -1000 },
          { userId: DANA, amountAgorot: 1000 },
        ] },
      ],
      ME
    );
    expect(totals).toEqual([
      {
        userId: DANA,
        amountAgorot: 2000,
        currency: 'USD',
        groupNames: ['Flat 4B', 'Sunday League'],
      },
    ]);
  });

  it('drops a person who nets to exactly zero across groups', () => {
    const totals = personBalances(
      [
        { groupId: 'g1', groupName: 'Flat 4B', balances: [
          { userId: ME, amountAgorot: 3000 },
          { userId: DANA, amountAgorot: -3000 },
        ] },
        { groupId: 'g2', groupName: 'Sunday League', balances: [
          { userId: ME, amountAgorot: -3000 },
          { userId: DANA, amountAgorot: 3000 },
        ] },
      ],
      ME
    );
    expect(totals).toEqual([]);
  });

  it('ignores debts between two other people', () => {
    const totals = personBalances(
      [{ groupId: 'g1', groupName: 'Flat 4B', balances: [
        { userId: ME, amountAgorot: 0 },
        { userId: DANA, amountAgorot: 5000 },
        { userId: ITAI, amountAgorot: -5000 },
      ] }],
      ME
    );
    expect(totals).toEqual([]);
  });

  it('puts what you are owed before what you owe', () => {
    const totals = personBalances(
      [{ groupId: 'g1', groupName: 'Flat 4B', balances: [
        { userId: ME, amountAgorot: 1000 },
        { userId: DANA, amountAgorot: -4000 },
        { userId: ITAI, amountAgorot: 3000 },
      ] }],
      ME
    );
    // Whatever the greedy matching pairs up, anything owed to me sorts first.
    const amounts = totals.map((t) => t.amountAgorot);
    expect([...amounts].sort((a, b) => b - a)).toEqual(amounts);
  });

  it('never invents money: every figure comes from a real transaction', () => {
    const totals = personBalances(
      [{ groupId: 'g1', groupName: 'Flat 4B', balances: [
        { userId: ME, amountAgorot: -9000 },
        { userId: DANA, amountAgorot: 4500 },
        { userId: ITAI, amountAgorot: 4500 },
      ] }],
      ME
    );
    expect(totals.reduce((sum, t) => sum + t.amountAgorot, 0)).toBe(-9000);
  });
});

describe('personBalances across currencies', () => {
  const ME = 'user-me';
  const DANA = 'user-dana';

  it('keeps a dollar debt and a shekel debt apart', () => {
    const totals = personBalances(
      [
        {
          groupId: 'g1',
          groupName: 'Flat 4B',
          currency: 'USD',
          balances: [
            { userId: ME, amountAgorot: 3000 },
            { userId: DANA, amountAgorot: -3000 },
          ],
        },
        {
          groupId: 'g2',
          groupName: 'Sunday League',
          currency: 'ILS',
          balances: [
            { userId: ME, amountAgorot: -3000 },
            { userId: DANA, amountAgorot: 3000 },
          ],
        },
      ],
      ME
    );

    // The same person, twice, because +$30 and −₪30 are not the same quantity
    // and cancelling them would invent an exchange rate.
    expect(totals).toHaveLength(2);
    expect(totals).toContainEqual({
      userId: DANA,
      amountAgorot: 3000,
      currency: 'USD',
      groupNames: ['Flat 4B'],
    });
    expect(totals).toContainEqual({
      userId: DANA,
      amountAgorot: -3000,
      currency: 'ILS',
      groupNames: ['Sunday League'],
    });
  });

  it('still nets two groups that share a currency', () => {
    const totals = personBalances(
      [
        {
          groupId: 'g1',
          groupName: 'Flat 4B',
          currency: 'ILS',
          balances: [
            { userId: ME, amountAgorot: 3000 },
            { userId: DANA, amountAgorot: -3000 },
          ],
        },
        {
          groupId: 'g2',
          groupName: 'Sunday League',
          currency: 'ILS',
          balances: [
            { userId: ME, amountAgorot: -1000 },
            { userId: DANA, amountAgorot: 1000 },
          ],
        },
      ],
      ME
    );

    expect(totals).toEqual([
      {
        userId: DANA,
        amountAgorot: 2000,
        currency: 'ILS',
        groupNames: ['Flat 4B', 'Sunday League'],
      },
    ]);
  });

  it('treats a group with no currency column as the default rather than its own bucket', () => {
    const totals = personBalances(
      [
        {
          groupId: 'g1',
          groupName: 'Flat 4B',
          balances: [
            { userId: ME, amountAgorot: 1000 },
            { userId: DANA, amountAgorot: -1000 },
          ],
        },
        {
          groupId: 'g2',
          groupName: 'Sunday League',
          currency: 'USD',
          balances: [
            { userId: ME, amountAgorot: 500 },
            { userId: DANA, amountAgorot: -500 },
          ],
        },
      ],
      ME
    );

    expect(totals).toEqual([
      {
        userId: DANA,
        amountAgorot: 1500,
        currency: 'USD',
        groupNames: ['Flat 4B', 'Sunday League'],
      },
    ]);
  });

  it('drops a person who is square in one currency but not another', () => {
    const totals = personBalances(
      [
        {
          groupId: 'g1',
          groupName: 'Flat 4B',
          currency: 'USD',
          balances: [
            { userId: ME, amountAgorot: 1000 },
            { userId: DANA, amountAgorot: -1000 },
          ],
        },
        {
          groupId: 'g2',
          groupName: 'Sunday League',
          currency: 'USD',
          balances: [
            { userId: ME, amountAgorot: -1000 },
            { userId: DANA, amountAgorot: 1000 },
          ],
        },
        {
          groupId: 'g3',
          groupName: 'The Lads',
          currency: 'GBP',
          balances: [
            { userId: ME, amountAgorot: -700 },
            { userId: DANA, amountAgorot: 700 },
          ],
        },
      ],
      ME
    );

    expect(totals).toEqual([
      { userId: DANA, amountAgorot: -700, currency: 'GBP', groupNames: ['The Lads'] },
    ]);
  });
});
