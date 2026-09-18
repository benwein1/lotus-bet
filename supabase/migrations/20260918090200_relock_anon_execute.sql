-- The anon lockdown does not survive a new function. This re-applies it, and
-- says why the previous approach was not enough.
--
-- `…_anon_rpc_lockdown.sql` did two things: revoked `execute` from `PUBLIC` and
-- `anon` on every function then in `public`, and changed the schema's default
-- privileges so the next function created would not get one either.
--
-- The revoke held. The default-privilege change did not. `accept_terms`, added
-- by the very next migration in the same deploy, came back from Supabase's
-- security advisor as
--
--   "can be executed by the `anon` role as a SECURITY DEFINER function via
--    /rest/v1/rpc/accept_terms"
--
-- while the other thirty-seven functions stayed locked. So the state was
-- reachable only by *creating* a function after the lockdown ran.
--
-- The cause is that `alter default privileges` is not the only thing granting
-- here. The platform re-grants on newly created objects in `public` — which is
-- the same mechanism CLAUDE.md §7 already records the SQL harness having to
-- model, and the same lesson in a new place: *a blanket grant applied after a
-- migration silently re-opens anything that migration locked down.* It was
-- written there about the harness's own fixture. It is true of the real
-- platform too.
--
-- What that means practically, and the reason this file exists rather than a
-- one-line revoke tacked onto the social-sign-in migration:
--
--   **Every new function in `public` needs its own explicit revoke.** Not a
--   default privilege, not a policy — a revoke, in the migration that creates
--   it, next to its grant. There is no setting that makes this automatic on
--   this platform, and assuming otherwise is what produced this row.
--
-- Severity of the actual hole: low. `accept_terms` opens with
-- `auth.uid() is null` → raise, so an anonymous caller could reach the endpoint
-- and get an error, nothing more. It is fixed because the *rule* has to hold —
-- the next function to slip through might be one that answers.

-- ---------------------------------------------------------------------------
-- The one that slipped through
-- ---------------------------------------------------------------------------
revoke execute on function public.accept_terms(text) from public, anon;

-- ---------------------------------------------------------------------------
-- And a sweep, so this file fixes the class rather than the instance
-- ---------------------------------------------------------------------------
-- Identical to the loop in the lockdown migration. Running it again is cheap
-- and idempotent, and it catches anything else created between that migration
-- and this one. `authenticated` keeps its explicit grants throughout — an
-- explicit grant is untouched by a revoke aimed at `PUBLIC` and `anon`.
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

-- The default-privilege change is restated rather than removed. It is not
-- sufficient on its own — that is the finding — but it is not wrong either,
-- and it still covers anything created by this role outside the platform's
-- re-grant path.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;
