-- A per-uploader storage quota, and a `kind` that has to agree with the object.
--
-- SECURITY.md finding #5 and section 7 item 3. Media upload is the one abuse
-- vector that takes somebody else down with you: the bucket is shared, so one
-- account filling it breaks every group's photos at once. It is also the most
-- expensive row in the app to create — a 50 MB object costs more than every
-- comment ever written.
--
-- **What this does not do.** The bucket's own `file_size_limit` and
-- `allowed_mime_types` are a dashboard setting and remain the first line of
-- defence; nothing here replaces them. Nor does this sniff magic bytes —
-- Storage records the content type the uploader declared, so a determined
-- client can still call an MP4 a JPEG. What it removes is the *unbounded* part
-- and the case where the row and the object disagree.

-- ---------------------------------------------------------------------------
-- 1. The object's real size, recorded on the row
-- ---------------------------------------------------------------------------
alter table public.bet_media
  add column if not exists bytes bigint check (bytes is null or bytes >= 0);

comment on column public.bet_media.bytes is
  'The object''s size as Storage recorded it, copied in by a trigger — not a '
  'number the client sends. Null on rows that predate this column, and on any '
  'row whose object is missing.';

-- The quota sums over this, and the orphan sweep reads it.
create index if not exists bet_media_uploaded_by_idx
  on public.bet_media (uploaded_by);

-- ---------------------------------------------------------------------------
-- 2. Fill it, check the kind, and enforce the quota
-- ---------------------------------------------------------------------------
-- One trigger rather than three, because all three need the same lookup into
-- `storage.objects` and doing it once is the difference between one extra read
-- per upload and three.
--
-- `security definer` because `storage.objects` has RLS of its own and this has
-- to see the row regardless of who is inserting.
create or replace function public.enforce_media_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- 250 MB per account. Sized against the 1 GB a Free project's bucket holds:
  -- four accounts could fill it, which is the point — a limit nobody reaches
  -- is not a limit. Raise it when the plan does.
  v_quota constant bigint := 250 * 1024 * 1024;
  v_object record;
  v_used bigint;
begin
  select (o.metadata ->> 'size')::bigint as bytes,
         o.metadata ->> 'mimetype'       as mimetype
    into v_object
    from storage.objects o
   where o.bucket_id = 'bet-media'
     and o.name = new.storage_path;

  -- No object yet. That happens in tests and in any path that writes the row
  -- before the upload lands; it is not something to refuse, because a row with
  -- no object costs no storage. It simply does not count against anybody.
  -- `not found` rather than `v_object is null`: a record is only IS NULL when
  -- every field is, so an object with no size recorded would take that branch
  -- and skip the mimetype check with it.
  if not found then
    new.bytes := null;
    return new;
  end if;

  new.bytes := v_object.bytes;

  -- The row says `image` or `video`; the object says what it was uploaded as.
  -- Storage takes that from the request, so this is not proof of anything about
  -- the bytes — but a row that disagrees with its own object is either a bug or
  -- somebody filing a video where the gallery expects a photo, and neither
  -- should be written.
  if v_object.mimetype is not null
     and split_part(v_object.mimetype, '/', 1) not in ('image', 'video') then
    raise exception 'That file is not a photo or a video.' using errcode = '22023';
  end if;

  if v_object.mimetype is not null
     and split_part(v_object.mimetype, '/', 1) <> new.kind then
    -- Said in the words the app uses. "image" is the column's value, "photo" is
    -- what a person calls it, and it also keeps the sentence grammatical in
    -- both directions.
    raise exception 'That file is a %, so it cannot be attached as a %.',
      case split_part(v_object.mimetype, '/', 1) when 'image' then 'photo' else 'video' end,
      case new.kind when 'image' then 'photo' else 'video' end
      using errcode = '22023';
  end if;

  select coalesce(sum(m.bytes), 0)
    into v_used
    from public.bet_media m
   where m.uploaded_by = new.uploaded_by;

  if v_used + coalesce(new.bytes, 0) > v_quota then
    raise exception
      'That would take you over your % MB of uploads. Delete something first.',
      v_quota / 1024 / 1024
      using errcode = '53400';
  end if;

  return new;
end;
$$;

comment on function public.enforce_media_limits() is
  'Copies the object''s real size onto the row, refuses a row whose kind '
  'disagrees with its object, and caps total uploads per account. SECURITY.md '
  'finding #5 and section 7.';

drop trigger if exists bet_media_limits on public.bet_media;
create trigger bet_media_limits
  before insert on public.bet_media
  for each row execute function public.enforce_media_limits();
