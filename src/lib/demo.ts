/**
 * TEMPORARY: offline demo mode.
 *
 * Lets you open the app and click through every screen without a Supabase
 * project, an SMS provider, or a network connection. Nothing here touches the
 * backend — it is an in-memory fake that mirrors the shape of `queries.ts`.
 *
 * This is scaffolding for looking at the UI, not a product feature. To remove
 * it: delete this file, delete `app/(auth)/phone.tsx`'s demo button, and grep
 * for `isDemoMode` — every call site is a one-line guard.
 *
 * Two things keep it honest:
 * - Resolving a bet runs the real `computeBetPayouts`, so the demo exercises
 *   the actual money maths rather than a second implementation of it.
 * - The entry point only renders in development (see `DEMO_AVAILABLE`).
 */
import { computeBetPayouts } from './payout';
import type {
  BetLedgerEntryRow,
  BetRow,
  BetSide,
  BetWithPositions,
  GroupBalanceRow,
  GroupMemberRow,
  GroupRow,
  MyStatsRow,
  SettlementConfirmationRow,
  UserRow,
} from './database.types';
import type { GroupWithMembers, HistoryEntry, NewBetInput, ResolveBetResult } from './queries';

/**
 * The demo entry point is development-only. `__DEV__` is false in any
 * production build, so the button cannot ship by accident; the env var exists
 * so the mode can be exercised in an exported bundle when testing.
 */
export const DEMO_AVAILABLE =
  __DEV__ || process.env.EXPO_PUBLIC_ENABLE_DEMO === '1';

let active = false;

export function isDemoMode(): boolean {
  return active;
}

export function enableDemoMode(): void {
  active = true;
  reset();
}

export function disableDemoMode(): void {
  active = false;
}

// --- Cast of characters -----------------------------------------------------

export const DEMO_USER_ID = 'demo-0000-0000-0000-000000000001';
const DOR = 'demo-0000-0000-0000-000000000002';
const NOA = 'demo-0000-0000-0000-000000000003';
const YOSSI = 'demo-0000-0000-0000-000000000004';

function user(id: string, name: string, phone: string): UserRow {
  return {
    id,
    phone,
    display_name: name,
    avatar_url: null,
    expo_push_token: null,
    notify_new_bets: true,
    notify_resolutions: true,
    created_at: '2026-08-01T10:00:00Z',
  };
}

const USERS: Record<string, UserRow> = {
  [DEMO_USER_ID]: user(DEMO_USER_ID, 'You', '+972500000000'),
  [DOR]: user(DOR, 'Dor Levi', '+972500000002'),
  [NOA]: user(NOA, 'Noa Bar', '+972500000003'),
  [YOSSI]: user(YOSSI, 'Yossi Cohen', '+972500000004'),
};

export const demoProfile: UserRow = USERS[DEMO_USER_ID]!;

/**
 * A session-shaped object for the auth provider. It is never sent anywhere —
 * demo mode short-circuits before any Supabase call — so the fake token is
 * inert.
 */
export const demoSession = {
  access_token: 'demo',
  refresh_token: 'demo',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: 4102444800,
  user: {
    id: DEMO_USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    phone: demoProfile.phone,
    app_metadata: {},
    user_metadata: {},
    created_at: demoProfile.created_at,
  },
} as const;

// --- Mutable world ----------------------------------------------------------

interface DemoState {
  groups: GroupRow[];
  members: GroupMemberRow[];
  bets: BetRow[];
  positions: { bet_id: string; user_id: string; side: BetSide }[];
  ledger: BetLedgerEntryRow[];
  settlements: SettlementConfirmationRow[];
  profile: UserRow;
}

let state: DemoState = seed();

function reset(): void {
  state = seed();
}

