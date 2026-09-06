-- Profile and group pictures.
--
-- `users.avatar_url` already existed and was never written to; this adds the
-- matching column on groups and the bucket both of them upload into.
--
-- Unlike `bet-media` this bucket is **public**, and that is a deliberate
-- narrowing of scope rather than an oversight. A signed URL would have to be
-- re-minted for every avatar on every screen — a group list, a member roster,
-- a bet's "who's in" — which is a round trip per face and a broken image an
-- hour after the app was left open. What is exposed is a picture somebody
-- chose as their public face inside a friend group, under an unguessable
-- path; no balance, bet or membership is readable from it. Everything that
-- actually needs protecting stays in the private bucket.
--
-- Writes are still locked down: you can only write under your own user id,
-- and only a group admin can write under a group id.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.groups
  add column if not exists avatar_url text;

comment on column public.groups.avatar_url is
  'Public URL in the `avatars` bucket. Null means fall back to `emoji`.';

comment on column public.users.avatar_url is
  'Public URL in the `avatars` bucket. Null means fall back to initials.';

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------
-- Objects are laid out as `users/<user_id>/<file>` and
-- `groups/<group_id>/<file>`, so each policy reads the owner out of the first
-- two path segments the way the bet-media policies read the group out of the
-- first one.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  5242880, -- 5 MB; a cropped square off a phone camera is a fraction of this
  array['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public = excluded.public;

-- A public bucket already serves reads without a policy; this keeps the
-- intent explicit rather than implicit in a boolean on the bucket row.
drop policy if exists avatars_objects_select on storage.objects;
create policy avatars_objects_select on storage.objects
  for select
  using (bucket_id = 'avatars');

drop policy if exists avatars_objects_insert on storage.objects;
create policy avatars_objects_insert on storage.objects
  for insert
  with check (
    bucket_id = 'avatars'
    and owner = auth.uid()
    and (
      ((storage.foldername(name))[1] = 'users'
        and (storage.foldername(name))[2] = auth.uid()::text)
      or
      ((storage.foldername(name))[1] = 'groups'
        and public.is_group_admin(((storage.foldername(name))[2])::uuid))
    )
  );

-- Replacing a picture overwrites the object, so update needs the same rule as
-- insert. Without it, changing your photo a second time fails.
drop policy if exists avatars_objects_update on storage.objects;
create policy avatars_objects_update on storage.objects
  for update
  using (
    bucket_id = 'avatars'
    and (
      ((storage.foldername(name))[1] = 'users'
        and (storage.foldername(name))[2] = auth.uid()::text)
      or
      ((storage.foldername(name))[1] = 'groups'
        and public.is_group_admin(((storage.foldername(name))[2])::uuid))
    )
  );

drop policy if exists avatars_objects_delete on storage.objects;
create policy avatars_objects_delete on storage.objects
  for delete
  using (
    bucket_id = 'avatars'
    and (
      ((storage.foldername(name))[1] = 'users'
        and (storage.foldername(name))[2] = auth.uid()::text)
      or
      ((storage.foldername(name))[1] = 'groups'
        and public.is_group_admin(((storage.foldername(name))[2])::uuid))
    )
  );
