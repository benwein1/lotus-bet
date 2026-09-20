/**
 * TEMPORARY: offline demo mode.
 *
 * Lets you open the app and click through every screen without a Supabase
 * project, an email provider, or a network connection. Nothing here touches the
 * backend — it is an in-memory fake that mirrors the shape of `queries.ts`.
 *
 * This is scaffolding for looking at the UI, not a product feature. To remove
 * it: delete this file and `src/components/demo-entry.tsx`, then grep for
 * `isDemoMode`, `DemoEntry` and `DemoBadge` — every call site is a one-liner.
 *
 * Two things keep it honest:
 * - Resolving a bet runs the real `computeBetPayouts`, so the demo exercises
 *   the actual money maths rather than a second implementation of it.
 * - The entry point only renders in development (see `DEMO_AVAILABLE`).
 */
import type { PickedMedia } from './media';
import { DEFAULT_CURRENCY, asCurrency } from './currency';
import { computeBetPayouts } from './payout';
import { personBalances } from './settlement';
import type {
  BetComment,
  BetCommentRow,
  BlockedUser,
  BetLedgerEntryRow,
  BetLikeRow,
  BetOptionRow,
  BetMedia,
  BetRow,
  BetSide,
  BetDetail,
  BetWithPositions,
  GroupBalanceRow,
  GroupInviteRow,
  GroupMemberRow,
  GroupRow,
  MyStatsRow,
  PersonBalance,
  UserLookup,
  SettlementConfirmationRow,
  UserRow,
} from './database.types';
import type {
  CurrencyTotal,
  GroupWithMembers,
  HistoryEntry,
  NewBetInput,
  ResolveBetResult,
} from './queries';

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

/**
 * @param fresh Start with no groups and no bets — a brand new account.
 *
 * The first-run screens are the hardest part of the app to look at, because
 * every other way in has data. Without this there is no way to see them
 * short of making a real account against a real project.
 */
export function enableDemoMode(fresh = false): void {
  active = true;
  reset(fresh);
}

export function disableDemoMode(): void {
  active = false;
}

// --- Cast of characters -----------------------------------------------------

export const DEMO_USER_ID = 'demo-0000-0000-0000-000000000001';
const DOR = 'demo-0000-0000-0000-000000000002';
const NOA = 'demo-0000-0000-0000-000000000003';
const YOSSI = 'demo-0000-0000-0000-000000000004';

function user(id: string, name: string, email: string): UserRow {
  return {
    id,
    email,
    phone: null,
    display_name: name,
    // The handle other people would challenge them by, derived the same way
    // the migration's backfill does it.
    username: email.split('@')[0],
    profile_completed: true,
    avatar_url: null,
    expo_push_token: null,
    notify_new_bets: true,
    notify_resolutions: true,
    notify_group_joins: true,
    notify_deadlines: true,
    created_at: '2026-08-01T10:00:00Z',
  };
}

const USERS: Record<string, UserRow> = {
  [DEMO_USER_ID]: user(DEMO_USER_ID, 'You', 'you@betta.demo'),
  [DOR]: user(DOR, 'Dor Levi', 'dor@betta.demo'),
  [NOA]: user(NOA, 'Noa Bar', 'noa@betta.demo'),
  [YOSSI]: user(YOSSI, 'Yossi Cohen', 'yossi@betta.demo'),
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
    email: demoProfile.email,
    app_metadata: {},
    user_metadata: {},
    created_at: demoProfile.created_at,
  },
} as const;

// --- Mutable world ----------------------------------------------------------

/**
 * Demo media is inlined as SVG data URIs rather than fetched: demo mode has to
 * work with no network at all, and a broken image tile would say more about
 * the demo than about the design.
 */
