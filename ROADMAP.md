# What's left

A working list, roughly in the order I'd do it. Nothing here is done — it is
the state of the app as of the current branch, written down so the decisions
are visible rather than remembered.

Three things frame all of it:

- **Lotus Bet never touches money.** Nothing below adds payments, wallets or
  in-app currency, and nothing should. It is a product decision and an App
  Store compliance decision at the same time.
- **The payout maths is settled.** `supabase/functions/_shared/payout.ts` is
  the one implementation. Nothing below forks it.
- **`supabase/test/run.sh` now exercises the SQL.** Anything that changes the
  schema or a policy should extend `20_policy_checks.sql` in the same commit.

---

## 1. Before anyone else uses it

These are the ones that bite a real user, not a demo one.

### `resolve-bet` can strand a bet permanently
The Edge Function inserts the ledger rows and *then* flips the bet's status.
If the process dies between the two, the rows exist but the bet is still
`open`; the retry hits `unique (bet_id, user_id)`, throws, and that bet can
never resolve. Nobody can settle it and nobody can cancel it.

The fix is to make the two writes one transaction — a `SECURITY DEFINER` RPC
the function calls, which takes the computed entries and does both. The maths
stays in TypeScript; only the write moves.

### Nothing stops a second device from clobbering the first
`users.expo_push_token` is a single column, so signing in on a phone and a
tablet silently means only one of them gets notified. It needs its own table
keyed on (user, token) with a last-seen timestamp, and a sweep for tokens
Expo reports as dead.

### Media upload is not transactional with the bet
`createBet` inserts the bet, uploads each file, then writes the `bet_media`
rows. A failure part way leaves a posted bet missing attachments and orphaned
objects in the bucket. The bet surviving is the right failure mode, but there
is no cleanup path: orphans accumulate forever. A scheduled function that
deletes objects with no matching row after 24 hours would close it.

### Signed media URLs expire after an hour
A feed left open longer than that shows broken images until something
refreshes. Realtime and pull-to-refresh both re-sign, so it only shows on a
screen nobody has touched — but "nobody has touched it" describes a phone in
a pocket. Re-sign on app foreground, or drop the TTL check into the image
component.

### `announceNewBet` is client-invoked and fire-and-forget
If a client crashes, loses signal, or is simply a version that skips the call,
nobody in the group is told. A database webhook on insert into `bets` would
make it the server's job and stop it depending on which build posted the bet.

---

## 2. Security

Nothing here is a known hole. It is the list of things that are currently
resting on an assumption rather than on a check.

### The policies are tested; the storage policies are not
`run.sh` proves the table policies do what they claim. It does not prove the
same for `storage.objects` — the stub has the table and `foldername()`, but
real Supabase storage enforces through its own API, and the checks only
confirm the SQL parses. Two things worth verifying against a live project:
that a member of group A genuinely cannot fetch a signed URL for group B's
bucket path, and that the `avatars` write policies really do stop someone
writing under another user's id.

### The `avatars` bucket is public
Deliberate, and documented at the top of `20260906090000_avatars.sql`: an
avatar appears in a dozen places per screen and signing each one is a round
trip per face. The trade is that anyone holding the URL can fetch the image
even after the user leaves the group. Paths are unguessable and nothing else
is exposed, but if profile pictures ever need to be private this is where to
start.

### Rate limiting
There is none. Nothing stops a client creating groups, bets or positions in a
loop. At friend-group scale this is theoretical; before any kind of public
launch it is not. Supabase can do this at the edge, or a simple per-user
counter in a `SECURITY DEFINER` RPC.

### Invite codes are six characters and never expire
36^6 is fine against a human guessing and thin against a machine. Codes
should be rotatable by an admin, and ideally expire. Right now a code shared
in a WhatsApp group two years ago still works.

### No account deletion
There is no way to delete an account or leave a group from the UI, which is
an App Store requirement for anything with accounts, and a GDPR one. The
cascade is already right in the schema — it needs the screens and an RPC.

### Emails are visible to the server, not to members
Worth stating explicitly somewhere user-facing: `users.email` is selected by
`user:users(*)` in group queries, so a group member *can* read another
member's email through the API even though no screen shows it. Narrowing that
select to the columns the app actually renders would be a one-line fix and a
real improvement.

---

## 3. Reliability

### There is no CI
Nothing runs `typecheck`, `test`, `theme:check` or `run.sh` automatically. A
regression is caught only if someone remembers. A GitHub Actions workflow
doing those four things on every push is an hour's work and would have caught
at least two things by hand this week.

### Nothing tests the React layer
The 50 unit tests cover payout, settlement, formatting and theme drift — all
pure logic. Not one component is rendered in a test. The Playwright walk that
found the real bugs lives in `/tmp` and is thrown away every session; it
should be a checked-in script with the export step in it.

### `useFocusEffect` in `groups.tsx` has empty deps
It works because `reload` is stable, but it is an eslint-disable holding the
line. A refactor of `useAsync` would silently stop the group list refreshing
and nothing would fail.

