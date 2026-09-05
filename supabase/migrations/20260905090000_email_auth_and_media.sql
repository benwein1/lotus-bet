-- Email + password accounts, and photo/video attachments on a bet.
--
-- Migrations are append-only: this changes the shape set up by
-- 20260904090000_init.sql rather than editing it.

-- ---------------------------------------------------------------------------
-- Accounts move from phone OTP to email + password
-- ---------------------------------------------------------------------------
-- `phone` stays on the table so accounts created under the old flow keep
-- working, but it is no longer required and no longer the identity column.
alter table public.users
  add column if not exists email text,
  add column if not exists profile_completed boolean not null default false;

alter table public.users alter column phone drop not null;

create unique index if not exists users_email_key on public.users (lower(email));

-- Anyone who already picked a real name has a complete profile. The old code
-- detected that by pattern-matching the placeholder, which trapped a user who
-- genuinely called themselves "Player 7"; this replaces the guess with a fact.
update public.users
set profile_completed = true
where display_name !~ '^Player \d{0,4}$';

-- ---------------------------------------------------------------------------
-- Signup trigger
-- ---------------------------------------------------------------------------
-- The sign-up form sends the display name in `raw_user_meta_data`, so a new
-- account normally arrives already named and skips profile setup entirely.
-- Without one we seed a placeholder and leave `profile_completed` false.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(trim(new.raw_user_meta_data ->> 'display_name'), '');
begin
  insert into public.users (id, email, phone, display_name, profile_completed)
  values (
    new.id,
    new.email,
    new.phone,
    coalesce(v_name, 'Player ' || right(new.id::text, 4)),
    v_name is not null
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Bet media
-- ---------------------------------------------------------------------------
-- Photos and videos attached to a bet when it is posted. `group_id` is
-- denormalised so the RLS policy and the realtime filter can both work without
-- a join back to `bets`.
create table if not exists public.bet_media (
  id uuid primary key default gen_random_uuid(),
  bet_id uuid not null references public.bets (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  uploaded_by uuid not null references public.users (id),
  kind text not null check (kind in ('image', 'video')),
  -- Path inside the private `bet-media` bucket. Reads go through a signed URL;
  -- nothing here is public.
  storage_path text not null unique,
  width integer check (width > 0),
  height integer check (height > 0),
  duration_ms integer check (duration_ms >= 0),
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists bet_media_bet_id_position_idx
  on public.bet_media (bet_id, position);

alter table public.bet_media enable row level security;

create policy bet_media_select_members on public.bet_media
  for select
  using (public.is_group_member(group_id));

-- Only the bet's creator attaches media, only while the bet is still open, and
-- only into the group the bet actually belongs to.
create policy bet_media_insert_creator on public.bet_media
  for insert
  with check (
    uploaded_by = auth.uid()
    and public.is_group_member(group_id)
    and exists (
      select 1
      from public.bets b
      where b.id = bet_id
        and b.group_id = bet_media.group_id
        and b.creator_id = auth.uid()
        and b.status = 'open'
    )
  );

create policy bet_media_delete_creator on public.bet_media
  for delete
  using (
    uploaded_by = auth.uid()
    and exists (
      select 1 from public.bets b where b.id = bet_id and b.creator_id = auth.uid()
    )
  );

alter publication supabase_realtime add table public.bet_media;

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------
-- Private bucket. Objects are laid out as `<group_id>/<bet_id>/<uuid>.<ext>`,
-- so every policy can read the owning group straight out of the first path
-- segment and reuse the same membership helper the tables use.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'bet-media',
  'bet-media',
  false,
  52428800, -- 50 MB; a short clip from a phone, not a film
  array[
    'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp',
    'video/mp4', 'video/quicktime'
  ]
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public = excluded.public;

drop policy if exists bet_media_objects_select on storage.objects;
create policy bet_media_objects_select on storage.objects
  for select
  using (
    bucket_id = 'bet-media'
    and public.is_group_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists bet_media_objects_insert on storage.objects;
create policy bet_media_objects_insert on storage.objects
  for insert
  with check (
    bucket_id = 'bet-media'
    and owner = auth.uid()
    and public.is_group_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists bet_media_objects_delete on storage.objects;
create policy bet_media_objects_delete on storage.objects
  for delete
  using (bucket_id = 'bet-media' and owner = auth.uid());