function seed(): DemoState {
  const groupId = 'demo-group-1';
  const now = Date.now();
  const iso = (offsetHours: number) => new Date(now + offsetHours * 3_600_000).toISOString();

  return {
    profile: { ...demoProfile },
    groups: [
      {
        id: groupId,
        name: 'Sunday League Degenerates',
        emoji: '⚽️',
        created_by: DOR,
        invite_code: 'K7QM2X',
        created_at: iso(-24 * 30),
      },
      {
        id: 'demo-group-2',
        name: 'Flat 4B',
        emoji: '🏠',
        created_by: DEMO_USER_ID,
        invite_code: 'PL9WTZ',
        created_at: iso(-24 * 12),
      },
    ],
    members: [
      { group_id: groupId, user_id: DOR, role: 'admin', joined_at: iso(-24 * 30) },
      { group_id: groupId, user_id: DEMO_USER_ID, role: 'member', joined_at: iso(-24 * 29) },
      { group_id: groupId, user_id: NOA, role: 'member', joined_at: iso(-24 * 28) },
      { group_id: groupId, user_id: YOSSI, role: 'member', joined_at: iso(-24 * 20) },
      { group_id: 'demo-group-2', user_id: DEMO_USER_ID, role: 'admin', joined_at: iso(-24 * 12) },
      { group_id: 'demo-group-2', user_id: NOA, role: 'member', joined_at: iso(-24 * 11) },
    ],
    bets: [
      {
        id: 'demo-bet-1',
        group_id: groupId,
        creator_id: DOR,
        title: 'Will Yossi actually show up on time on Friday?',
        description: 'On time means before kickoff, not "walking in during the warm-up".',
        option_a_label: 'He will',
        option_b_label: 'No chance',
        total_pot_agorot: 10000,
        status: 'open',
        winning_option: null,
        close_at: iso(5),
        created_at: iso(-6),
        resolved_at: null,
      },
      {
        id: 'demo-bet-2',
        group_id: groupId,
        creator_id: DEMO_USER_ID,
        title: 'Maccabi win by two or more',
        description: null,
        option_a_label: 'Yes',
        option_b_label: 'No',
        total_pot_agorot: 5000,
        status: 'open',
        winning_option: null,
        close_at: null,
        created_at: iso(-2),
        resolved_at: null,
      },
      {
        id: 'demo-bet-3',
        group_id: 'demo-group-2',
        creator_id: NOA,
        title: 'Landlord fixes the boiler this month',
        description: null,
        option_a_label: 'Will',
        option_b_label: "Won't",
        total_pot_agorot: 3000,
        status: 'locked',
        winning_option: null,
        close_at: iso(-1),
        created_at: iso(-48),
        resolved_at: null,
      },
      {
        id: 'demo-bet-4',
        group_id: groupId,
        creator_id: DEMO_USER_ID,
        title: 'Rain before Saturday',
        description: null,
        option_a_label: 'Yes',
        option_b_label: 'No',
        total_pot_agorot: 4000,
        status: 'resolved',
        winning_option: 'b',
        close_at: null,
        created_at: iso(-24 * 8),
        resolved_at: iso(-24 * 5),
      },
    ],
    positions: [
      { bet_id: 'demo-bet-1', user_id: DEMO_USER_ID, side: 'a' },
      { bet_id: 'demo-bet-1', user_id: DOR, side: 'b' },
      { bet_id: 'demo-bet-1', user_id: NOA, side: 'b' },
      { bet_id: 'demo-bet-2', user_id: DOR, side: 'a' },
      { bet_id: 'demo-bet-3', user_id: DEMO_USER_ID, side: 'b' },
      { bet_id: 'demo-bet-3', user_id: NOA, side: 'a' },
      { bet_id: 'demo-bet-4', user_id: DEMO_USER_ID, side: 'a' },
      { bet_id: 'demo-bet-4', user_id: DOR, side: 'b' },
      { bet_id: 'demo-bet-4', user_id: NOA, side: 'b' },
    ],
    ledger: [
      {
        id: 'demo-ledger-1',
        bet_id: 'demo-bet-4',
        group_id: groupId,
        user_id: DEMO_USER_ID,
        amount_agorot: -4000,
        created_at: iso(-24 * 5),
      },
      {
        id: 'demo-ledger-2',
        bet_id: 'demo-bet-4',
        group_id: groupId,
        user_id: DOR,
        amount_agorot: 2000,
        created_at: iso(-24 * 5),
      },
      {
        id: 'demo-ledger-3',
        bet_id: 'demo-bet-4',
        group_id: groupId,
        user_id: NOA,
        amount_agorot: 2000,
        created_at: iso(-24 * 5),
      },
    ],
    settlements: [],
  };
}

// --- Helpers ----------------------------------------------------------------

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function myGroupIds(): string[] {
  return state.members.filter((m) => m.user_id === DEMO_USER_ID).map((m) => m.group_id);
}

function withMembers(group: GroupRow): GroupWithMembers {
  return {
    ...group,
    members: state.members
      .filter((m) => m.group_id === group.id)
      .map((m) => ({ ...m, user: USERS[m.user_id] ?? USERS[DEMO_USER_ID]! })),
  };
}

function withPositions(bet: BetRow, includeGroup = false): BetWithPositions {
  const group = state.groups.find((g) => g.id === bet.group_id);
  return {
    ...bet,
    positions: state.positions
      .filter((p) => p.bet_id === bet.id)
      .map((p) => ({ user_id: p.user_id, side: p.side })),
    ...(includeGroup && group
      ? { group: { id: group.id, name: group.name, emoji: group.emoji } }
      : {}),
  };
}

