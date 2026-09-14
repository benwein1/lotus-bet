-- Posting a bet was refused by RLS. This fixes it.
--
-- The symptom: `create bet` failed with
--   new row violates row-level security policy for table "bets"
-- even for a group member inserting with `creator_id = auth.uid()` — both
-- halves of the INSERT policy's own check being demonstrably true.
--
-- The cause is not the INSERT policy at all. `queries.ts` does
-- `.insert(...).select().single()`, which PostgREST compiles to
-- `INSERT ... RETURNING *`, and **Postgres evaluates the SELECT policy against
-- the new row for the RETURNING clause**. Since `…_private_and_duels.sql` that
-- policy has been `can_see_bet(id)`, and `can_see_bet` is a `stable` function
-- whose body does:
--
--   select exists (select 1 from public.bets b where b.id = p_bet_id and …)
--
-- A `stable` function sees the snapshot as of the start of the statement, and
-- the row being inserted is not in it. So the lookup finds nothing, the
-- function returns false, the SELECT policy denies the row, and Postgres
-- reports the denial as an RLS violation on the insert. Reproduced in
-- `supabase/test/run.sh`: the same insert succeeds without `RETURNING` and
-- fails with it.
--
-- This was a regression. The policy it replaced was
-- `is_group_member(group_id)`, which reads `group_members` — a row that
-- already exists — so it never had to see the row being written.
--
-- The fix is to stop the `bets` policy re-reading `bets`. The rule is
-- extracted into `can_see_bet_row`, which takes the four columns it actually
-- needs, so the policy can pass the new row's own values and never perform a
-- lookup. `can_see_bet(id)` stays as the gate for every table hanging off a
-- bet and becomes a thin wrapper over the same function — so there is still
-- exactly one implementation of "who can see this bet", which is the whole
-- point of CLAUDE.md §6's single-gate rule.

-- ---------------------------------------------------------------------------
-- The rule, over columns rather than over an id
-- ---------------------------------------------------------------------------
create or replace function public.can_see_bet_row(
  p_bet_id uuid,
  p_group_id uuid,
  p_visibility text,
  p_creator_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_group_member(p_group_id)
     and (
       p_visibility = 'group'
       or p_creator_id = auth.uid()
       or exists (
         select 1
         from public.bet_invitees i
         where i.bet_id = p_bet_id and i.user_id = auth.uid()
       )
     );
$$;

grant execute on function public.can_see_bet_row(uuid, uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- `can_see_bet` keeps its signature and delegates
-- ---------------------------------------------------------------------------
-- Every policy on a table that hangs off a bet still calls this, and still
-- gets the identical answer — it just no longer carries its own copy of the
-- rule. Looking the row up is correct here: those policies are always asked
-- about a bet that already exists.
create or replace function public.can_see_bet(p_bet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.bets b
    where b.id = p_bet_id
      and public.can_see_bet_row(b.id, b.group_id, b.visibility, b.creator_id)
  );
$$;

-- ---------------------------------------------------------------------------
-- The one policy that has to work on a row that is not committed yet
-- ---------------------------------------------------------------------------
drop policy if exists bets_select_members on public.bets;
create policy bets_select_members on public.bets
  for select
  using (public.can_see_bet_row(id, group_id, visibility, creator_id));
