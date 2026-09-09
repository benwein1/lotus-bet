// POST /functions/v1/notify  { kind, betId? , groupId? }
//
// The single fan-out for every push the app sends. One function rather than
// one per event: they all do the same three things — check the caller is
// entitled to announce this, ask the database who wants to hear it, hand the
// list to Expo — and only the sentence differs.
//
// Deadline reminders are deliberately *not* here. They are scheduled locally
// on the device (`src/lib/reminders.ts`), because the thing that makes them
// worth sending — "you haven't answered this and it closes in an hour" — is
// something the phone already knows, and a local notification needs no push
// credentials, no cron, and works in Expo Go.
import {
  adminClient,
  corsHeaders,
  errorResponse,
  HttpError,
  json,
  requireUser,
} from '../_shared/supabase.ts';
import { sendPushNotifications, type PushMessage } from '../_shared/push.ts';

type Kind = 'bet_created' | 'member_joined' | 'bet_resolved';

const KINDS: Kind[] = ['bet_created', 'member_joined', 'bet_resolved'];

interface Target {
  user_id: string;
  expo_push_token: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await requireUser(req);
    const body = (await req.json()) as { kind?: string; betId?: string; groupId?: string };
    const kind = body.kind as Kind | undefined;

    if (!kind || !KINDS.includes(kind)) {
      throw new HttpError(400, `kind must be one of ${KINDS.join(', ')}`);
    }

    const db = adminClient();
    const messages =
      kind === 'member_joined'
        ? await memberJoined(db, user.id, body.groupId)
        : await aboutABet(db, kind, user.id, body.betId);

    await sendPushNotifications(messages);
    return json({ notified: messages.length });
  } catch (err) {
    return errorResponse(err);
  }
});

// --- Bets -------------------------------------------------------------------

async function aboutABet(
  db: ReturnType<typeof adminClient>,
  kind: 'bet_created' | 'bet_resolved',
  callerId: string,
  betId: string | undefined
): Promise<PushMessage[]> {
  if (!betId) throw new HttpError(400, 'betId is required');

  const { data: bet, error } = await db
    .from('bets')
    .select(
      'id, group_id, creator_id, title, status, total_pot_agorot, winning_option_id, groups(name, emoji)'
    )
    .eq('id', betId)
    .maybeSingle();

  if (error) throw error;
  if (!bet) throw new HttpError(404, 'Bet not found');

  // Both announcements are the creator's to make: they are the only person who
  // can post a bet or call it, so anyone else asking is either confused or
  // probing.
  if (bet.creator_id !== callerId) {
    throw new HttpError(403, 'Only the bet creator can announce this');
  }

  const targets = await pushTargets(db, 'push_targets_for_bet', {
    p_bet_id: betId,
    p_kind: kind,
    p_exclude: callerId,
  });
  if (targets.length === 0) return [];

  const group = bet.groups as unknown as { name: string; emoji: string | null } | null;
  const groupLabel = group ? `${group.emoji ?? '🎲'} ${group.name}` : 'your group';

  if (kind === 'bet_created') {
    const pot = shekels(bet.total_pot_agorot as number);
    return targets.map((t) => ({
      to: t.expo_push_token,
      title: `New bet in ${groupLabel}`,
      body: `${bet.title} — ₪${pot} pot. Pick a side.`,
      data: { type: 'bet_created', betId: bet.id, groupId: bet.group_id },
    }));
  }

  // A resolution is worth interrupting for, so it says what actually happened
  // to *you* rather than "a bet was resolved". The ledger already holds it.
  const winner = await winningLabel(db, bet.id, bet.winning_option_id as string | null);
  const { data: entries } = await db
    .from('bet_ledger_entries')
    .select('user_id, amount_agorot')
    .eq('bet_id', bet.id);

  const byUser = new Map<string, number>(
    (entries ?? []).map((e) => [e.user_id as string, Number(e.amount_agorot)])
  );

  return targets.map((t) => {
    const amount = byUser.get(t.user_id);
    const outcome =
      amount === undefined || amount === 0
        ? 'Nothing changed hands.'
        : amount > 0
          ? `You're up ₪${shekels(amount)}.`
          : `You owe ₪${shekels(-amount)}.`;

    return {
      to: t.expo_push_token,
      title: `${bet.title} — settled`,
      body: winner ? `${winner} took it. ${outcome}` : outcome,
      data: { type: 'bet_resolved', betId: bet.id, groupId: bet.group_id },
    };
  });
}

async function winningLabel(
  db: ReturnType<typeof adminClient>,
  betId: string,
  optionId: string | null
): Promise<string | null> {
  if (!optionId) return null;
  const { data } = await db
    .from('bet_options')
    .select('label')
    .eq('id', optionId)
    .eq('bet_id', betId)
    .maybeSingle();
  return (data?.label as string | undefined) ?? null;
}

// --- Groups -----------------------------------------------------------------

async function memberJoined(
  db: ReturnType<typeof adminClient>,
  callerId: string,
  groupId: string | undefined
): Promise<PushMessage[]> {
  if (!groupId) throw new HttpError(400, 'groupId is required');

  // You may only announce your *own* arrival, which is also the only thing
  // this event ever means. It keeps the function from being a way to ping a
  // group you are not in.
  const { data: membership, error: membershipError } = await db
    .from('group_members')
    .select('user_id')
    .eq('group_id', groupId)
    .eq('user_id', callerId)
    .maybeSingle();

  if (membershipError) throw membershipError;
  if (!membership) throw new HttpError(403, 'You are not in that group');

  const { data: group, error: groupError } = await db
    .from('groups')
    .select('id, name, emoji')
    .eq('id', groupId)
    .maybeSingle();

  if (groupError) throw groupError;
  if (!group) throw new HttpError(404, 'Group not found');

  const { data: joiner } = await db
    .from('users')
    .select('display_name')
    .eq('id', callerId)
    .maybeSingle();

  const targets = await pushTargets(db, 'push_targets_for_group', {
    p_group_id: groupId,
    p_kind: 'member_joined',
    p_exclude: callerId,
  });

  const name = (joiner?.display_name as string | undefined) ?? 'Someone';
  const groupLabel = `${group.emoji ?? '🎲'} ${group.name}`;

  return targets.map((t) => ({
    to: t.expo_push_token,
    title: groupLabel,
    body: `${name} joined the group.`,
    data: { type: 'member_joined', groupId: group.id },
  }));
}

// --- Shared -----------------------------------------------------------------

async function pushTargets(
  db: ReturnType<typeof adminClient>,
  fn: 'push_targets_for_bet' | 'push_targets_for_group',
  args: Record<string, unknown>
): Promise<Target[]> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw error;
  return (data ?? []) as Target[];
}

/** Agorot are integers everywhere; this is display only, at the last moment. */
function shekels(agorot: number): string {
  const whole = agorot / 100;
  return Number.isInteger(whole) ? String(whole) : whole.toFixed(2);
}