const byNewest = (a: { created_at: string }, b: { created_at: string }) =>
  b.created_at.localeCompare(a.created_at);

// --- The fake API -----------------------------------------------------------

export const demo = {
  async fetchMyGroups(): Promise<GroupWithMembers[]> {
    const ids = myGroupIds();
    return clone(state.groups.filter((g) => ids.includes(g.id)).sort(byNewest).map(withMembers));
  },

  async fetchGroup(groupId: string): Promise<GroupWithMembers> {
    const group = state.groups.find((g) => g.id === groupId);
    if (!group) throw new Error('Group not found');
    return clone(withMembers(group));
  },

  async createGroup(name: string, emoji: string | null): Promise<GroupRow> {
    const group: GroupRow = {
      id: `demo-group-${state.groups.length + 1}-${Date.now()}`,
      name,
      emoji,
      created_by: DEMO_USER_ID,
      invite_code: randomCode(),
      created_at: new Date().toISOString(),
    };
    state.groups.push(group);
    state.members.push({
      group_id: group.id,
      user_id: DEMO_USER_ID,
      role: 'admin',
      joined_at: group.created_at,
    });
    return clone(group);
  },

  async joinGroupWithCode(code: string): Promise<GroupRow> {
    const group = state.groups.find(
      (g) => g.invite_code.toUpperCase() === code.trim().toUpperCase()
    );
    if (!group) throw new Error('No group found for that invite code');
    if (!state.members.some((m) => m.group_id === group.id && m.user_id === DEMO_USER_ID)) {
      state.members.push({
        group_id: group.id,
        user_id: DEMO_USER_ID,
        role: 'member',
        joined_at: new Date().toISOString(),
      });
    }
    return clone(group);
  },

  async leaveGroup(groupId: string, userId: string): Promise<void> {
    state.members = state.members.filter(
      (m) => !(m.group_id === groupId && m.user_id === userId)
    );
  },

  async fetchGroupBets(groupId: string): Promise<BetWithPositions[]> {
    return clone(
      state.bets
        .filter((b) => b.group_id === groupId)
        .sort(byNewest)
        .map((b) => withPositions(b))
    );
  },

  async fetchFeedBets(): Promise<BetWithPositions[]> {
    const ids = myGroupIds();
    return clone(
      state.bets
        .filter((b) => ids.includes(b.group_id) && (b.status === 'open' || b.status === 'locked'))
        .sort(byNewest)
        .map((b) => withPositions(b, true))
    );
  },

  async fetchBet(betId: string): Promise<BetWithPositions> {
    const bet = state.bets.find((b) => b.id === betId);
    if (!bet) throw new Error('Bet not found');
    return clone(withPositions(bet, true));
  },

  async createBet(input: NewBetInput): Promise<BetRow> {
    const bet: BetRow = {
      id: `demo-bet-${Date.now()}`,
      group_id: input.groupId,
      creator_id: DEMO_USER_ID,
      title: input.title,
      description: input.description,
      option_a_label: input.optionALabel,
      option_b_label: input.optionBLabel,
      total_pot_agorot: input.totalPotAgorot,
      status: 'open',
      winning_option: null,
      close_at: input.closeAt,
      created_at: new Date().toISOString(),
      resolved_at: null,
    };
    state.bets.push(bet);
    return clone(bet);
  },

  async joinBet(betId: string, side: BetSide): Promise<void> {
    const existing = state.positions.find(
      (p) => p.bet_id === betId && p.user_id === DEMO_USER_ID
    );
    if (existing) existing.side = side;
    else state.positions.push({ bet_id: betId, user_id: DEMO_USER_ID, side });
  },

  async leaveBet(betId: string): Promise<void> {
    state.positions = state.positions.filter(
      (p) => !(p.bet_id === betId && p.user_id === DEMO_USER_ID)
    );
  },

  async lockBet(betId: string): Promise<void> {
    const bet = state.bets.find((b) => b.id === betId);
    if (bet) bet.status = 'locked';
  },

  async cancelBet(betId: string): Promise<void> {
    const bet = state.bets.find((b) => b.id === betId);
    if (bet) bet.status = 'cancelled';
  },

  /** Runs the real payout maths, so the demo cannot drift from production. */
  async resolveBet(betId: string, winningOption: BetSide): Promise<ResolveBetResult> {
    const bet = state.bets.find((b) => b.id === betId);
    if (!bet) throw new Error('Bet not found');

    const participants = state.positions
      .filter((p) => p.bet_id === betId)
      .map((p) => ({ userId: p.user_id, side: p.side }));

    const payout = computeBetPayouts(bet.total_pot_agorot, participants, winningOption);

    bet.status = 'resolved';
    bet.winning_option = winningOption;
    bet.resolved_at = new Date().toISOString();

    for (const entry of payout.entries) {
      state.ledger.push({
        id: `demo-ledger-${betId}-${entry.userId}`,
        bet_id: betId,
        group_id: bet.group_id,
        user_id: entry.userId,
        amount_agorot: entry.amountAgorot,
        created_at: bet.resolved_at,
      });
    }

    return {
      paidOut: payout.paidOut,
      winnerCount: payout.winnerCount,
      loserCount: payout.loserCount,
    };
  },

  async fetchGroupBalances(groupId: string): Promise<GroupBalanceRow[]> {
    const totals = new Map<string, number>();
    for (const member of state.members.filter((m) => m.group_id === groupId)) {
      totals.set(member.user_id, 0);
    }
    for (const entry of state.ledger.filter((e) => e.group_id === groupId)) {
      totals.set(entry.user_id, (totals.get(entry.user_id) ?? 0) + entry.amount_agorot);
    }
    // A confirmed payment moves the payer up and the payee down.
    for (const s of state.settlements.filter((s) => s.group_id === groupId)) {
      totals.set(s.from_user_id, (totals.get(s.from_user_id) ?? 0) + s.amount_agorot);
      totals.set(s.to_user_id, (totals.get(s.to_user_id) ?? 0) - s.amount_agorot);
    }
    return [...totals.entries()].map(([user_id, amount_agorot]) => ({ user_id, amount_agorot }));
  },

  async fetchSettlementConfirmations(groupId: string): Promise<SettlementConfirmationRow[]> {
    return clone(state.settlements.filter((s) => s.group_id === groupId));
  },

  async confirmSettlement(input: {
    groupId: string;
    fromUserId: string;
    toUserId: string;
    amountAgorot: number;
    confirmedBy: string;
  }): Promise<void> {
    state.settlements.push({
      id: `demo-settlement-${Date.now()}`,
      group_id: input.groupId,
      from_user_id: input.fromUserId,
      to_user_id: input.toUserId,
      amount_agorot: input.amountAgorot,
      confirmed_by: input.confirmedBy,
      created_at: new Date().toISOString(),
    });
  },

  async undoSettlement(confirmationId: string): Promise<void> {
    state.settlements = state.settlements.filter((s) => s.id !== confirmationId);
  },

  async fetchBetLedger(betId: string): Promise<BetLedgerEntryRow[]> {
    return clone(state.ledger.filter((e) => e.bet_id === betId));
  },

  async fetchMyHistory(userId: string): Promise<HistoryEntry[]> {
    return clone(
      state.ledger
        .filter((e) => e.user_id === userId)
        .sort(byNewest)
        .map((entry) => {
          const bet = state.bets.find((b) => b.id === entry.bet_id)!;
          const group = state.groups.find((g) => g.id === entry.group_id)!;
          return {
            id: entry.id,
            amount_agorot: entry.amount_agorot,
            created_at: entry.created_at,
            bet: {
              id: bet.id,
              title: bet.title,
              winning_option: bet.winning_option,
              option_a_label: bet.option_a_label,
              option_b_label: bet.option_b_label,
              resolved_at: bet.resolved_at,
            },
            group: { id: group.id, name: group.name, emoji: group.emoji },
          };
        })
    );
  },

  async fetchMyStats(): Promise<MyStatsRow> {
    const mine = state.ledger.filter((e) => e.user_id === DEMO_USER_ID);
    const won = mine.filter((e) => e.amount_agorot > 0);
    const lost = mine.filter((e) => e.amount_agorot < 0);

    const perGroup = new Map<string, number>();
    for (const p of state.positions.filter((p) => p.user_id === DEMO_USER_ID)) {
      const bet = state.bets.find((b) => b.id === p.bet_id);
      if (bet) perGroup.set(bet.group_id, (perGroup.get(bet.group_id) ?? 0) + 1);
    }
    const mostActive = [...perGroup.entries()].sort((a, b) => b[1] - a[1])[0];

    return {
      total_won_agorot: won.reduce((sum, e) => sum + e.amount_agorot, 0),
      total_lost_agorot: -lost.reduce((sum, e) => sum + e.amount_agorot, 0),
      bets_won: won.length,
      bets_lost: lost.length,
      bets_settled: mine.length,
      most_active_group_id: mostActive?.[0] ?? null,
    };
  },

  async updateProfile(patch: Partial<UserRow>): Promise<UserRow> {
    state.profile = { ...state.profile, ...patch };
    return clone(state.profile);
  },

  currentProfile(): UserRow {
    return clone(state.profile);
  },
};

function randomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(
    { length: 6 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)]
  ).join('');
}