const DEMO_IMAGE = {
  pitch: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMjAwIDE1MDAiPjxkZWZzPjxsaW5lYXJHcmFkaWVudCBpZD0iZyIgeDE9IjAiIHkxPSIwIiB4Mj0iMSIgeTI9IjEiPjxzdG9wIG9mZnNldD0iMCIgc3RvcC1jb2xvcj0iIzBCM0IyRSIvPjxzdG9wIG9mZnNldD0iMC41NSIgc3RvcC1jb2xvcj0iIzBBMkE0NiIvPjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iIzA1MDgwRiIvPjwvbGluZWFyR3JhZGllbnQ+PHJhZGlhbEdyYWRpZW50IGlkPSJyIiBjeD0iMC4zIiBjeT0iMC4yNSIgcj0iMC44Ij48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNmZmZmZmYiIHN0b3Atb3BhY2l0eT0iMC4yMiIvPjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iI2ZmZmZmZiIgc3RvcC1vcGFjaXR5PSIwIi8+PC9yYWRpYWxHcmFkaWVudD48L2RlZnM+PHJlY3Qgd2lkdGg9IjEyMDAiIGhlaWdodD0iMTUwMCIgZmlsbD0idXJsKCNnKSIvPjxyZWN0IHdpZHRoPSIxMjAwIiBoZWlnaHQ9IjE1MDAiIGZpbGw9InVybCgjcikiLz48Y2lyY2xlIGN4PSI2MjAiIGN5PSI3MDAiIHI9IjMwMCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmZmZmIiBzdHJva2Utb3BhY2l0eT0iMC4xNCIgc3Ryb2tlLXdpZHRoPSI2Ii8+PHJlY3QgeD0iMTgwIiB5PSIxMDgwIiB3aWR0aD0iODQwIiBoZWlnaHQ9IjMyMCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmZmZmIiBzdHJva2Utb3BhY2l0eT0iMC4xMiIgc3Ryb2tlLXdpZHRoPSI2Ii8+PHBhdGggZD0iTTAgMzAwIEwxMjAwIDEyMCIgc3Ryb2tlPSIjZmZmZmZmIiBzdHJva2Utb3BhY2l0eT0iMC4wOCIgc3Ryb2tlLXdpZHRoPSI0Ii8+PHRleHQgeD0iNjAwIiB5PSI4MjAiIGZvbnQtZmFtaWx5PSItYXBwbGUtc3lzdGVtLEhlbHZldGljYSxBcmlhbCxzYW5zLXNlcmlmIiBmb250LXNpemU9IjM2MCIgZm9udC13ZWlnaHQ9IjcwMCIgZmlsbD0iI2ZmZmZmZiIgZmlsbC1vcGFjaXR5PSIwLjE2IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5GUkk8L3RleHQ+PC9zdmc+',
  boiler: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMjAwIDE1MDAiPjxkZWZzPjxsaW5lYXJHcmFkaWVudCBpZD0iZyIgeDE9IjAiIHkxPSIwIiB4Mj0iMSIgeTI9IjEiPjxzdG9wIG9mZnNldD0iMCIgc3RvcC1jb2xvcj0iIzJCMjAzNiIvPjxzdG9wIG9mZnNldD0iMC41IiBzdG9wLWNvbG9yPSIjM0EyMTMwIi8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjMTIwQzE2Ii8+PC9saW5lYXJHcmFkaWVudD48cmFkaWFsR3JhZGllbnQgaWQ9InIiIGN4PSIwLjMiIGN5PSIwLjI1IiByPSIwLjgiPjxzdG9wIG9mZnNldD0iMCIgc3RvcC1jb2xvcj0iI2ZmZmZmZiIgc3RvcC1vcGFjaXR5PSIwLjIyIi8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjZmZmZmZmIiBzdG9wLW9wYWNpdHk9IjAiLz48L3JhZGlhbEdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iMTIwMCIgaGVpZ2h0PSIxNTAwIiBmaWxsPSJ1cmwoI2cpIi8+PHJlY3Qgd2lkdGg9IjEyMDAiIGhlaWdodD0iMTUwMCIgZmlsbD0idXJsKCNyKSIvPjxjaXJjbGUgY3g9Ijg4MCIgY3k9IjM2MCIgcj0iMjMwIiBmaWxsPSIjZmZmZmZmIiBmaWxsLW9wYWNpdHk9IjAuMDciLz48Y2lyY2xlIGN4PSIzMDAiIGN5PSIxMTgwIiByPSIzNDAiIGZpbGw9IiNmZmZmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSIvPjxwYXRoIGQ9Ik0yNDAgNjQwIGg3MjAiIHN0cm9rZT0iI2ZmZmZmZiIgc3Ryb2tlLW9wYWNpdHk9IjAuMTIiIHN0cm9rZS13aWR0aD0iOCIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+PHRleHQgeD0iNjAwIiB5PSI4MjAiIGZvbnQtZmFtaWx5PSItYXBwbGUtc3lzdGVtLEhlbHZldGljYSxBcmlhbCxzYW5zLXNlcmlmIiBmb250LXNpemU9IjM2MCIgZm9udC13ZWlnaHQ9IjcwMCIgZmlsbD0iI2ZmZmZmZiIgZmlsbC1vcGFjaXR5PSIwLjE2IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj40QjwvdGV4dD48L3N2Zz4=',
} as const;