### Realtime subscribes to `bet_positions` unfiltered
`bet_positions` has no `group_id`, so every client gets every position change
in the project. Fine at this scale, wasteful past it, and it leaks the *shape*
of activity in groups you are not in. Denormalising `group_id` onto the table
fixes both.

### `npm run lint` does not run
There is no ESLint config in the repo. Worth fixing simply so the command in
the README is true.

---

## 4. Design

**Done.** Kept here as a record of what was decided and what is left.

### ~~The feed is the product and it is still thin~~ — mostly done
Bets posted since your last visit carry a New badge, and a pill takes you back
to the top and says how many there are. Reaching the end of the feed now
offers bets you could post rather than stopping dead.

Still open: no way back to a *specific* bet you scrolled past, and no
per-bet read state — only "since when". A bet you saw and ignored looks the
same as one you never reached.

### ~~Empty states carry the whole first-run experience~~ — done
The feed offers real bets to post, tapping one opens the new-bet form
prefilled; the groups tab explains what a group is in three steps; the stats
block says what will fill it instead of reporting zeroes. `src/lib/demo.ts`
grew a `fresh` seed so these screens can actually be looked at.

Still open: the suggestion catalogue is fifteen fixed prompts. It does not
know anything about the group it is posting into, and after a few weeks a
regular user will have seen all of them.

### ~~Resolution deserves a moment~~ — done
The badge and the amount land after the card with the one spring in the app
that overshoots, and only on a win.

### ~~The odds bar shows headcount, not conviction~~ — done
It names the denominator now.

### ~~Light mode is correct but unloved~~ — done, and it was measurable
Light mode failed fifteen of the twenty-six contrast pairings the app
renders. Every colour that failed was solved against WCAG AA rather than
re-picked by eye, and `__tests__/theme.test.ts` now fails if any of them
regress.

### ~~Accessibility has not been audited~~ — partly done
Contrast is enforced by test in both palettes. Buttons and side-picks take
minimum heights rather than fixed ones, so a label at the larger Dynamic Type
sizes is not clipped. Every pressable was checked for a name and a role, and
the five real gaps fixed.

Still open, and it needs a device rather than a browser:

- Nothing has been through VoiceOver end to end. Reading order, focus after
  a modal opens and closes, and whether the feed's card-per-screen paging
  makes sense to a screen reader are all unknown.
- Dynamic Type is mitigated, not verified. The fixed heights that would clip
  are gone, but no screen has been *looked at* at AX5.
- Nothing has been tried with Reduce Transparency on, which turns the
  floating tab bar's material into a flat fill.

## 5. Functionality worth considering

Roughly in order of how much I think each is worth.

### Comments on a bet
The obvious missing thing. A bet between friends is an argument, and the app
currently has nowhere to have it. This is the feature most likely to make
people open the app when they have not posted anything.

### Reminders before a bet closes
A bet with a `close_at` that nobody joined is a wasted post. One push at an
hour out, to group members who have not taken a side.

### More than two outcomes
The schema is already shaped for it — `bets` has `option_a_label` /
`option_b_label` specifically so a `bet_options` table can supersede them.
The payout maths generalises cleanly (it already splits an arbitrary winner
set). The UI is the work.

### Settle-up that survives disagreement
Marking a payment as paid is currently one-sided: the payer says so and both
balances move. There is no way for the payee to dispute it, and no history of
who marked what. A confirmation step, or at minimum an audit trail, before
this is used for amounts anyone cares about.

### Group admin
No way to remove a member, transfer admin, rename a group, or leave one.
Every group is permanent and its membership only grows.

### A bet you can watch without joining
Sitting out is currently indistinguishable from not having seen it. A "follow"
would let the notification story work for people who did not take a side.

### Stats that mean something
`my_stats` returns totals. What people actually want is a leaderboard within
a group, and a record against a specific friend. Both are one query away.

### `my_stats.bets_settled` counts ledger rows
So a bet that resolved with nobody on the winning side is not counted.
Arguably correct — nothing moved — but it is currently an accident rather
than a decision. Worth deciding.

---

## 6. Before shipping

- Delete the demo mode. `src/lib/demo.ts` and
  `src/components/demo-entry.tsx`, then grep for `isDemoMode`, `DemoEntry`
  and `DemoBadge` — every call site is a one-line guard. It is gated behind
  `__DEV__` so it cannot reach production, but it should not be in the
  repository at that point either.
- Delete `supabase/seed/test_members.sql`'s five accounts from the live
  project. The undo block is at the bottom of that file.
- App Store review will ask about the betting. The answer is on the auth,
  new-bet, settle-up and profile screens already — no money moves through
  the app, nothing is purchasable, obligations are settled between friends
  outside it. Keep that text.
- Privacy policy and terms. There is neither, and the App Store requires
  both.
- The migrations carry no `grant` statements. Supabase issues them
  automatically on its own projects, which is why the app works — but it
  means the schema is not portable to a plain Postgres without the grants in
  `supabase/test/10_fixture.sql`. Worth folding into a migration if this ever
  runs anywhere else.
