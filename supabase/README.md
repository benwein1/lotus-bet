# Supabase setup

## 1. Create the project

Create a project at [supabase.com](https://supabase.com), then copy the URL and
anon key from **Project Settings → API** into `.env` at the repo root:

```
EXPO_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key>
```

Both are safe in the client bundle — every table is protected by RLS.

## 2. Apply the migrations

```bash
npx supabase link --project-ref <ref>
npx supabase db push
```

Or paste the files in `migrations/` into the SQL editor, in filename order:

| File | Contents |
| --- | --- |
| `…_init.sql` | Tables: users, groups, group_members, bets, bet_positions, bet_ledger_entries, settlement_confirmations |
| `…_rls.sql` | Row Level Security policies, membership helpers, Realtime publication |
| `…_functions.sql` | Signup trigger, invite codes, group/bet/settlement RPCs, stats |
| `…_email_auth.sql` | Email accounts: `users.email`, `users.profile_completed`, a nullable `phone`, and the signup trigger that seeds a named profile |
| `…_bet_media.sql` | The `bet_media` table and the private `bet-media` storage bucket with its policies |
| `…_avatars.sql` | `groups.avatar_url` and the public `avatars` bucket, for profile and group photos |
| `…_bet_options.sql` | `bet_options`, so a bet can have up to eight, and `resolve_bet_with_entries`, which makes resolution one transaction. Backfills every existing bet, so it briefly disables `bet_positions_require_open` — that trigger refuses any write to a position on a bet that is not open, which includes filling in a new column on one |
| `…_notification_prefs.sql` | Two more notification switches, and the service-role-only functions that decide who a push goes to |

The last two are separate on purpose: the media one touches `storage.objects`,
which not every project lets you change from the SQL editor. If it fails, the
account migration before it still stands and the app runs — you just cannot
attach photos yet.

### What the policies guarantee

- You can only read or write rows for a group you have a `group_members` row in.
  Membership is checked through `SECURITY DEFINER` helpers so the policy on
  `group_members` does not recurse into itself.
- Only a bet's `creator_id` can lock, resolve or cancel it.
- `bet_positions` can only be created, switched or withdrawn while the bet is
  `open` and before its `close_at` — enforced by a trigger, so it holds no
  matter which path writes the row.
- `bet_ledger_entries` is **read-only** for clients. Only
  `resolve_bet_with_entries` writes it, and it refuses a ledger that does not
  balance: one entry per participant, winners positive, losers negative,
  credits totalling the pot exactly and debits totalling minus the pot.
- `push_targets_for_bet` and `push_targets_for_group` are revoked from
  `authenticated`. They return device tokens, so only the service role — the
  `notify` function — may call them.

## 3. Enable email auth

**Authentication → Providers → Email**: enable it. Nothing else is required —
there is no SMS provider, no OAuth app, no third-party service.

Two settings worth a decision:

- **Confirm email.** On by default. With it on, `signUp` returns no session and
  the app shows a "check your inbox" screen; with it off the user is signed in
  immediately. Either works — the app handles both.
- **Site URL / redirect URLs** (Authentication → URL Configuration). The
  confirmation and password-reset links point here. For local development add
  `http://localhost:8081`; for a device build add the app's scheme,
  `lotusbet://`.

The `on_auth_user_created` trigger mirrors each new `auth.users` row into
`public.users`. The sign-up form sends the display name in the user metadata,
so a new account arrives already named and `profile_completed` is true; without
one it gets a placeholder and the app's profile-setup screen takes over.

`users.phone` is still on the table, nullable, for accounts created under the
old phone-OTP flow.

## 3b. Storage for bet media

The `…_bet_media.sql` migration creates a **private** `bet-media` bucket and
its policies. Objects are laid out as
`<group_id>/<bet_id>/<file>.<ext>`, so every policy reads the owning group out
of the first path segment and reuses the same `is_group_member` helper the
tables use. Nothing is public: the app reads through short-lived signed URLs.

If your project blocks `insert into storage.buckets` from the SQL editor,
create the bucket by hand under **Storage → New bucket** (name `bet-media`,
*not* public, 50 MB limit) and run only the policy half of that migration.

### Applying by hand

Paste each file into **SQL Editor → New query** and run them in filename
order. `…_email_auth.sql` is the one the app cannot start without: until it
runs, naming yourself fails with *"Could not find the 'profile_completed'
column of 'users' in the schema cache"* — PostgREST is reporting a column that
genuinely is not there yet.

## 4. Deploy the Edge Functions

```bash
npx supabase functions deploy notify
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

| Function | Called by | Does |
| --- | --- | --- |
| `notify` | The app, after posting a bet, joining a group, or calling a bet | Checks the caller may announce this, asks the database who wants to hear it, and hands the list to Expo |

There used to be a second function, `resolve-bet`. It is gone: resolution goes
through the `resolve_bet_with_entries` RPC so the ledger rows and the status
flip land in one transaction, and the old function could only ever name a
winner as `'a'` or `'b'`.

`notify` authenticates the caller from the `Authorization` header — it will not
act anonymously.

**The deadline reminder is not here.** It is a local notification scheduled on
the device, so it needs nothing deployed and works in Expo Go.

## 5. Push notifications

Push tokens need a development build (they do not work in Expo Go on iOS) and
an EAS project id:

```bash
npx eas init          # writes extra.eas.projectId into app.json
npx eas build --profile development --platform ios
```

Without one, `registerForPushNotifications()` logs a warning and returns null;
everything else in the app keeps working.

## Schema notes

- **Money is integer agorot everywhere** (1 ILS = 100 agorot). Never floats.
- `public.users.id` references `auth.users(id)` so every policy can compare
  against `auth.uid()` directly.
- `bet_ledger_entries` has a `unique (bet_id, user_id)` index, which makes a
  double-resolve a no-op rather than a double payout.
- A resolved bet always records `winning_option`, even when nobody backed the
  winning side — that case simply writes no ledger rows.
- `bet_media` carries a denormalised `group_id` so its RLS policy and the
  Realtime filter can both work without joining back to `bets`. Only the bet's
  creator can attach media, and only while the bet is still `open`.