function demoMedia(id: string, betId: string, groupId: string, url: string): BetMedia {
  return {
    id,
    bet_id: betId,
    group_id: groupId,
    uploaded_by: DEMO_USER_ID,
    kind: 'image',
    storage_path: url,
    url,
    width: 1200,
    height: 1500,
    duration_ms: null,
    position: 0,
    created_at: '2026-09-01T10:00:00Z',
  };
}

interface DemoState {
  groups: GroupRow[];
  members: GroupMemberRow[];
  invites: GroupInviteRow[];
  bets: BetRow[];
  options: BetOptionRow[];
  media: BetMedia[];
  positions: { bet_id: string; user_id: string; side: BetSide | null; option_id: string }[];
  ledger: BetLedgerEntryRow[];
  settlements: SettlementConfirmationRow[];
  likes: BetLikeRow[];
  comments: BetCommentRow[];
  /** Ids this demo user has blocked. Reset with the rest of the state. */
  blocked: string[];
  profile: UserRow;
}

let state: DemoState = withOptions(seed());

function reset(fresh = false): void {
  state = fresh ? emptySeed() : withOptions(seed());
}

/**
 * Give every seeded bet its options and point every seeded position at one.
 *
 * The database does this with two triggers — `bets_seed_options` and
 * `bet_positions_fill_option` — so the demo does it here rather than making
 * the seed literal spell out an option id nine times. Same rule, same result:
 * the first two options come from the label columns, and a position's letter
 * picks the option in that slot.
 */
function withOptions(seeded: SeededState): DemoState {
  const options: BetOptionRow[] = seeded.bets.flatMap((bet) =>
    [bet.option_a_label, bet.option_b_label, ...(seeded.extraOptions[bet.id] ?? [])].map(
      (label, position) => ({
        id: `${bet.id}-opt-${position}`,
        bet_id: bet.id,
        position,
        label,
        created_at: bet.created_at,
      })
    )
  );

  return {
    ...seeded,
    options,
    positions: seeded.positions.map(({ optionIndex, ...p }) => ({
      ...p,
      // `side` names the first two options and nothing else, which is exactly
      // the limit the real column has; past those the seed says which.
      option_id: `${p.bet_id}-opt-${optionIndex ?? (p.side === 'a' ? 0 : 1)}`,
    })),
    bets: seeded.bets.map((bet) => ({
      ...bet,
      winning_option_id: bet.winning_option
        ? `${bet.id}-opt-${bet.winning_option === 'a' ? 0 : 1}`
        : null,
    })),
  };
}

/** A signed-up account that has not done anything yet. */
function emptySeed(): DemoState {
  return {
    profile: { ...demoProfile },
    groups: [],
    members: [],
    invites: [],
    bets: [],
    options: [],
    positions: [],
    ledger: [],
    settlements: [],
    likes: [],
    comments: [],
    blocked: [],
    media: [],
  };
}

type SeededState = Omit<DemoState, 'options' | 'positions'> & {
  positions: {
    bet_id: string;
    user_id: string;
    side: BetSide;
    /** Which option, when it is one the `side` letter cannot name. */
    optionIndex?: number;
  }[];
  /**
   * Options past the first two, by bet id.
   *
   * The label columns carry options one and two and `bet_options` is the real
   * list — §1's rule, mirrored here. Without this the demo could only ever
   * describe two-option bets, so the stacked bar and its legend, which is what
   * the app draws past two, had no way to appear on any screen the design loop
   * can open.
   */
  extraOptions: Record<string, string[]>;
};

