#!/usr/bin/env bash
#
# Run every migration, the seed script and the policy checks against a
# throwaway Postgres.
#
# This exists because none of the SQL in this repo is exercised by anything
# else: the app is typechecked and unit-tested, the schema was not. A syntax
# error, a recursive policy or an RPC that quietly returns nothing would only
# ever have surfaced against the live project.
#
#   supabase/test/run.sh
#
# Needs a local PostgreSQL 16 (`postgresql-16` / `postgresql` on most
# distributions). It never touches a real project — it initialises a cluster
# under $TMPDIR and throws it away.
#
# What it does NOT cover: anything the Supabase platform provides rather than
# this repo. `00_supabase_stub.sql` fakes `auth.users`, `auth.uid()`,
# `storage.objects` and the realtime publication closely enough to run the
# policies, and grants the table privileges Supabase hands out on its own.
# Storage behaviour and GoTrue itself are out of scope.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
WORK="${TMPDIR:-/tmp}/betta-pgtest.$$"
SOCK="$WORK/sock"
PORT="${PGTEST_PORT:-54999}"

if [[ ! -x "$PGBIN/initdb" ]]; then
  echo "No PostgreSQL 16 at $PGBIN. Set PGBIN to its bin directory." >&2
  exit 1
fi

# initdb refuses to run as root, so drop to the `postgres` account when we are.
RUNAS=()
if [[ "$(id -u)" == "0" ]]; then
  RUNAS=(su postgres -c)
fi

run_pg() {
  if [[ ${#RUNAS[@]} -gt 0 ]]; then
    su postgres -c "$1"
  else
    bash -c "$1"
  fi
}

cleanup() {
  run_pg "$PGBIN/pg_ctl -D '$WORK/data' stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

mkdir -p "$WORK/data" "$SOCK"
if [[ ${#RUNAS[@]} -gt 0 ]]; then
  chown -R postgres:postgres "$WORK"
fi
chmod 700 "$WORK/data"

echo "==> starting a throwaway postgres on port $PORT"
run_pg "$PGBIN/initdb -D '$WORK/data' -U postgres --auth=trust" >"$WORK/initdb.log" 2>&1
run_pg "$PGBIN/pg_ctl -D '$WORK/data' -o '-p $PORT -k $SOCK -h \"\"' -l '$WORK/pg.log' start" >/dev/null

export PGHOST="$SOCK" PGPORT="$PORT" PGUSER=postgres
for _ in $(seq 1 20); do
  psql -tAc 'select 1' postgres >/dev/null 2>&1 && break
  sleep 0.5
done

psql -q -v ON_ERROR_STOP=1 -c 'create database betta' postgres

echo "==> platform stub"
psql -q -v ON_ERROR_STOP=1 -d betta -f "$ROOT/supabase/test/00_supabase_stub.sql" 2>&1 \
  | grep -v 'wal_level is insufficient' || true

echo "==> migrations"
# A migration that backfills existing rows only does anything when there are
# rows to backfill — and against an empty database every backfill is a no-op
# that passes for the wrong reason. `supabase/test/pre/<migration>.sql`, when
# one exists, is applied immediately *before* that migration, so it can put the
# old shape in the table and the migration has real work to do.
for f in "$ROOT"/supabase/migrations/*.sql; do
  pre="$ROOT/supabase/test/pre/$(basename "$f")"
  if [ -f "$pre" ]; then
    echo "    (pre) $(basename "$pre")"
    psql -q -v ON_ERROR_STOP=1 -d betta -f "$pre" 2>&1 | grep -v '^NOTICE' || true
  fi
  echo "    $(basename "$f")"
  psql -q -v ON_ERROR_STOP=1 -d betta -f "$f" 2>&1 | grep -v '^NOTICE' || true
done

echo "==> fixture"
psql -q -v ON_ERROR_STOP=1 -d betta -f "$ROOT/supabase/test/10_fixture.sql" >/dev/null

echo "==> seed script"
psql -q -v ON_ERROR_STOP=1 -d betta -f "$ROOT/supabase/seed/test_members.sql" >/dev/null

# The App Review seed is the data an Apple reviewer signs into, and a script
# that half-applies leaves them looking at a hole. It is exercised here for the
# same reason the migrations are: nothing else runs it until it matters.
echo "==> App Review seed"
psql -q -v ON_ERROR_STOP=1 -d betta -f "$ROOT/supabase/seed/review_account.sql" >/dev/null

echo "==> policy checks"
psql -d betta -f "$ROOT/supabase/test/20_policy_checks.sql" 2>&1 \
  | grep -v '^SET$\|^BEGIN$\|^COMMIT$\|^ROLLBACK$'

echo
echo "==> balances after seeding (what the settle-up screen reads)"
psql -d betta <<SQL
set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000000';
select u.display_name, b.amount_agorot
from public.groups g
cross join lateral public.group_balances(g.id) b
join public.users u on u.id = b.user_id
where g.invite_code = 'RHMXXW'
order by b.amount_agorot desc;
SQL

echo "==> done"
