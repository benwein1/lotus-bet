-- Reading the report queue, and acting on it.
--
-- `…_moderation.sql` built the half a user touches: report, block, and a table
-- that cannot be edited or withdrawn. What it left out is the half guideline
-- 1.2 actually measures — somebody looking at the queue and responding within
-- 24 hours, which the published terms now promise on your behalf.
--
-- This is the tooling for that, not the person. Two functions and a script.
--
-- **There is no admin role in this schema, and this does not invent one.**
-- Adding `users.is_admin` would be a new privilege surface — a column that,
-- if it were ever writable by the wrong policy, hands somebody every group's
-- private content. Both functions here are revoked from `authenticated` and
-- granted to `service_role`, so they are reachable from the SQL editor and
-- from an Edge Function, and from nowhere a client can go.

alter table public.reports
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_note text check (char_length(reviewed_note) <= 500);

create index if not exists reports_open_idx
  on public.reports (created_at) where status = 'open';

-- ---------------------------------------------------------------------------
-- The queue, with the content attached
-- ---------------------------------------------------------------------------
-- `reports.target_id` points at one of three tables depending on `target_kind`,
-- so a moderator reading the raw table sees a uuid and has to go and look up
-- what it was. That is the difference between a queue somebody works through
-- and a queue somebody avoids.
--
-- Deleted targets are the case that matters most — removing the evidence is the
-- obvious first move — so a missing target resolves to null content rather than
-- dropping the row.
create or replace function public.review_queue(p_status text default 'open')
returns table (
  id uuid,
  created_at timestamptz,
  status text,
  reason text,
  target_kind text,
  target_id uuid,
  reporter text,
  reported text,
  content text,
  target_exists boolean
)
language sql
security definer
set search_path = public
as $$
  select
    r.id,
    r.created_at,
    r.status,
    r.reason,
    r.target_kind,
    r.target_id,
    coalesce(reporter.display_name, 'deleted account'),
    coalesce(reported.display_name, 'deleted account'),
    case r.target_kind
      when 'comment' then (select c.body  from public.bet_comments c where c.id = r.target_id)
      when 'bet'     then (select b.title from public.bets b         where b.id = r.target_id)
      when 'user'    then (select u.display_name from public.users u where u.id = r.target_id)
    end,
    case r.target_kind
      when 'comment' then exists (select 1 from public.bet_comments c where c.id = r.target_id)
      when 'bet'     then exists (select 1 from public.bets b         where b.id = r.target_id)
      when 'user'    then exists (select 1 from public.users u where u.id = r.target_id and u.deleted_at is null)
    end
  from public.reports r
  left join public.users reporter on reporter.id = r.reporter_id
  left join public.users reported on reported.id = r.reported_user_id
  where p_status is null or r.status = p_status
  order by r.created_at;
$$;

-- ---------------------------------------------------------------------------
-- Acting on one
-- ---------------------------------------------------------------------------
-- The outcome and the takedown are one call, because they are one decision and
-- doing them separately is how a queue ends up with rows marked actioned whose
-- content is still up.
--
-- A reported **bet is cancelled, never deleted.** Deleting it would take its
-- positions and its ledger with it, which is somebody else's record of what
-- they are owed — the same reason account deletion scrubs rather than erases
-- (CLAUDE.md §6). Cancelling removes it from every feed and settles nothing,
-- which is the right outcome for a bet that should not have been posted.
create or replace function public.review_report(
  p_report_id uuid,
  p_outcome text,
  p_remove_content boolean default false,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.reports;
begin
  if p_outcome not in ('reviewed', 'actioned', 'dismissed') then
    raise exception 'Outcome must be reviewed, actioned or dismissed.'
      using errcode = '22023';
  end if;

  select * into v_report from public.reports where id = p_report_id;
  if not found then
    raise exception 'No such report.' using errcode = 'P0002';
  end if;

  if p_remove_content then
    if v_report.target_kind = 'comment' then
      delete from public.bet_comments where id = v_report.target_id;
    elsif v_report.target_kind = 'bet' then
      update public.bets
         set status = 'cancelled'
       where id = v_report.target_id
         and status in ('open', 'locked');
    end if;
    -- A reported *user* has no content to remove here on purpose. Suspending an
    -- account is a bigger lever than a report queue should pull on its own, and
    -- SECURITY.md §7 puts it last for that reason.
  end if;

  update public.reports
     set status        = p_outcome,
         reviewed_at   = now(),
         reviewed_note = nullif(trim(p_note), '')
   where id = p_report_id;

  -- Every other open report about the same thing is about the same decision.
  -- Leaving them open would mean reading the same content five times.
  update public.reports
     set status        = p_outcome,
         reviewed_at   = now(),
         reviewed_note = coalesce(nullif(trim(p_note), ''), 'Handled with an earlier report.')
   where target_kind = v_report.target_kind
     and target_id   = v_report.target_id
     and status      = 'open'
     and id <> p_report_id;
end;
$$;

-- Neither is reachable from a client. `review_queue` returns other people's
-- private group content by design, and `review_report` deletes things.
revoke execute on function public.review_queue(text) from public, anon, authenticated;
revoke execute on function public.review_report(uuid, text, boolean, text) from public, anon, authenticated;
grant execute on function public.review_queue(text) to service_role;
grant execute on function public.review_report(uuid, text, boolean, text) to service_role;
