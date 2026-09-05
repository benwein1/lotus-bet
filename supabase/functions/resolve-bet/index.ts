// POST /functions/v1/resolve-bet  { betId, winningOption }
//
// Declares a winner for a two-outcome bet and writes the resulting ledger
// lines. This runs server-side with the service role because it is the only
// place `bet_ledger_entries` is ever written — clients have read-only access.
//
// The payout maths itself is the unit-tested pure module in
// `../_shared/payout.ts`; nothing money-related is re-derived here.
import {
  computeBetPayouts,
  type BetParticipant,
  type BetSide,
} from '../_shared/payout.ts';
import {
  adminClient,
  corsHeaders,
  errorResponse,
  HttpError,
  json,
  requireUser,
} from '../_shared/supabase.ts';
import { sendPushNotifications, type PushMessage } from '../_shared/push.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await requireUser(req);
    const { betId, winningOption } = (await req.json()) as {
      betId?: string;
      winningOption?: BetSide;
    };

    if (!betId) throw new HttpError(400, 'betId is required');
    if (winningOption !== 'a' && winningOption !== 'b') {
      throw new HttpError(400, "winningOption must be 'a' or 'b'");
    }

    const db = adminClient();

    const { data: bet, error: betError } = await db
      .from('bets')
      .select(
        'id, group_id, creator_id, title, status, total_pot_agorot, option_a_label, option_b_label'
      )
      .eq('id', betId)
      .maybeSingle();

    if (betError) throw betError;
    if (!bet) throw new HttpError(404, 'Bet not found');
    if (bet.creator_id !== user.id) {
      throw new HttpError(403, 'Only the bet creator can resolve it');
    }
    if (bet.status === 'resolved') throw new HttpError(409, 'Bet is already resolved');
    if (bet.status === 'cancelled') throw new HttpError(409, 'Bet was cancelled');

    const { data: positions, error: positionsError } = await db
      .from('bet_positions')
      .select('user_id, side')
      .eq('bet_id', bet.id);

    if (positionsError) throw positionsError;

    const participants: BetParticipant[] = (positions ?? []).map((p) => ({
      userId: p.user_id as string,
      side: p.side as BetSide,
    }));

    const payout = computeBetPayouts(
      bet.total_pot_agorot as number,
      participants,
      winningOption
    );

    if (payout.entries.length > 0) {
      const { error: ledgerError } = await db.from('bet_ledger_entries').insert(
        payout.entries.map((entry) => ({
          bet_id: bet.id,
          group_id: bet.group_id,
          user_id: entry.userId,
          amount_agorot: entry.amountAgorot,
        }))
      );
      // The (bet_id, user_id) unique index makes a double-resolve a no-op
      // rather than a double payout.
      if (ledgerError) throw ledgerError;
    }

    // Flip the bet last: if anything above failed, the bet stays resolvable.
    const { data: resolved, error: updateError } = await db
      .from('bets')
      .update({
        status: 'resolved',
        winning_option: winningOption,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', bet.id)
      .in('status', ['open', 'locked'])
      .select()
      .single();

    if (updateError) throw updateError;

    await notifyParticipants(db, {
      betId: bet.id,
      betTitle: bet.title as string,
      winningLabel:
        winningOption === 'a'
          ? (bet.option_a_label as string)
          : (bet.option_b_label as string),
      entries: payout.entries,
      participants,
      paidOut: payout.paidOut,
    });

    return json({
      bet: resolved,
      paidOut: payout.paidOut,
      winnerCount: payout.winnerCount,
      loserCount: payout.loserCount,
      entries: payout.entries,
    });
  } catch (err) {
    return errorResponse(err);
  }
});

/** Tell everyone who took a side how it went — including the amount. */
async function notifyParticipants(
  db: ReturnType<typeof adminClient>,
  args: {
    betId: string;
    betTitle: string;
    winningLabel: string;
    entries: { userId: string; amountAgorot: number }[];
    participants: BetParticipant[];
    paidOut: boolean;
  }
): Promise<void> {
  const userIds = args.participants.map((p) => p.userId);
  if (userIds.length === 0) return;

  const { data: recipients, error } = await db
    .from('users')
    .select('id, expo_push_token, notify_resolutions')
    .in('id', userIds)
    .eq('notify_resolutions', true)
    .not('expo_push_token', 'is', null);

  if (error) {
    console.error('Could not load push recipients', error);
    return;
  }

  const amountByUser = new Map(
    args.entries.map((e) => [e.userId, e.amountAgorot])
  );

  const messages: PushMessage[] = (recipients ?? []).map((r) => {
    const amount = amountByUser.get(r.id as string) ?? 0;
    return {
      to: r.expo_push_token as string,
      title: `"${args.betTitle}" resolved`,
      body: !args.paidOut
        ? `${args.winningLabel} won, but nobody backed it — no money changes hands.`
        : amount > 0
          ? `${args.winningLabel} won. You're up ${formatIls(amount)}.`
          : amount < 0
            ? `${args.winningLabel} won. You owe ${formatIls(-amount)}.`
            : `${args.winningLabel} won.`,
      data: { type: 'bet_resolved', betId: args.betId },
    };
  });

  await sendPushNotifications(messages);
}

function formatIls(agorot: number): string {
  const ils = agorot / 100;
  return `₪${Number.isInteger(ils) ? ils.toFixed(0) : ils.toFixed(2)}`;
}
