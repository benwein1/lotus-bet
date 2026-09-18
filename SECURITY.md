# SECURITY.md — Lotus Bet

A review of what this repository actually does, not a checklist of what apps
generally should do. Every claim below was read out of the migrations, the RLS
policies, the RPCs, `queries.ts`, the storage rules or the auth provider, and
each one names the file it came from.

Reviewed at `dc94dd6` plus the changes in this branch. Last updated 2026-09-14.

---

## 0. Findings, worst first

| # | Severity | Finding | Fix order |
| --- | --- | --- | --- |
| 1 | ~~**CRITICAL**~~ **FIXED** | Every group member could read every other member's **email, phone and Expo push token** | ✅ `…_user_column_privileges.sql` |
| 2 | ~~**HIGH**~~ **FIXED** | No rate limiting of any kind on application writes | ✅ `…_abuse_limits.sql` |
| 3 | ~~**HIGH**~~ **FIXED, less the person** | No blocking, reporting or moderation | ✅ `…_moderation.sql` + `…_moderation_review.sql`; somebody still has to read the queue |
| 4 | ~~**MEDIUM**~~ **FIXED** | No account deletion — also an App Store blocker (§5.1.1(v)) | ✅ `…_account_deletion.sql` |
| 5 | **LOW** (what is left) | Uploads are not validated server-side: type, size and magic bytes are all client-asserted | Path-vs-group constrained; size and kind now taken from Storage; 250 MB per account. **Bucket limits are still a dashboard change** |
| 6 | ~~**MEDIUM**~~ **FIXED for photos** | EXIF (incl. GPS) is not stripped from uploaded photos | ✅ `stripMetadata` in `media.ts`; video is not covered |
| 7 | **LOW** | `group_invites` tokens are `select`-able by every group member | **Won't fix as written** — see §4 |
| 8 | **LOW** | Signed media URLs are bearer tokens with a 1-hour life and no revocation | 8th |
| 9 | ~~**INFO**~~ **FIXED** | Realtime subscribes unfiltered to `bet_positions` — a metadata side channel | ✅ `…_position_group_id.sql` |
| 10 | ~~**INFO**~~ **FIXED** | Comment/bet/group text has no length-abuse or unicode normalisation | ✅ `content-rules.ts` + `…_abuse_limits.sql` |

**What is already right** is genuinely more than what is wrong; see §2.

---

## 1. ~~CRITICAL~~ FIXED — the `users` table leaked contact details and push tokens

### What is true

`public.users` accumulated sensitive columns over four migrations:

| Column | Added by |
| --- | --- |
| `phone` | `20260904090000_init.sql` |
| `expo_push_token` | `20260904090000_init.sql` |
| `email` | `20260905090000_email_auth.sql` |
| `username` | `20260911090000_private_and_duels.sql` |

Its SELECT policy (`20260904090100_rls.sql:73`) is:

```sql
create policy users_select_self_or_groupmates on public.users
  for select
  using (id = auth.uid() or public.shares_group_with(id));
```

**RLS is row-level, not column-level.** There are no column-level grants on
this table anywhere in the migrations — I checked all twelve. So the policy
that correctly decides *which people* you may see also hands you *every column*
about them.

And the client asks for exactly that. `queries.ts` selects `user:users(*)` in
four places (lines 102, 116, 128, and the new bet-detail select at 262), so the
app already ships every groupmate's email address, phone number and push token
into the JavaScript heap of every other member's device.

### Why it matters

- **Email + phone harvesting.** Join one group of ten, walk away with ten
  verified email addresses and any phone numbers from the old OTP-era accounts.
- **Push tokens are close to bearer credentials.** Anyone holding an Expo push
  token can POST to `https://exp.host/--/api/v2/push/send` and put a
  notification on that person's lock screen. No secret is required. A group
  member can therefore spoof notifications that look like they came from Lotus
  Bet.

This directly contradicts the intent already written into CLAUDE.md §6, where
`push_targets_for_bet` / `push_targets_for_group` are revoked from
`authenticated` precisely because "they return device tokens, and a group
member must not be able to list their friends' phones." That hardening is
correct and it is bypassed by reading the base table.

### The fix, as applied

Option (A) — **column-level privileges**, in
`supabase/migrations/20260916090000_user_column_privileges.sql`. Postgres
composes column privileges with RLS: RLS decides *which rows*, `GRANT ...
(column_list)` decides *which columns*, and this table only ever had the first.

