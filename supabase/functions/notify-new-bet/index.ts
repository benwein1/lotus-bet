// POST /functions/v1/notify-new-bet  { betId }
//
// Pushes "there's a new bet" to everyone in the group except its creator.
// Called by the client right after a bet is created. Deliberately the *only*
// join-adjacent notification we send: notifying on every join gets noisy fast
// in an active group.
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
    const { betId } = (await req.json()) as { betId?: string };
    if (!betId) throw new HttpError(400, 'betId is required');

    const db = adminClient();

    const { data: bet, error: betError } = await db
      .from('bets')
      .select('id, group_id, creator_id, title, total_pot_agorot, groups(name, emoji)')
      .eq('id', betId)
      .maybeSingle();

    if (betError) throw betError;
    if (!bet) throw new HttpError(404, 'Bet not found');
    if (bet.creator_id !== user.id) {
      throw new HttpError(403, 'Only the bet creator can announce it');
    }

    const { data: members, error: membersError } = await db
      .from('group_members')
      .select('user_id, users!inner(expo_push_token, notify_new_bets)')
      .eq('group_id', bet.group_id)
      .neq('user_id', bet.creator_id);

    if (membersError) throw membersError;

    const group = bet.groups as unknown as { name: string; emoji: string | null } | null;
    const groupLabel = group ? `${group.emoji ?? '🎲'} ${group.name}` : 'your group';

    const messages: PushMessage[] = (members ?? [])
      .map((m) => m.users as unknown as { expo_push_token: string | null; notify_new_bets: boolean })
      .filter((u) => u?.notify_new_bets && u.expo_push_token)
      .map((u) => ({
        to: u.expo_push_token as string,
        title: `New bet in ${groupLabel}`,
        body: `${bet.title} — ₪${((bet.total_pot_agorot as number) / 100).toFixed(0)} pot. Pick a side.`,
        data: { type: 'new_bet', betId: bet.id, groupId: bet.group_id },
      }));

    await sendPushNotifications(messages);

    return json({ notified: messages.length });
  } catch (err) {
    return errorResponse(err);
  }
});
