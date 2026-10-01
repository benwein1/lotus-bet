import {
  attentionFor,
  countAttention,
  describeAttention,
  orderForViewer,
  type AttentionBet,
} from '@/lib/attention';

const NOW = Date.parse('2026-09-19T12:00:00Z');
const ME = 'me';
const THEM = 'them';

const bet = (over: Partial<AttentionBet> = {}): AttentionBet => ({
  creator_id: THEM,
  status: 'open',
  close_at: null,
  created_at: '2026-09-19T10:00:00Z',
  positions: [],
  ...over,
});

describe('attentionFor', () => {
  it('asks for a side on a live bet you have not answered', () => {
    expect(attentionFor(bet(), ME, NOW)).toBe('answer');
  });

  it('asks for nothing once you have a side', () => {
    expect(attentionFor(bet({ positions: [{ user_id: ME }] }), ME, NOW)).toBeNull();
  });

  it('counts somebody else’s side as nothing to do', () => {
    expect(attentionFor(bet({ positions: [{ user_id: THEM }] }), ME, NOW)).toBe('answer');
  });

  it('still asks the creator for a side while the bet is live', () => {
    // A creator takes a side like anyone else, and a bet of your own you never
    // answered is exactly as forgettable as one of theirs.
    expect(attentionFor(bet({ creator_id: ME }), ME, NOW)).toBe('answer');
  });

  it('asks the creator to call it once the window has shut', () => {
    expect(attentionFor(bet({ creator_id: ME, status: 'locked' }), ME, NOW)).toBe('call');
    expect(
      attentionFor(bet({ creator_id: ME, close_at: '2026-09-19T09:00:00Z' }), ME, NOW)
    ).toBe('call');
  });

  it('never asks a non-creator to call', () => {
    expect(attentionFor(bet({ status: 'locked' }), ME, NOW)).toBeNull();
  });

  it('is quiet once a bet is resolved or cancelled', () => {
    expect(attentionFor(bet({ creator_id: ME, status: 'resolved' }), ME, NOW)).toBeNull();
    expect(attentionFor(bet({ creator_id: ME, status: 'cancelled' }), ME, NOW)).toBeNull();
  });

  it('answers nothing for a signed-out viewer', () => {
    expect(attentionFor(bet(), '', NOW)).toBeNull();
  });

  it('never asks for both at once', () => {
    // The two bands cannot overlap: `answer` is live, `call` is closed.
    const rows = [
      bet({ creator_id: ME }),
      bet({ creator_id: ME, status: 'locked' }),
      bet({ creator_id: ME, close_at: '2026-09-19T09:00:00Z' }),
    ];
    for (const row of rows) {
      const kind = attentionFor(row, ME, NOW);
      expect(kind === 'answer' || kind === 'call' || kind === null).toBe(true);
    }
  });
});

describe('countAttention', () => {
  it('splits the two kinds and totals them', () => {
    const rows = [
      bet(),
      bet(),
      bet({ positions: [{ user_id: ME }] }),
      bet({ creator_id: ME, status: 'locked' }),
      bet({ status: 'resolved' }),
    ];
    expect(countAttention(rows, ME, NOW)).toEqual({ answer: 2, call: 1, total: 3 });
  });

  it('is zero on an empty feed', () => {
    expect(countAttention([], ME, NOW)).toEqual({ answer: 0, call: 0, total: 0 });
  });
});

describe('describeAttention', () => {
  it('says nothing when there is nothing', () => {
    expect(describeAttention({ answer: 0, call: 0, total: 0 })).toBeNull();
  });

  it('gets the singular right', () => {
    expect(describeAttention({ answer: 1, call: 0, total: 1 })).toBe('1 bet needs your side');
    expect(describeAttention({ answer: 0, call: 1, total: 1 })).toBe('1 bet is yours to call');
  });

  it('gets the plural right', () => {
    expect(describeAttention({ answer: 3, call: 0, total: 3 })).toBe('3 bets need your side');
    expect(describeAttention({ answer: 0, call: 2, total: 2 })).toBe('2 bets are yours to call');
  });

  it('joins both kinds into one sentence', () => {
    expect(describeAttention({ answer: 2, call: 1, total: 3 })).toBe(
      '2 bets need your side, and 1 is yours to call'
    );
  });
});

describe('orderForViewer', () => {
  it('puts what needs you first, answering before calling', () => {
    const rows = [
      { id: 'answered', ...bet({ positions: [{ user_id: ME }] }) },
      { id: 'to-call', ...bet({ creator_id: ME, status: 'locked' }) },
      { id: 'to-answer', ...bet() },
    ];
    expect(orderForViewer(rows, ME, NOW).map((r) => r.id)).toEqual([
      'to-answer',
      'to-call',
      'answered',
    ]);
  });

  it('is the fix for the bug it replaces', () => {
    // The old feed partitioned "bets I am in" to the top, so this locked bet —
    // already answered, nothing left to do — outranked a live one that still
    // needed a side. That is the ordering this function exists to correct.
    const rows = [
      { id: 'locked-and-answered', ...bet({ status: 'locked', positions: [{ user_id: ME }] }) },
      { id: 'live-unanswered', ...bet() },
    ];
    expect(orderForViewer(rows, ME, NOW).map((r) => r.id)).toEqual([
      'live-unanswered',
      'locked-and-answered',
    ]);
  });

  it('falls back to the lifecycle band, then to newest first', () => {
    const rows = [
      { id: 'old-live', ...bet({ positions: [{ user_id: ME }], created_at: '2026-09-18T10:00:00Z' }) },
      { id: 'closed', ...bet({ status: 'locked', positions: [{ user_id: ME }] }) },
      { id: 'new-live', ...bet({ positions: [{ user_id: ME }], created_at: '2026-09-19T11:00:00Z' }) },
    ];
    expect(orderForViewer(rows, ME, NOW).map((r) => r.id)).toEqual([
      'new-live',
      'old-live',
      'closed',
    ]);
  });

  it('does not mutate the input', () => {
    const rows = [
      { id: 'a', ...bet({ positions: [{ user_id: ME }] }) },
      { id: 'b', ...bet() },
    ];
    const before = rows.map((r) => r.id);
    orderForViewer(rows, ME, NOW);
    expect(rows.map((r) => r.id)).toEqual(before);
  });

  it('leaves a signed-out viewer with the lifecycle order', () => {
    const rows = [
      { id: 'closed', ...bet({ status: 'locked' }) },
      { id: 'live', ...bet() },
    ];
    expect(orderForViewer(rows, '', NOW).map((r) => r.id)).toEqual(['live', 'closed']);
  });
});