```sql
revoke all on public.users from anon;
revoke all on public.users from authenticated;

grant select (id, display_name, username, avatar_url, profile_completed,
              notify_new_bets, notify_resolutions, notify_group_joins,
              notify_deadlines, created_at)
  on public.users to authenticated;
```

`email`, `phone` and `expo_push_token` are simply not in the list. `anon` gets
nothing at all — RLS already denied it every row, but a table with sensitive
columns should not rest on one mechanism.

It closed a second, quieter hole on the way: UPDATE is now column-scoped too,
so a client can no longer write its own `users.email` (desynchronising it from
the `auth.users` row that actually governs signing in) or overwrite its own
`expo_push_token`, which `set_push_token` exists to own.

**What did not break, and why.** `SECURITY DEFINER` functions run as the owner
and are unaffected by the grant: `handle_new_auth_user` still seeds `email`,
`suggest_username` still reads it, and `push_targets_for_bet` /
`push_targets_for_group` still return tokens to the service role. Those two
being revoked from `authenticated` was always the real boundary around a push
token; this makes the table agree with it.

**The client half had to land at the same time.** `select *` on a table with a
revoked column is a hard refusal — `permission denied for table users` — not a
narrower row. So `queries.ts` now names columns at every read site through one
`USER_COLUMNS` / `USER_PUBLIC_COLUMNS` pair, the auth provider's profile read
and its update-returning clause name them too, and the Profile screen reads the
user's address from `session.user.email` (GoTrue's copy, which
`public.users.email` was only ever mirroring).

That refusal being loud is the point. A silent narrowing is how this leak would
come back unnoticed, and a client older than the migration stops reading
`users` rather than degrading — the safe direction.

### How it is tested

`supabase/test/20_policy_checks.sql` §25 drives it as `authenticated`:
`select *` refused, `email` refused, `phone` refused, `expo_push_token`
refused, **your own** `email` refused, an `update` of `email` refused, an
`update` of `expo_push_token` refused — and the safe columns still readable,
`display_name` still writable. §26 then proves the fan-out still works: the
service role reads a real token back, and the same call as `authenticated` is
refused. The harness is at 39 asserted refusals, exit 0.

### What is still worth doing

Two things this does not cover.

1. **The harness exercises Postgres, not PostgREST.** The refusal shape is
   proven; that the app's exact embed strings still parse is not. Worth one
   smoke test against a real project — open the feed, a group and a bet screen
   — after applying the migration.
2. **Option (B), splitting the columns into `public.user_private`, remains the
   more durable shape.** Column grants sit beside the table rather than inside
   it, so someone adding a policy to `users` without thinking cannot re-expose
   them — but someone re-running a blanket `grant select on public.users`
   could. (B) makes that impossible rather than merely wrong. Not urgent now
   that the leak is closed.

---

## 2. What the schema already gets right

This is not a courtesy section — these are the properties the rest of the
review depends on, and they are unusually well done for an MVP.

### Membership helpers, and no recursion

Every policy that needs "is this person in this group" goes through a
`SECURITY DEFINER` helper — `is_group_member`, `is_group_admin`,
`shares_group_with`, `bet_group_id`, `can_see_bet`. I grepped every `create
policy` in all twelve migrations: **none queries `group_members` directly**, so
the infinite-recursion trap CLAUDE.md §6 warns about is genuinely avoided, not
merely documented.

### `search_path` is pinned on every definer function

34 functions are `security definer`, and **all 34** carry `set search_path =
public`. That closes the classic definer-function hijack, where an attacker
creates `public_evil.now()` and gets it resolved inside a function running as
the owner. No exceptions found.

### The ledger is genuinely read-only to clients

`bet_ledger_entries` has no INSERT, UPDATE or DELETE policy for `authenticated`.
Only `resolve_bet_with_entries` writes it, and that RPC *checks* the entries it
is handed rather than trusting them — one row per participant, winners positive,
losers negative, credits totalling the pot exactly, debits totalling minus the
pot. A ledger that does not balance is refused. This is the single highest-value
invariant in the app and it is enforced in the database, not the client.

### Service-role functions are actually revoked