function seed(): SeededState {
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
        currency: 'USD',
        created_at: iso(-24 * 30),
      },
      {
        id: 'demo-group-2',
        name: 'Flat 4B',
        emoji: '🏠',
        created_by: DEMO_USER_ID,
        invite_code: 'PL9WTZ',
        // Deliberately not the same as the other group's. Two currencies is
        // the case nothing else in the design loop can show — the profile
        // stacking one lifetime figure per currency, and a person appearing in
        // "who owes who" once per currency, only exist when they differ.
        currency: 'ILS',
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
    invites: [],
    extraOptions: { 'demo-bet-5': ['Yossi'] },
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
        id: 'demo-bet-5',
        group_id: groupId,
        creator_id: NOA,
        // Three options, which is the branch two-option bets never reach: the
        // bar becomes a stacked track with a legend instead of a figure at
        // each end. Nothing else in the demo draws it.
        title: 'Who pays for the pitch next week?',
        description: null,
        option_a_label: 'Dor',
        option_b_label: 'Noa',
        total_pot_agorot: 2000,
        status: 'open',
        winning_option: null,
        close_at: iso(30),
        created_at: iso(-4),
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
    media: [
      demoMedia('demo-media-1', 'demo-bet-1', groupId, DEMO_IMAGE.pitch),
      demoMedia('demo-media-2', 'demo-bet-3', 'demo-group-2', DEMO_IMAGE.boiler),
    ],
    positions: [
      { bet_id: 'demo-bet-1', user_id: DEMO_USER_ID, side: 'a' },
      { bet_id: 'demo-bet-1', user_id: DOR, side: 'b' },
      { bet_id: 'demo-bet-1', user_id: NOA, side: 'b' },
      { bet_id: 'demo-bet-2', user_id: DOR, side: 'a' },
      { bet_id: 'demo-bet-3', user_id: DEMO_USER_ID, side: 'b' },
      { bet_id: 'demo-bet-3', user_id: NOA, side: 'a' },
      { bet_id: 'demo-bet-5', user_id: DOR, side: 'a' },
      { bet_id: 'demo-bet-5', user_id: NOA, side: 'b' },
      { bet_id: 'demo-bet-5', user_id: YOSSI, side: 'a', optionIndex: 2 },
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
    likes: [],
    // A couple of remarks from other people, so the thread is not empty and —
    // more to the point — so there is somebody else's comment to long-press.
    // Report and block are unreachable in a demo where every comment is yours.
    comments: [
      {
        id: 'demo-comment-1',
        bet_id: 'demo-bet-1',
        user_id: DOR,
        body: 'He has been late every single week this season.',
        created_at: iso(-2),
      },
      {
        id: 'demo-comment-2',
        bet_id: 'demo-bet-1',
        user_id: NOA,
        body: 'Give him a chance, he set three alarms.',
        created_at: iso(-1),
      },
    ],
    blocked: [],
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
    options: state.options
      .filter((o) => o.bet_id === bet.id)
      .sort((a, b) => a.position - b.position),
    positions: state.positions
      .filter((p) => p.bet_id === bet.id)
      .map((p) => ({ user_id: p.user_id, side: p.side, option_id: p.option_id })),
    media: state.media
      .filter((m) => m.bet_id === bet.id)
      .sort((a, b) => a.position - b.position),
    likes: state.likes
      .filter((l) => l.bet_id === bet.id)
      .map((l) => ({ user_id: l.user_id })),
    comments: [{ count: state.comments.filter((c) => c.bet_id === bet.id).length }],
    // The creator, so the demo exercises the same card path real data does.
    // Without it the credit line under the group name simply never renders
    // here and the one surface the design loop can actually look at is the one
    // surface that cannot show the feature.
    creator: (() => {
      const u: UserRow | undefined = USERS[bet.creator_id];
      return u
        ? {
            id: u.id,
            display_name: u.display_name,
            username: u.username ?? null,
            avatar_url: u.avatar_url,
          }
        : null;
    })(),
    ...(includeGroup && group
      ? {
          group: {
            id: group.id,
            name: group.name,
            emoji: group.emoji,
            currency: group.currency ?? 'USD',
          },
        }
      : {}),
  };
}

