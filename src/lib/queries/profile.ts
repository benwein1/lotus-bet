/**
 * Everything the Profile tab reads: balances, history, authorship, totals.
 *
 * Part of `lib/queries` — see `./index.ts` for why the client’s Supabase
 * access is one place, and `./core.ts` for the shared helpers.
 */
import type {
  BetLedgerEntryRow,
  BetRow,
  BetWithPositions,
  GroupRow,
  MyStatsRow,
  PersonBalance,
} from '../database.types';
import { demo, isDemoMode } from '../demo';
import { asCurrency, type Currency } from '../currency';
import { isMissingFunction } from '../postgrest';
import { personBalances, type BalanceLine } from '../settlement';
import { supabase } from '../supabase';
import { withGroupColumnFallback } from './core';
import { fetchAllMyGroups } from './groups';
import { BET_SELECT, attachSignedMedia } from './bets';

// --- Profile ---------------------------------------------------------------

/**
 * Every person you owe, or who owes you, netted across all of your groups.
 *
 * One round trip for the balances (`my_group_balances`), one for the names.
 * The netting itself is `personBalances`, which runs the same `simplifyDebts`
 * the settle-up screen runs — so a figure here and a figure there can never
 * disagree, which they would within a week if this were reimplemented in SQL.
 */
export async function fetchMyPersonBalances(userId: string): Promise<PersonBalance[]> {
  if (isDemoMode()) return demo.fetchMyPersonBalances(userId);

  const { data, error } = await supabase.rpc('my_group_balances');
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as { group_id: string; user_id: string; amount_agorot: number }[];
  if (rows.length === 0) return [];

  // All of them, duels included: the Groups tab hides duels, but what you owe
  // somebody one-on-one is exactly what this ledger is for.
  const groups = await fetchAllMyGroups();
  const nameByGroup = new Map(
    groups.map((g) => [
      g.id,
      // A duel's stored name is "You v Them", which would read as a stutter
      // beside the row's own heading — which is already their name.
      g.kind === 'duel' ? 'Just the two of you' : g.name,
    ])
  );

  const currencyByGroup = new Map(groups.map((g) => [g.id, g.currency ?? null]));

  const byGroup = new Map<string, BalanceLine[]>();
  for (const row of rows) {
    const lines = byGroup.get(row.group_id) ?? [];
    // `bigint` comes back from PostgREST as a string often enough that every
    // read site coerces it. Keep doing that.
    lines.push({ userId: row.user_id, amountAgorot: Number(row.amount_agorot) });
    byGroup.set(row.group_id, lines);
  }

  const totals = personBalances(
    [...byGroup.entries()].map(([groupId, balances]) => ({
      groupId,
      groupName: nameByGroup.get(groupId) ?? 'A group',
      // Without this every group nets as the default and a dollar group's
      // figure is added to a shekel one. `personBalances` keys on it.
      currency: currencyByGroup.get(groupId) ?? null,
      balances,
    })),
    userId
  );
  if (totals.length === 0) return [];

  const { data: people, error: peopleError } = await supabase
    .from('users')
    .select('id, display_name, avatar_url')
    .in('id', totals.map((t) => t.userId));

  if (peopleError) throw new Error(peopleError.message);
  const byId = new Map((people ?? []).map((p) => [p.id, p]));

  return totals.map((total) => ({
    user: byId.get(total.userId) ?? {
      id: total.userId,
      display_name: 'Someone',
      avatar_url: null,
    },
    amountAgorot: total.amountAgorot,
    currency: total.currency,
    groupNames: total.groupNames,
  }));
}

export interface HistoryEntry {
  id: string;
  amount_agorot: number;
  created_at: string;
  bet: Pick<BetRow, 'id' | 'title' | 'winning_option' | 'option_a_label' | 'option_b_label' | 'resolved_at'>;
  group: Pick<GroupRow, 'id' | 'name' | 'emoji' | 'avatar_url' | 'currency'>;
}

export async function fetchMyHistory(userId: string): Promise<HistoryEntry[]> {
  if (isDemoMode()) return demo.fetchMyHistory(userId);
  const data = await withGroupColumnFallback((extras) =>
    supabase
      .from('bet_ledger_entries')
      .select(
        'id, amount_agorot, created_at, bet:bets(id, title, winning_option, option_a_label, option_b_label, resolved_at), ' +
          `group:groups(id, name, emoji${extras.currency ? ', currency' : ''}${
            extras.avatar ? ', avatar_url' : ''
          })`
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100)
  );

  return (data ?? []) as unknown as HistoryEntry[];
}

/** How many of your own bets the Profile grid asks for at a time. */
export const MY_BETS_PAGE = 30;

/**
 * The bets you started, newest first.
 *
 * Authorship, not participation — `fetchMyHistory` already answers "what have
 * I been in", and this answers "what have I put up", which is the question a
 * profile grid is really asking. A bet you created but never took a side on
 * still belongs to you and still appears.
 *
 * No group filter: your bets span every group you are in, duels included, and
 * RLS decides what comes back the same way it does everywhere else.
 */