```
revoke execute on function public.push_targets_for_bet(...)  from public, anon, authenticated;
revoke execute on function public.push_targets_for_group(...) from public, anon, authenticated;
grant  execute on function public.push_targets_for_bet(...)  to service_role;
```

Correct — and no longer undermined by finding #1, which used to reach the same data by
another route.

### One gate for everything hanging off a bet

`can_see_bet(id)` guards `bets`, `bet_options`, `bet_positions`, `bet_media`,
`bet_likes`, `bet_comments` and `bet_invitees`. A private bet's comments cannot
be readable where the bet is not. Keeping it in one function is what makes that
checkable rather than hopeful.

### No user enumeration

`find_user_by_username` is exact-match only. There is no prefix or fuzzy search
over `users` anywhere in `queries.ts`. CLAUDE.md is right to call this a security
property — it is the difference between "look up my friend" and "walk the whole
user table".

### Duels are sealed

`create_group_invite` rejects `kind = 'duel'` and `join_group_with_code` rejects
it too, so a third party cannot walk into a two-person group whose balance both
sides read as pairwise.

---

## 3. SQL injection — no live paths found

I looked specifically for the shapes that actually bite:

| Surface | Verdict |
| --- | --- |
| PostgREST filters (`.eq`, `.in`, `.select`) | **Safe.** supabase-js sends values as parameters; they never become SQL text. |
| RPC arguments | **Safe.** `supabase.rpc(name, {args})` are bound parameters. |
| Dynamic SQL inside functions | **None found.** No `execute format(...)`, no string concatenation into a query, in any of the 34 definer functions. |
| Usernames / handles | Compared with `=`, never interpolated. |
| Group names, bet titles, comment bodies | Stored and returned as data; never parsed. |
| Invite tokens | Compared with `=` against a `text` column. |

The one thing worth keeping an eye on: **`BET_SELECT` is built by string
concatenation** (`betSelectWithGroup`, `betDetailSelect` in `queries.ts`). The
inputs are booleans, not user data, so there is no injection today — but this is
the file where a future "search bets by title" feature would be tempted to
interpolate a user string into a PostgREST filter. `.ilike()` with a bound
parameter is the safe form; `` `title.ilike.${q}` `` in a raw `.or()` string is
not, because `,` and `)` in `q` break out of the filter grammar. Note it before
someone adds search.

---

## 4. URL and deep-link security

### Invite links

`invite-links.ts` / `invites.ts`, and the `group_invites` table.

**Good:** the token is 72 bits of `gen_random_bytes` base64url — not guessable.
It carries an expiry, a use count and a revocation. Nothing writes
`group_invites` from the client: there is a SELECT policy for members and **no
INSERT, UPDATE or DELETE policy at all**, so a client cannot mint itself an
invite or push an expiry out. `create_group_invite` reuses a live invite rather
than minting per tap, so "revoke the link" keeps meaning something.

**Good:** redeeming is idempotent about its use count —
`join_group_with_invite` only increments `uses` when a row was actually
inserted, so opening the same link twice does not burn a use.

**Finding #7 (LOW):** every group member can `select` from `group_invites`, so
any member can read the active token and re-share it after an admin thought
they had stopped sharing. The revocation still works — this is a leak of the
token, not a bypass.

**The proposed fix does not work against this product, and was not applied.**
`create_group_invite` requires only `is_group_member`, so any member can mint a
fresh, working link whenever they like. Restricting SELECT to
`is_group_admin(group_id)` removes no capability a member does not already
have — it only breaks the group screen's live-link display for non-admins. The
invite migration says as much where it grants minting to members: making links
admin-only "would be a different, stricter product than the one that already
shipped".