const byNewest = (a: { created_at: string }, b: { created_at: string }) =>
  b.created_at.localeCompare(a.created_at);

// --- The fake API -----------------------------------------------------------

export const demo = {
  async fetchMyGroups(): Promise<GroupWithMembers[]> {
    const ids = myGroupIds();
    return clone(
      state.groups
        .filter((g) => ids.includes(g.id) && g.kind !== 'duel')
        .sort(byNewest)
        .map(withMembers)
    );
  },

  async fetchGroup(groupId: string): Promise<GroupWithMembers> {
    const group = state.groups.find((g) => g.id === groupId);
    if (!group) throw new Error('Group not found');
    return clone(withMembers(group));
  },

  async createGroup(
    name: string,
    emoji: string | null,
    currency: string = DEFAULT_CURRENCY
  ): Promise<GroupRow> {
    const group: GroupRow = {
      id: `demo-group-${state.groups.length + 1}-${Date.now()}`,
      name,
      emoji,
      avatar_url: null,
      created_by: DEMO_USER_ID,
      invite_code: randomCode(),
      currency,
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

  async updateGroupAvatar(groupId: string, avatarUrl: string | null): Promise<GroupRow> {
    const group = state.groups.find((g) => g.id === groupId);
    if (!group) throw new Error('Group not found');
    group.avatar_url = avatarUrl;
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

  async createGroupInvite(groupId: string): Promise<GroupInviteRow> {
    const group = state.groups.find((g) => g.id === groupId);
    if (!group) throw new Error('Group not found');
    if (group.kind === 'duel') throw new Error('A one-on-one challenge cannot be shared');

    // Same reuse rule as the real RPC, so the demo cannot show behaviour the
    // backend does not have.
    const live = state.invites.find(
      (i) =>
        i.group_id === groupId &&
        i.revoked_at === null &&
        new Date(i.expires_at).getTime() > Date.now()
    );
    if (live) return clone(live);

    const invite: GroupInviteRow = {
      id: `invite-${state.invites.length + 1}`,
      group_id: groupId,
      token: `demo${Math.random().toString(36).slice(2, 10)}`,
      created_by: DEMO_USER_ID,
      expires_at: new Date(Date.now() + 7 * 24 * 3_600_000).toISOString(),
      revoked_at: null,
      max_uses: null,
      uses: 0,
      created_at: new Date().toISOString(),
    };
    state.invites.push(invite);
    return clone(invite);
  },

  async revokeGroupInvite(token: string): Promise<void> {
    const invite = state.invites.find((i) => i.token === token);
    if (invite) invite.revoked_at = new Date().toISOString();
  },

  async joinGroupWithInvite(token: string): Promise<GroupRow> {
    const invite = state.invites.find((i) => i.token === token.trim());
    if (!invite) throw new Error('That invite link is not valid');
    if (invite.revoked_at) throw new Error('That invite link was cancelled');
    if (new Date(invite.expires_at).getTime() <= Date.now()) {
      throw new Error('That invite link has expired');
    }

    const group = state.groups.find((g) => g.id === invite.group_id);
    if (!group) throw new Error('That group no longer exists');

    if (!state.members.some((m) => m.group_id === group.id && m.user_id === DEMO_USER_ID)) {
      state.members.push({
        group_id: group.id,
        user_id: DEMO_USER_ID,
        role: 'member',
        joined_at: new Date().toISOString(),
      });
      invite.uses += 1;
    }
    return clone(group);
  },

  async fetchMyBets(userId: string, limit: number): Promise<BetWithPositions[]> {
    return clone(
      state.bets
        .filter((b) => b.creator_id === userId)
        .sort(byNewest)
        .slice(0, limit)
        .map((b) => withPositions(b))
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

  async fetchBet(betId: string): Promise<BetDetail> {
    const bet = state.bets.find((b) => b.id === betId);
    if (!bet) throw new Error('Bet not found');

    // The real `fetchBet` embeds the group's members and the ledger so the bet
    // screen costs one round trip rather than three. Demo has to hand back the
    // same shape or the rosters and the payout line render empty here and only
    // here — exactly the kind of drift that makes the demo lie.
    const group = state.groups.find((g) => g.id === bet.group_id);
    const base = withPositions(bet, true);

    return clone({
      ...base,
      ledger: state.ledger.filter((entry) => entry.bet_id === bet.id),
      ...(group
        ? {
            group: {
              id: group.id,
              name: group.name,
              emoji: group.emoji,
              members: withMembers(group).members,
            },
          }
        : {}),
    } as BetDetail);
  },

  async createBet(input: NewBetInput): Promise<BetRow> {
    const labels = input.optionLabels.map((l) => l.trim()).filter(Boolean);
    if (labels.length < 2) throw new Error('A bet needs at least two options.');

    const id = `demo-bet-${Date.now()}`;
    const bet: BetRow = {
      id,
      group_id: input.groupId,
      creator_id: DEMO_USER_ID,
      title: input.title,
      description: input.description,
      option_a_label: labels[0]!,
      option_b_label: labels[1]!,
      total_pot_agorot: input.totalPotAgorot,
      status: 'open',
      winning_option: null,
      winning_option_id: null,
      close_at: input.closeAt,
      created_at: new Date().toISOString(),
      resolved_at: null,
    };
    state.bets.push(bet);
    // Mirrors the database trigger: the first two labels become options 0 and
    // 1, and anything beyond follows.
    labels.forEach((label, index) => {
      state.options.push({
        id: `${id}-opt-${index}`,
        bet_id: id,
        position: index,
        label,
        created_at: bet.created_at,
      });
    });

    // The picked file URIs render straight from the device, so a bet posted in
    // demo mode shows its attachments the same way a real one would.
    (input.media ?? []).forEach((item, index) => {
      state.media.push({
        id: `demo-media-${bet.id}-${index}`,
        bet_id: bet.id,
        group_id: bet.group_id,
        uploaded_by: DEMO_USER_ID,
        kind: item.kind,
        purpose: 'attachment',
        storage_path: item.uri,
        url: item.uri,
        width: item.width,
        height: item.height,
        duration_ms: item.durationMs,
        position: index,
        created_at: bet.created_at,
      });
    });

    return clone(bet);
  },

  async addBetProof(
    betId: string,
    media: PickedMedia[],
    existingProofCount: number
  ): Promise<void> {
    const bet = state.bets.find((b) => b.id === betId);
    if (!bet) throw new Error('Bet not found');
    // The real policy refuses this; the demo has to refuse it too, or the
    // offline build shows behaviour the backend does not have.
    if (bet.status !== 'resolved') {
      throw new Error('Proof can only be added once the bet is resolved.');
    }

    media.forEach((item, index) => {
      state.media.push({
        id: `demo-proof-${betId}-${existingProofCount + index}-${Date.now()}`,
        bet_id: betId,
        group_id: bet.group_id,
        uploaded_by: DEMO_USER_ID,
        kind: item.kind,
        purpose: 'proof',
        storage_path: item.uri,
        url: item.uri,
        width: item.width,
        height: item.height,
        duration_ms: item.durationMs,
        position: existingProofCount + index,
        created_at: new Date().toISOString(),
      });
    });
  },

  async deleteBetMedia(mediaId: string): Promise<void> {
    state.media = state.media.filter((m) => m.id !== mediaId);
  },

  async joinBetOption(betId: string, optionId: string): Promise<void> {
    const option = state.options.find((o) => o.id === optionId && o.bet_id === betId);
    if (!option) throw new Error('That option does not belong to this bet');

    const side = option.position === 0 ? 'a' : option.position === 1 ? 'b' : null;
    const existing = state.positions.find(
      (p) => p.bet_id === betId && p.user_id === DEMO_USER_ID
    );
    if (existing) {
      existing.option_id = optionId;
      existing.side = side;
    } else {
      state.positions.push({
        bet_id: betId,
        user_id: DEMO_USER_ID,
        option_id: optionId,
        side,
      });
    }
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
  async resolveBet(betId: string, winningOptionId: string): Promise<ResolveBetResult> {
    const bet = state.bets.find((b) => b.id === betId);
    if (!bet) throw new Error('Bet not found');

    const participants = state.positions
      .filter((p) => p.bet_id === betId)
      .map((p) => ({ userId: p.user_id, side: p.option_id }));

    const payout = computeBetPayouts(bet.total_pot_agorot, participants, winningOptionId);

    const winner = state.options.find((o) => o.id === winningOptionId);
    bet.status = 'resolved';
    bet.winning_option_id = winningOptionId;
    bet.winning_option = winner?.position === 0 ? 'a' : winner?.position === 1 ? 'b' : null;
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

  // --- Moderation ---------------------------------------------------------
  // Reports go nowhere by design: there is no queue to read them and no
  // moderator to act, so recording them would only make the demo look like it
  // has a backend it does not have. Blocking is real, because its effect is
  // visible on screen and that is the point of being able to click through it.
  async reportContent(_kind: string, _targetId: string, _reason: string): Promise<void> {},

  // Demo state is in memory and is thrown away on sign-out anyway, so the
  // honest thing is to do nothing and let the caller's sign-out clear it.
  async deleteAccount(): Promise<void> {},

  async blockUser(userId: string): Promise<void> {
    if (userId === state.profile.id) throw new Error('You cannot block yourself.');
    if (!state.blocked.includes(userId)) state.blocked.push(userId);
  },

  async unblockUser(userId: string): Promise<void> {
    state.blocked = state.blocked.filter((id) => id !== userId);
  },

  async fetchBlockedUsers(): Promise<BlockedUser[]> {
    return clone(
      state.blocked
        .map((id) => USERS[id])
        .filter((u): u is NonNullable<typeof u> => Boolean(u))
        .map((u) => ({
          id: u.id,
          display_name: u.display_name,
          username: u.username ?? null,
          avatar_url: u.avatar_url ?? null,
        }))
    );
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

  async fetchMyTotalsByCurrency(): Promise<CurrencyTotal[]> {
    const byCurrency = new Map<string, { won: number; lost: number }>();

    for (const entry of state.ledger.filter((e) => e.user_id === DEMO_USER_ID)) {
      const bet = state.bets.find((b) => b.id === entry.bet_id);
      const group = bet ? state.groups.find((g) => g.id === bet.group_id) : undefined;
      const code = asCurrency(group?.currency);

      const totals = byCurrency.get(code) ?? { won: 0, lost: 0 };
      if (entry.amount_agorot > 0) totals.won += entry.amount_agorot;
      else totals.lost += -entry.amount_agorot;
      byCurrency.set(code, totals);
    }

    // Same order as the RPC: the currency with the most movement first, ties
    // broken by name, so the demo cannot show an order the backend will not.
    return [...byCurrency.entries()]
      .map(([currency, t]) => ({
        currency: asCurrency(currency),
        wonAgorot: t.won,
        lostAgorot: t.lost,
        netAgorot: t.won - t.lost,
      }))
      .sort(
        (a, b) =>
          b.wonAgorot + b.lostAgorot - (a.wonAgorot + a.lostAgorot) ||
          a.currency.localeCompare(b.currency)
      );
  },

  async updateProfile(patch: Partial<UserRow>): Promise<UserRow> {
    state.profile = { ...state.profile, ...patch };
    return clone(state.profile);
  },

  async fetchAllMyGroups(): Promise<GroupWithMembers[]> {
    const ids = myGroupIds();
    return clone(state.groups.filter((g) => ids.includes(g.id)).sort(byNewest).map(withMembers));
  },

  async findUserByUsername(username: string): Promise<UserLookup | null> {
    const handle = username.trim().replace(/^@/, '').toLowerCase();
    const match = Object.values(USERS).find(
      (u) => u.id !== DEMO_USER_ID && (u.username ?? '').toLowerCase() === handle
    );
    if (!match) return null;
    return clone({
      id: match.id,
      display_name: match.display_name,
      username: match.username ?? '',
      avatar_url: match.avatar_url,
    });
  },

  async searchUsersByUsername(query: string): Promise<UserLookup[]> {
    const prefix = query.trim().replace(/^@/, '').toLowerCase();
    if (prefix.length < 2) return [];

    // The same shape the RPC has, so the demo cannot teach the screen a
    // behaviour the real backend does not have: prefix rather than contains,
    // self and deleted rows out, shortest handle first, ten at most.
    return clone(
      Object.values(USERS)
        .filter(
          (u) =>
            u.id !== DEMO_USER_ID &&
            !!u.username &&
            u.username.toLowerCase().startsWith(prefix)
        )
        .sort((a, b) => (a.username ?? '').length - (b.username ?? '').length)
        .slice(0, 10)
        .map((u) => ({
          id: u.id,
          display_name: u.display_name,
          username: u.username ?? '',
          avatar_url: u.avatar_url,
        }))
    );
  },

  async createDuel(username: string): Promise<GroupRow> {
    const them = await demo.findUserByUsername(username);
    if (!them) throw new Error('No one is using that username');

    // Same reuse rule as the real RPC: challenging the same person twice must
    // land in the same group or their running total with you fragments.
    const existing = state.groups.find(
      (g) =>
        g.kind === 'duel' &&
        state.members.filter((m) => m.group_id === g.id).length === 2 &&
        state.members.some((m) => m.group_id === g.id && m.user_id === DEMO_USER_ID) &&
        state.members.some((m) => m.group_id === g.id && m.user_id === them.id)
    );
    if (existing) return clone(existing);

    const group: GroupRow = {
      id: `demo-duel-${Date.now()}`,
      name: `${state.profile.display_name} v ${them.display_name}`,
      emoji: '⚔️',
      kind: 'duel',
      created_by: DEMO_USER_ID,
      invite_code: randomCode(),
      created_at: new Date().toISOString(),
    };
    state.groups.push(group);
    state.members.push(
      { group_id: group.id, user_id: DEMO_USER_ID, role: 'admin', joined_at: group.created_at },
      { group_id: group.id, user_id: them.id, role: 'member', joined_at: group.created_at }
    );
    return clone(group);
  },

  async setBetLike(betId: string, userId: string, liked: boolean): Promise<void> {
    state.likes = state.likes.filter((l) => !(l.bet_id === betId && l.user_id === userId));
    if (liked) {
      state.likes.push({ bet_id: betId, user_id: userId, created_at: new Date().toISOString() });
    }
  },

  async fetchBetComments(betId: string): Promise<BetComment[]> {
    return clone(
      state.comments
        .filter((c) => c.bet_id === betId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((c) => ({ ...c, author: USERS[c.user_id] ?? null }))
    );
  },

  async postBetComment(betId: string, userId: string, body: string): Promise<BetComment> {
    const trimmed = body.trim();
    if (!trimmed) throw new Error('Write something first.');
    const row: BetCommentRow = {
      id: `demo-comment-${Date.now()}`,
      bet_id: betId,
      user_id: userId,
      body: trimmed,
      created_at: new Date().toISOString(),
    };
    state.comments.push(row);
    return clone({ ...row, author: USERS[userId] ?? null });
  },

  async deleteBetComment(commentId: string): Promise<void> {
    state.comments = state.comments.filter((c) => c.id !== commentId);
  },

  async fetchMyPersonBalances(userId: string): Promise<PersonBalance[]> {
    const ledgers = state.groups
      .filter((g) => myGroupIds().includes(g.id))
      .map((group) => ({
        groupId: group.id,
        groupName: group.kind === 'duel' ? 'Just the two of you' : group.name,
        currency: group.currency ?? null,
        balances: state.members
          .filter((m) => m.group_id === group.id)
          .map((m) => ({
            userId: m.user_id,
            amountAgorot:
              state.ledger
                .filter((e) => e.group_id === group.id && e.user_id === m.user_id)
                .reduce((sum, e) => sum + e.amount_agorot, 0) +
              state.settlements
                .filter((s) => s.group_id === group.id && s.from_user_id === m.user_id)
                .reduce((sum, s) => sum + s.amount_agorot, 0) -
              state.settlements
                .filter((s) => s.group_id === group.id && s.to_user_id === m.user_id)
                .reduce((sum, s) => sum + s.amount_agorot, 0),
          })),
      }));

    // The same netting the real path uses, so the demo cannot drift into a
    // second answer for "what do we owe each other".
    return personBalances(ledgers, userId).map((total) => ({
      user: USERS[total.userId] ?? { id: total.userId, display_name: 'Someone', avatar_url: null },
      amountAgorot: total.amountAgorot,
      currency: total.currency,
      groupNames: total.groupNames,
    }));
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