export async function fetchMyBets(
  userId: string,
  limit = MY_BETS_PAGE
): Promise<BetWithPositions[]> {
  if (isDemoMode()) return demo.fetchMyBets(userId, limit);

  const { data, error } = await supabase
    .from('bets')
    .select(BET_SELECT)
    .eq('creator_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return attachSignedMedia((data ?? []) as unknown as BetWithPositions[]);
}

/**
 * The bets you took a side on, newest first — the Profile's "Joined" tab.
 *
 * Two round trips rather than one embed, deliberately. `BET_SELECT` already
 * embeds `bet_positions`, so filtering on a second embed of the same table
 * would need an alias PostgREST resolves differently depending on which
 * foreign key it picks, and getting that wrong returns an empty list rather
 * than an error. Asking for the ids first is longer on the wire and impossible
 * to misread. It is also behind a tab rather than on first paint, which is
 * where the embed rule is actually paying for itself.
 */
export async function fetchBetsIJoined(
  userId: string,
  limit = MY_BETS_PAGE
): Promise<BetWithPositions[]> {
  if (isDemoMode()) return demo.fetchBetsIJoined(userId, limit);

  const positions = await supabase
    .from('bet_positions')
    .select('bet_id')
    .eq('user_id', userId)
    // `joined_at`, not `created_at` — see `BET_SELECT`. Naming a column that
    // does not exist does not drop the ordering, it rejects the request, so
    // the Joined tab came back empty rather than unsorted.
    .order('joined_at', { ascending: false })
    .limit(limit);

  if (positions.error) throw new Error(positions.error.message);
  const ids = Array.from(new Set((positions.data ?? []).map((row) => row.bet_id)));
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from('bets')
    .select(BET_SELECT)
    .in('id', ids)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return attachSignedMedia((data ?? []) as unknown as BetWithPositions[]);
}

/** The last words on a bet, as the feed card's footer prints them. */
export interface FeedComment {
  id: string;
  bet_id: string;
  user_id: string;
  body: string;
  created_at: string;
  author: { display_name: string; avatar_url: string | null } | null;
}

/**
 * The newest comments across a page of bets, in one read.
 *
 * The alternative was an embed on `BET_SELECT`, and PostgREST cannot limit an
 * embed per parent — a feed of a hundred bets would come back with every
 * comment on all of them. One flat query ordered newest-first with a hard cap
 * is bounded no matter how loud the groups are; the card takes the last two it
 * was given and the full thread is one tap away either way.
 */
export async function fetchFeedComments(
  betIds: string[],
  cap = 240
): Promise<Map<string, FeedComment[]>> {
  const grouped = new Map<string, FeedComment[]>();
  if (betIds.length === 0) return grouped;
  if (isDemoMode()) return demo.fetchFeedComments(betIds);

  const { data, error } = await supabase
    .from('bet_comments')
    .select('id, bet_id, user_id, body, created_at, author:users(display_name, avatar_url)')
    .in('bet_id', betIds)
    .order('created_at', { ascending: false })
    .limit(cap);

  // A footer that could not load is not worth failing a feed over: the card
  // renders without it and the thread is still one tap away.
  if (error) return grouped;

  for (const row of (data ?? []) as unknown as FeedComment[]) {
    const list = grouped.get(row.bet_id);
    // Oldest first within a bet, so the card can take the last two.
    if (list) list.unshift(row);
    else grouped.set(row.bet_id, [row]);
  }
  return grouped;
}

export async function fetchMyStats(): Promise<MyStatsRow | null> {
  if (isDemoMode()) return demo.fetchMyStats();
  const { data, error } = await supabase.rpc('my_stats');
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as MyStatsRow[];
  return rows[0] ?? null;
}

/** Won and lost, per currency. Normally one row. */
export interface CurrencyTotal {
  currency: Currency;
  wonAgorot: number;
  lostAgorot: number;
  /** Won minus lost, in the same minor units. */
  netAgorot: number;
}

/**
 * Lifetime money, split by what it is denominated in.
 *
 * `my_stats`'s own `total_won_agorot` / `total_lost_agorot` sum across every
 * group regardless of currency, which stopped being a true number the moment a
 * group could be created in dollars. Its *counts* are still read from there,
 * because a bet won is a bet won in any currency — see the head of
 * `…_stats_by_currency.sql`.
 *
 * A project that has not applied that migration has no such function, and this
 * returns an empty list rather than throwing: the profile falls back to
 * `my_stats`, which is exactly right for the all-ILS account such a project
 * necessarily has.
 */
export async function fetchMyTotalsByCurrency(): Promise<CurrencyTotal[]> {
  if (isDemoMode()) return demo.fetchMyTotalsByCurrency();

  const { data, error } = await supabase.rpc('my_totals_by_currency');
  if (error) {
    if (isMissingFunction(error)) return [];
    throw new Error(error.message);
  }

  const rows = (data ?? []) as {
    currency: string;
    total_won_agorot: number;
    total_lost_agorot: number;
  }[];

  // `bigint` arrives as a string from PostgREST often enough that every read
  // site coerces it. Keep doing that.
  return rows.map((row) => {
    const won = Number(row.total_won_agorot);
    const lost = Number(row.total_lost_agorot);
    return { currency: asCurrency(row.currency), wonAgorot: won, lostAgorot: lost, netAgorot: won - lost };
  });
}

/** The signed results the resolve-bet function wrote for one bet. */
export async function fetchBetLedger(betId: string): Promise<BetLedgerEntryRow[]> {
  if (isDemoMode()) return demo.fetchBetLedger(betId);
  const { data, error } = await supabase
    .from('bet_ledger_entries')
    .select('*')
    .eq('bet_id', betId);

  if (error) throw new Error(error.message);
  return (data ?? []) as BetLedgerEntryRow[];
}

