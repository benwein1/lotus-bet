-- The world as it looked before bets had options, planted so that the options
-- migration has something to convert.
--
-- This exists because of a bug it would have caught. The backfill updates
-- `bet_positions`, and `bet_positions_require_open` rejects any write to a
-- position on a bet that is locked, resolved, cancelled or past its close time
-- — so on a real project with any settled history the migration failed with
-- "Bet is locked — positions can no longer change". Against an empty test
-- database there was nothing to update and it passed.
--
-- So every state the trigger objects to is represented here: locked, resolved,
-- cancelled, and open-but-past-`close_at`. Positions are always inserted while
-- the bet is still open, because that is the only way they can be — the same
-- trigger sees to that — and the bet is moved to its final state afterwards.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4000-8000-000000000001',
   'authenticated', 'authenticated', 'legacy-one@example.test', 'x',
   now(), '{}'::jsonb, '{"display_name":"Legacy One"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4000-8000-000000000002',
   'authenticated', 'authenticated', 'legacy-two@example.test', 'x',
   now(), '{}'::jsonb, '{"display_name":"Legacy Two"}'::jsonb, now(), now())
on conflict (id) do nothing;

insert into public.groups (id, name, emoji, created_by, invite_code)
values ('11111111-0000-4000-8000-000000000000', 'Before Options', '🕰',
        '11111111-1111-4000-8000-000000000001', 'LEGACY')
on conflict (id) do nothing;

insert into public.group_members (group_id, user_id, role)
values
  ('11111111-0000-4000-8000-000000000000', '11111111-1111-4000-8000-000000000001', 'admin'),
  ('11111111-0000-4000-8000-000000000000', '11111111-1111-4000-8000-000000000002', 'member')
on conflict do nothing;

-- Four bets, one per state the trigger cares about. All start open, which is
-- the only state a position can be written in.
insert into public.bets (
  id, group_id, creator_id, title, option_a_label, option_b_label,
  total_pot_agorot, status
)
values
  ('11111111-0000-4000-8000-00000000000a', '11111111-0000-4000-8000-000000000000',
   '11111111-1111-4000-8000-000000000001', 'Still open', 'Yes', 'No', 1000, 'open'),
  ('11111111-0000-4000-8000-00000000000b', '11111111-0000-4000-8000-000000000000',
   '11111111-1111-4000-8000-000000000001', 'Locked before options', 'Yes', 'No', 2000, 'open'),
  ('11111111-0000-4000-8000-00000000000c', '11111111-0000-4000-8000-000000000000',
   '11111111-1111-4000-8000-000000000001', 'Resolved before options', 'Yes', 'No', 3000, 'open'),
  ('11111111-0000-4000-8000-00000000000d', '11111111-0000-4000-8000-000000000000',
   '11111111-1111-4000-8000-000000000001', 'Cancelled before options', 'Yes', 'No', 4000, 'open'),
  ('11111111-0000-4000-8000-00000000000e', '11111111-0000-4000-8000-000000000000',
   '11111111-1111-4000-8000-000000000001', 'Open but past its deadline', 'Yes', 'No', 5000, 'open')
on conflict (id) do nothing;

insert into public.bet_positions (bet_id, user_id, side)
select b.id, u.user_id, u.side
from (values
  ('11111111-1111-4000-8000-000000000001'::uuid, 'a'),
  ('11111111-1111-4000-8000-000000000002'::uuid, 'b')
) as u(user_id, side)
cross join (values
  ('11111111-0000-4000-8000-00000000000a'::uuid),
  ('11111111-0000-4000-8000-00000000000b'::uuid),
  ('11111111-0000-4000-8000-00000000000c'::uuid),
  ('11111111-0000-4000-8000-00000000000d'::uuid),
  ('11111111-0000-4000-8000-00000000000e'::uuid)
) as b(id)
on conflict do nothing;

-- Now move each bet to the state it was really in. Nothing below touches
-- `bet_positions`, so the trigger has no say in it.
update public.bets set status = 'locked'
 where id = '11111111-0000-4000-8000-00000000000b';

update public.bets
   set status = 'resolved', winning_option = 'b', resolved_at = now()
 where id = '11111111-0000-4000-8000-00000000000c';

update public.bets set status = 'cancelled'
 where id = '11111111-0000-4000-8000-00000000000d';

update public.bets set close_at = now() - interval '1 day'
 where id = '11111111-0000-4000-8000-00000000000e';
