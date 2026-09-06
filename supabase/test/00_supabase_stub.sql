-- Enough of Supabase's platform schema to run the project's migrations against
-- a plain Postgres. Only the objects the migrations actually touch.
create extension if not exists pgcrypto with schema public;

create schema if not exists auth;
create schema if not exists extensions;
create schema if not exists storage;

-- pgcrypto lives in `extensions` on Supabase; mirror that so the seed script's
-- `set search_path = public, extensions` resolves the same way.
create or replace function extensions.crypt(text, text) returns text
  language sql as $$ select public.crypt($1, $2) $$;
create or replace function extensions.gen_salt(text) returns text
  language sql as $$ select public.gen_salt($1) $$;

-- --- auth ------------------------------------------------------------------
create table if not exists auth.users (
  instance_id uuid,
  id uuid primary key,
  aud varchar(255),
  role varchar(255),
  email varchar(255) unique,
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  phone text unique default null,
  confirmation_token varchar(255) not null default '',
  email_change varchar(255) not null default '',
  email_change_token_new varchar(255) not null default '',
  recovery_token varchar(255) not null default ''
);

-- The signed-in user. Tests set `request.jwt.claim.sub` to impersonate.
create or replace function auth.uid() returns uuid
  language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create or replace function auth.role() returns text
  language sql stable
  as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;

-- --- roles -----------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;

-- --- storage ---------------------------------------------------------------
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[]
  language plpgsql immutable
  as $$
declare
  parts text[];
begin
  parts := string_to_array(name, '/');
  return parts[1 : array_length(parts, 1) - 1];
end $$;

-- --- realtime --------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