The coherent options are to leave both open (today's product) or to make
minting **and** reading admin-only. That is a product decision, not a patch.
Doing only the SELECT half is the worst of the three, because it looks like a
fix and changes nothing an attacker can do.

**No open-redirect exists.** `inviteUrl` builds `${origin}${INVITE_PATH}${token}`
where `origin` comes from `window.location.origin` on web or the configured
`EXPO_PUBLIC_WEB_ORIGIN` on device — never from the link being opened. There is
no "next" or "returnTo" parameter anywhere in the app, which is the usual source
of open redirects.

**Replay:** a token is replayable until it expires, is revoked, or hits its use
cap — which is the intended behaviour of a shareable invite. The mitigation is
the expiry, and it exists.

### Password-reset links

Handled in §6 of CLAUDE.md and fixed on this branch. Security-relevant points:

- The `recovering` latch is read from the URL, not from the session, so a
  recovery session cannot be mistaken for an ordinary one and waved through to
  the tabs.
- `auth-links.ts` parses the fragment and query with a hand-rolled splitter and
  `decodeURIComponent`. It cannot execute anything; worst case it returns junk
  strings, and `recoveryTokens` refuses a half-complete pair rather than calling
  `setSession` with garbage.
- On native, tokens arrive via `Linking` and are handed to `setSession`. **Any
  app that registers the `lotusbet://` scheme could intercept that deep link**
  — this is an inherent weakness of custom schemes on iOS, not a bug here. The
  fix is Universal Links (`apple-app-site-association` + the associated-domains
  entitlement), which CLAUDE.md already notes is not set up. Track it with the
  App Store work.

---

## 5. Authentication

| Area | State |
| --- | --- |
| Password floor | 8 characters, client-side (`passwordProblem`). Supabase enforces its own minimum server-side. No complexity or breach-list check. |
| Session storage | AsyncStorage. **Not encrypted at rest.** On a non-jailbroken iPhone the app sandbox protects it; on a rooted/jailbroken device or an unencrypted backup it is readable. `expo-secure-store` is the upgrade. **MEDIUM**, deferrable for an MVP. |
| Token refresh | `autoRefreshToken: true`, standard. |
| `detectSessionInUrl` | Now `Platform.OS === 'web'` only — correct; it must not be on where there is no URL bar. |
| Sign-out | Clears the Supabase session, the profile, and (new on this branch) the signed-media URL cache. |
| Email confirmation | Supported both on and off; the sign-up screen handles the no-session case. |
| Account deletion | **Missing entirely.** Finding #4. |
| Stale sessions | A revoked/expired refresh token surfaces as a failed request; there is no global 401 handler that forces a clean sign-out. Minor UX-security nit. |

### Finding #4 — account deletion (MEDIUM, and an App Store blocker)

There is no delete path in `queries.ts`, no RPC, no UI. Guideline 5.1.1(v)
requires in-app account deletion for any app that offers account creation, so
this is a submission blocker as well as a privacy obligation.

It needs a product decision, because a user's rows are load-bearing for other
people: **what happens to a resolved bet's ledger lines when a participant
deletes their account?** Deleting them would unbalance a settled ledger for
everybody else. The defensible answer is a **soft delete**: scrub
`display_name` to "Deleted user", null `email`, `phone`, `avatar_url`,
`expo_push_token` and `username`, delete `bet_comments` and `bet_likes`, leave
`bet_ledger_entries` and `bet_positions` intact, then delete the `auth.users`
row. Flag this to the product owner before building it.

---

## 6. Media

### What is right

The `bet-media` bucket is private. Storage policies read the group id out of
the first path segment and reuse `is_group_member`, so the bucket and the table
enforce the same rule. Reads are short-lived signed URLs. Uploads are laid out
`<group_id>/<bet_id>/<file>` with a random filename, so **path traversal is not
reachable**: the client never supplies a path component that is not a UUID it
already had, and the extension comes from a fixed `EXTENSION_BY_MIME` map rather
than from the uploaded filename.

Delete is `uploaded_by = auth.uid()` — you can withdraw what you put up and
nobody else can, including the bet's creator.

### Finding #5 (MEDIUM) — uploads are client-asserted

`uploadBetMedia` sends whatever `expo-image-picker` returned. The `kind`
(`image` / `video`), the `mimeType` and the size are all **claims made by the
client**, and a modified client can claim anything. Supabase Storage enforces a
per-bucket file-size cap and an allowed-MIME list only if the bucket is
configured with them — check the dashboard; I cannot see bucket config from the
repo.

What that allows today: storing arbitrary bytes (up to the plan's 50 MB object
cap) in your own group's prefix, labelled as an image. It is a storage-abuse and
a serve-untrusted-content problem rather than an RCE — the app renders through
`expo-image` / `expo-video`, which will simply fail on a non-media file.

**Partly fixed** in `…_media_limits.sql`, which does the half that lives in this
repo:

- `bet_media.bytes` is filled from `storage.objects.metadata` — the size Storage
  actually recorded, not a number the client sends.
- A row whose `kind` disagrees with the object's content type is refused, as is
  anything that is neither `image/*` nor `video/*`.
- **250 MB of uploads per account**, summed over that column. Sized against the
  1 GB a Free bucket holds: four accounts could fill it, which is the point — a
  limit nobody reaches is not a limit.

**What it does not do, and this matters:** Storage records the content type the
uploader *declared*. Nothing here sniffs magic bytes, so a determined client can
still call an MP4 a JPEG. What is removed is the unbounded part and the case
where the row and the object disagree. The bucket's own `allowed_mime_types` and
`file_size_limit` remain the first line of defence and remain a dashboard
change only you can make.

### Finding #6 (MEDIUM) — EXIF is not stripped

`expo-image-picker` re-encodes stills at the configured quality, which drops
most metadata in practice, but this is **not a guarantee** and it does not apply
to video at all. A photo taken to prove a bet in someone's flat can carry GPS
coordinates, and every member of the group can download the object.

**Fixed for stills.** `stripMetadata` in `media.ts` re-encodes every picked or
captured photo through `expo-image-manipulator` with no actions before it is
uploaded. The encoder writes a fresh file from decoded pixels, so there is no
EXIF block to carry anything over; on the web the same call goes through a
canvas, which drops metadata for the same reason. It runs on all four entry
points — library and camera, attachment and proof.

A failure is **surfaced, not swallowed**. Falling back to the original would
upload the coordinates anyway and say nothing, which is precisely the "not a
guarantee" state this finding is about.

**Video is not covered, and pretending otherwise would be worse than not
trying.** `expo-image-manipulator` does not touch it. The mitigation that
exists is the 15-second cap on proof clips; stripping video metadata needs a
transcoding step nothing in this stack has. Left open, honestly.

### Finding #8 (LOW) — signed URLs are unrevocable bearer tokens

A signed URL is valid for its hour regardless of what happens to group
membership. If someone is removed from a group, any URL they already hold keeps
working until it expires. This branch **lengthens the practical exposure** by
caching signed URLs for 45 minutes rather than re-signing per load — the URL
lifetime is unchanged, but a given URL is now handed out for longer.

Accepted trade: an hour is short, the content is a photo of a bet, and the
alternative (a signing round trip on every feed refresh) was a real performance
cost. Worth revisiting if groups ever contain people you would actively remove.

---

## 7. Abuse, DoS and DDoS

Being precise, because this is where security documents usually lie:
**application code cannot prevent a DDoS.** Volumetric attacks are absorbed
upstream or not at all. What application code can do is stop *cheap* requests
from causing *expensive* work, and make abuse attributable.

### What the provider gives you

| Layer | Who handles it |
| --- | --- |
| Volumetric / network flood (L3-L4) | Cloudflare, in front of both the Workers site and Supabase's own edge. Not yours. |
| TLS termination, basic HTTP hygiene | Provider. |
| Auth endpoint rate limits | Supabase Auth applies per-IP token buckets (most buckets cap around 30 requests) on sign-up, sign-in, OTP, verify, token refresh and password recovery, and separately caps outbound email. These are **configurable on Pro with custom SMTP** and fixed on the shared sender. |
| PostgREST / database request limits | **None by default.** This is the gap. |

### What is unprotected right now

Every one of these is an authenticated user with a valid JWT making ordinary,
policy-compliant requests as fast as they like:

| Vector | Cost to attacker | Cost to you |
| --- | --- | --- |
| Bet creation spam | one insert | rows, feed pollution for their groups |
| Comment spam | one insert | rows; every group member's feed |
| Like/unlike flapping | one upsert/delete | rows + a Realtime broadcast each |
| Group creation | one RPC | rows |
| Invite generation | one RPC | **bounded** — `create_group_invite` reuses a live invite |
| Media upload | one PUT | **storage quota**, the most expensive one |
| `group_balances` / `my_group_balances` | one RPC | full aggregate over the group's ledger; the most expensive read in the app |
| Realtime connections | one WebSocket | counts against a **200-connection** ceiling on Free |
| Password-reset requests for someone else's address | one POST | Supabase's email quota, and inbox spam for the victim |

The genuinely dangerous ones are **media upload** (fills a 1 GB bucket, which
takes down everyone's photos) and **Realtime connections** (200 concurrent on
Free is a low ceiling to exhaust).

### What to actually build, in order

1. ~~**Database-level throttles first**~~ — **done**, in `…_abuse_limits.sql`:
   one parameterised `enforce_write_rate` trigger doing comments 30/hr, bets
   15/hr, groups 5/day and media 40/day. They are cheap and they cannot be
   bypassed by a modified client. The original sketch:

   ```sql
   -- Refuse more than 20 comments per user per hour.
   create or replace function public.enforce_comment_rate() returns trigger
   language plpgsql security definer set search_path = public as $$
   begin
     if (select count(*) from public.bet_comments
         where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 20 then
       raise exception 'Slow down.' using errcode = '53400';
     end if;
     return new;
   end $$;
   ```

   Do the same for bets per hour, groups per day and media uploads per day.
2. **Bucket limits**: `file_size_limit` and `allowed_mime_types` on `bet-media`.
   One dashboard change, removes the worst vector.
3. ~~**Storage quota per user**~~ — **done**, in `…_media_limits.sql`: 250 MB,
   summed from the sizes Storage recorded rather than from anything the client
   claimed.
4. **Monitoring before more mitigation.** You cannot tune a limit you cannot
   see. Supabase's dashboard has the request and storage graphs; watch them.
5. **A WAF / Cloudflare rules** only once there is traffic worth attacking.
6. **Account throttling** — a `users.suspended_at` column checked by the
   membership helpers — is the endgame, not the starting point.

Do not build 4-6 for an MVP with fifty users. Do build 1 and 2.

---

## 8. XSS and user-generated content

React Native has no DOM, so the classic injection sink does not exist on
device: `<Text>{comment.body}</Text>` renders text, always.

**The web build is the one that matters**, and it is still React — React escapes
interpolated children. I checked for the escape hatches and found **no
`dangerouslySetInnerHTML`, no `eval`, no `new Function`, and no `WebView`**
anywhere in `src/` or `app/`. User strings (display names, usernames, group
names, bet titles and descriptions, option labels, comment bodies) all reach the
screen through `<Text>`.

The residual risks are presentational rather than executable, and worth fixing
cheaply (**finding #10, INFO**):

- **No length clamp on display names in most render sites.** `maxLength={40}` is
  enforced in the input, but not by a database `check`, so a crafted client can
  store a very long name. Most sites use `numberOfLines`, but not all.
- **No unicode normalisation.** Zalgo combining marks and RTL override
  characters (U+202E) in a display name or comment will render as intended by
  the attacker and can visually scramble a thread. Normalising to NFC and
  stripping bidi-control characters on write is a ten-line function.
- **Homoglyph impersonation** on `username` — `раypal` with Cyrillic а is a
  different string from `paypal`. Matters more once handles are used to
  challenge people.

Add `check (char_length(body) between 1 and 500)` to `bet_comments` and the
equivalents elsewhere; the client already limits, the database does not.

---

## 9. Privacy — what is exposed to whom

| Data | Exposed to | Correct? |
| --- | --- | --- |
| Email address | **every groupmate** | **No — finding #1** |
| Phone number | **every groupmate** | **No — finding #1** |
| Expo push token | **every groupmate** | **No — finding #1** |
| Display name, avatar, username | every groupmate | Yes, intended |
| Group membership | members of that group | Yes |
| Private bets | group members on the invitee list only, via `can_see_bet` | Yes |
| Bet media | members of the owning group, signed URL | Yes |
| Ledger balances | members of the group | Yes, that is the product |
| Profile ledger (who owes who, netted) | only the user themselves, via `my_group_balances()` | Yes |
| Invite tokens | every group member | Weak — finding #7 |

---

## 10. Secrets

I searched the repository for credentials.

**Clean.** No service-role key, no JWT secret, no SMTP password, no private key
anywhere in tracked files. `.env` is gitignored (`.gitignore:12-14`). The
`SUPABASE_ACCESS_TOKEN` used by the MCP config is read from the environment via
`${SUPABASE_ACCESS_TOKEN}` and is not in the file.

`.env.example` contains a real project URL and a **publishable** anon key. That
is correct and intended — the anon key is designed to ship in the client and is
protected by RLS. Its comment says so.

### The thing to actually understand about Expo and secrets

**Metro inlines `process.env.EXPO_PUBLIC_*` as string literals at build time.**
Anything with that prefix is in the bundle, readable by anyone who downloads the
app. There is no such thing as a secret `EXPO_PUBLIC_` variable. Today that is
only the Supabase URL, the anon key, the web origin and the EAS project id — all
fine.

The trap CLAUDE.md §8 already documents is worth repeating here because it is a
*security* trap and not just a build one: **Metro caches those inlined values**,
so an export run after a demo export inherits `EXPO_PUBLIC_ENABLE_DEMO="1"` and
ships the demo entry point — with the variable name nowhere in the output,
because the value was folded in. Grepping the bundle for the flag finds nothing.
The only honest check is to load the built page and look for the button.
`build:web` passes `--clear`; any deploy path must keep doing so.

**Never** put the service-role key in the client. It bypasses RLS entirely. It
belongs only in Edge Function environment variables.

---

## 11. Security test plan

### Automatable in the existing SQL harness (`supabase/test/run.sh`)

The harness drives 36 sections as the `authenticated` role with a JWT
subject.

| # | Test | Asserts | Status |
| --- | --- | --- | --- |
| 23 | Select `email`, `phone`, `expo_push_token` from a groupmate | permission denied | ✅ §25 |
| 24 | Non-member selects `group_invites` for a group they are not in | zero rows | ✅ §35(a) |
| 25 | Ordinary member selects `group_invites` | zero rows, after #7 is fixed | **dropped** — #7 is won't-fix, see §4 |
| 26 | 31st comment in an hour | raises `53400` | ✅ §33(b) |
| 27 | Insert `bet_comments` with a 501-character body | rejected by a `check` | ✅ §34(a) |
| 28 | Insert a `bet_media` row whose `storage_path` starts with another group's id | refused | ✅ §34(b) |
| 29 | Non-invitee selects a private bet's `bet_comments` | zero rows (regression guard on `can_see_bet`) | ✅ §36(b) |
| 30 | `update public.users set id = <other>` | refused | ✅ §35(b) |

Added beyond the original plan, because each guards something the fixes above
introduced: §29 (a deletion leaves every other balance unchanged and the group
still nets to zero), §30 (nobody can delete or tombstone another profile), §31
(terms acceptance is recorded, never invented, unforgeable — and a new signup
still gets a handle), §32 (the display-name clamp ran and the constraint
holds), §33(e) (a path with no `auth.uid()` is deliberately **not** throttled,
so seeding and the push fan-out keep working).

The harness is at **55 asserted refusals**, exit 0.

### Needs a real project (cannot run in the harness)

- PostgREST column-privilege behaviour after fixing #1 — **this is the one that
  must be smoke-tested before merge**, because a refused select returns no rows
  rather than an error the UI can show.
- Storage: upload to another group's prefix; fetch an object without a signature;
  reuse a signed URL after being removed from the group.
- Auth: hammer sign-in and password reset to observe the real rate-limit
  responses.
- Push: send to a token harvested from `users` (demonstrates #1's impact).

### Manual, once per release

- Confirm the demo entry point is absent from the production bundle by loading
  the deployed page and looking for "Skip sign-in".
- Confirm no `service_role` string appears in the built bundle.

---

## 12. Fix order

1. **Finding #1** — users table column exposure. Everything else is smaller than
   this. Needs a migration, a `queries.ts` change and a real-project smoke test.
2. **Finding #2** — database-level rate-limit triggers on comments, bets, groups
   and media, plus bucket `file_size_limit` / `allowed_mime_types`.
3. **Finding #3** — block, report, moderate. Also required by App Store §1.2.
4. **Finding #4** — account deletion. Also required by §5.1.1(v). Needs the
   soft-delete product decision in §5 first.
5. ~~**Finding #5**~~ — upload validation, less the bucket settings and magic
   bytes. **Finding #6**, EXIF stripping, is still open and needs a dependency
   decision (`expo-image-manipulator`).
6. ~~**Finding #7**~~ — **won't fix as written**, see §4.
7. ~~**Finding #10**~~ — length checks and unicode normalisation.
8. ~~**Finding #9**~~ — the Realtime subscriptions are filtered. **Finding #8**,
   signed-URL lifetime, stands as an accepted trade.

Items 3 and 4 are on the App Store critical path, so in practice they will be
scheduled alongside item 1 rather than after it.
