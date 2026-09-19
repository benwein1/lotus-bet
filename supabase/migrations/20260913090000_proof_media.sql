-- Proof of outcome: media attached to a bet *after* it resolves.
--
-- `bet_media` already existed, but it was built for one job: the creator
-- attaching a photo when they post the bet. The insert policy says so —
-- `creator_id = auth.uid() and status = 'open'`. That is the right rule for a
-- bet's illustration and the wrong rule for its receipt.
--
-- Settling an argument is the whole point of this app, and the argument does
-- not end when the creator taps "resolve" — it ends when somebody produces the
-- photo. So anyone who actually had a side in the bet can attach proof once it
-- is called, and the creator can too.
--
-- The two kinds live in one table rather than two, because they are the same
-- object: a file in the same bucket, under the same path, signed by the same
-- code, read by the same component. What differs is when it may be written and
-- where it is shown, and one column carries that.

-- ---------------------------------------------------------------------------
-- Which kind of media this is
-- ---------------------------------------------------------------------------
alter table public.bet_media
  add column if not exists purpose text not null default 'attachment'
    check (purpose in ('attachment', 'proof'));

-- Existing rows are all attachments — they could not be anything else, because
-- until now the only way in was the creator posting a bet. The default above
-- already covers them; this is here so the intent is on the record.
comment on column public.bet_media.purpose is
  'attachment: posted with the bet by its creator, while open. '
  'proof: added by a participant after the bet resolved.';

create index if not exists bet_media_bet_id_purpose_idx
  on public.bet_media (bet_id, purpose, created_at);

-- ---------------------------------------------------------------------------
-- Who may write what, and when
-- ---------------------------------------------------------------------------
-- The original policy did not constrain `purpose`, which would have let a
-- creator file an open bet's illustration as "proof" and have it render in the
-- receipt gallery. Replaced rather than added to, so there is exactly one rule
-- per kind and no overlap between them.
drop policy if exists bet_media_insert_creator on public.bet_media;
create policy bet_media_insert_attachment on public.bet_media
  for insert
  with check (
    uploaded_by = auth.uid()
    and purpose = 'attachment'
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

-- Proof is the mirror image: only once the bet is resolved, and open to the
-- people who were actually in it rather than to the creator alone. A group
-- member who never picked a side is a spectator, and a spectator's photo is
-- not evidence of anything.
--
-- Gated on `can_see_bet`, not `is_group_member` — a private bet's proof must
-- be exactly as private as the bet. That is the rule every table hanging off a
-- bet follows, and this is one more of them.
create policy bet_media_insert_proof on public.bet_media
  for insert
  with check (
    uploaded_by = auth.uid()
    and purpose = 'proof'
    and public.can_see_bet(bet_id)
    and exists (
      select 1
      from public.bets b
      where b.id = bet_id
        and b.group_id = bet_media.group_id
        and b.status = 'resolved'
        and (
          b.creator_id = auth.uid()
          or exists (
            select 1 from public.bet_positions p
            where p.bet_id = b.id and p.user_id = auth.uid()
          )
        )
    )
  );

-- You can withdraw what you put up. The old rule required you to be both the
-- uploader *and* the bet's creator, which was the same person in every row
-- that could exist then — now it would stop a participant deleting their own
-- proof, which is the one deletion that should obviously be allowed.
drop policy if exists bet_media_delete_creator on public.bet_media;
create policy bet_media_delete_own on public.bet_media
  for delete
  using (uploaded_by = auth.uid());
