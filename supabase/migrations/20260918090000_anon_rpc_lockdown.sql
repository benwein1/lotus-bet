-- Nothing in `public` is callable without signing in.
--
-- Found by Supabase's own security advisor against the live project, after the
-- thirteen migrations landed: thirty-six `SECURITY DEFINER` functions were
-- reachable at `/rest/v1/rpc/<name>` by the `anon` role. Supabase's default
-- privileges grant `execute` on every new function to `PUBLIC`, `anon`,
-- `authenticated` and `service_role`, and the migrations that added these
-- functions granted to `authenticated` explicitly without taking the default
-- away — so every one of them carried both `=X/postgres` (PUBLIC) and
-- `anon=X/postgres` in its ACL.
--
-- Most of them are harmless in practice because they open with
-- `auth.uid() is null` and bail, or resolve nothing for a caller who is in no
-- groups. One is not:
--
--   `find_user_by_username` is `SECURITY DEFINER`, has no sign-in check, and
--   returns `id, display_name, username, avatar_url` for an exact handle.
--   Callable by `anon`, it is a handle-to-person oracle for anybody holding
--   the publishable key — which is printed in the app bundle.
--
-- CLAUDE.md §1 calls exact-handle lookup "a security property, not a missing
-- feature", and the reasoning there is about not letting anyone walk the user
-- table. An unauthenticated caller should not be able to do it at all, and the
-- exactness of the match is the second line, not the first.
--
-- The blanket loop rather than a list: a list is a thing that goes stale the
-- next time somebody adds a function, and the advisor found these exact
-- functions precisely because the last four migrations each added one or two
-- and inherited the default. Revoking from `PUBLIC` as well as from `anon` is
-- what actually closes it — `anon` inherits the PUBLIC grant, so revoking only
-- the named one leaves the door open.
--
-- `authenticated` keeps working because every client-facing function was
-- granted to it *explicitly* by the migration that created it, and an explicit
-- grant is untouched by this. Verified against `pg_proc.proacl` before writing:
-- every function the app calls carries `authenticated=X/postgres` of its own.
--
-- Trigger functions are unaffected. Postgres checks `execute` on a trigger
-- function when the trigger is created, not each time it fires, so
-- `handle_new_auth_user` still runs for a brand-new signup — which is the one
-- case that genuinely happens with no session.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('revoke execute on function %s from public, anon', r.signature);
  end loop;
end $$;

-- And stop the default reapplying itself to whatever is added next. This is
-- the same shape `supabase/test/run.sh` models the platform's grants with, and
-- the reason it models them as default privileges rather than a blanket GRANT:
-- a blanket grant run after the migrations silently re-opens anything they
-- locked down.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;

-- ---------------------------------------------------------------------------
-- One mutable search_path
-- ---------------------------------------------------------------------------
-- The other advisor finding. `generate_invite_code` is the only function in
-- the schema without `set search_path`, so the tables it names resolve against
-- whatever the caller's path happens to be. It is not `SECURITY DEFINER`, so
-- this is hardening rather than a hole — but it is one line, and being able to
-- say "every function in this schema pins its search_path" is worth more than
-- the line costs.
create or replace function public.generate_invite_code()
returns text
language plpgsql
set search_path = public
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_attempt int := 0;
begin
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;

    exit when not exists (select 1 from public.groups g where g.invite_code = v_code);

    v_attempt := v_attempt + 1;
    if v_attempt > 20 then
      raise exception 'Could not generate a unique invite code';
    end if;
  end loop;

  return v_code;
end;
$$;

-- `create or replace` resets nothing about privileges, but this function was
-- already service-role only and the loop above ran before it existed in this
-- form, so it is restated rather than assumed.
revoke execute on function public.generate_invite_code() from public, anon;
