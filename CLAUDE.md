# CLAUDE.md — Lotus Bet

Guidance for Claude Code working in this repo. Read this before touching
anything; the NativeWind and money-invariant sections in particular encode
mistakes already made and fixed once.

---

## 1. What this is, and the one rule that never bends

An iOS-first React Native app where friends form groups, post two-outcome
bets against each other, and the app tracks who owes whom.

**Lotus Bet never touches money.** No payments, no wallets, no in-app
currency, nothing purchasable, no payment-processor integration. It records
obligations; users settle up outside the app (cash, Bit, bank transfer).

This is a deliberate product and App Store compliance decision, not an
oversight and not a gap to fill. Do not add payment features, "wallet
balance" UI, or anything that could read as holding funds — even if a task
description seems to imply it. The disclaimer text on the auth, new-bet,
settle-up and profile screens is load-bearing; don't delete it during a
redesign.

Other standing scope boundaries:

- **Two outcomes only.** The `bets` table has `option_a_label` /
  `option_b_label` and is shaped so a future `bet_options` table can
  supersede them. Don't build >2-option UI yet.
- **No public or global discovery.** Bets are always scoped to a group.
- **No editing a bet after creation.** The creator can lock, resolve or
  cancel. That's the whole surface.

---

## 2. Commands

```bash
npm install
cp .env.example .env      # fill in Supabase URL + anon key first

npm start                 # Expo dev server; press "i" for iOS simulator
npm run web               # fastest loop for design work — no Xcode needed
npm run ios / android

npm test                  # jest — 48 tests, all pure logic, no backend
npm run typecheck         # tsc --noEmit
npm run lint
```

Always run `npm run typecheck && npm test` before claiming a change works.
They are fast (a few seconds combined) and there is **no CI in this repo** —
nothing will catch a regression for you.

To check the app actually bundles (catches things typecheck can't, like a
bad Metro resolution):

```bash
npx expo export --platform ios --output-dir /tmp/export-check
```

---

## 3. Stack and layout

Expo SDK 57 · React Native 0.86 · Expo Router · TypeScript (strict, with
`noUncheckedIndexedAccess`) · NativeWind 4 · Supabase (Postgres, Auth,
Realtime, RLS, Edge Functions).

```
app/                        Expo Router routes
  _layout.tsx               root stack + the single auth redirect gate
  (auth)/                   phone → verify → profile-setup
  (tabs)/                   index (Home feed) · groups · profile
  group/create.tsx, join.tsx
  group/[id]/               index (detail) · new-bet · settle
  bet/[id].tsx              join a side, resolve, cancel
src/
  lib/payout.ts             re-export ONLY — see §5
  lib/settlement.ts         balance netting + greedy debt simplification
  lib/queries.ts            every Supabase read/write the app makes
  lib/format.ts             agorot ↔ shekels, countdowns, initials, phone
  lib/database.types.ts     hand-written row types
  lib/supabase.ts           client; `isSupabaseConfigured` guard
  lib/notifications.ts      Expo push registration + announceNewBet
  components/               ui.tsx (primitives), bet-card.tsx, odds-bar.tsx
  hooks/                    use-async, use-group-realtime, use-settlement
  providers/auth-provider.tsx
  theme.ts                  re-exports theme-colors.json
theme-colors.json           SINGLE SOURCE OF TRUTH for the palette
supabase/
  migrations/               schema · RLS · RPCs (3 files, apply in order)
  functions/_shared/        payout.ts (canonical), push.ts, supabase.ts
  functions/resolve-bet/    the only writer of bet_ledger_entries
  functions/notify-new-bet/
__tests__/                  payout · settlement · format
```

**All Supabase access goes through `src/lib/queries.ts`.** Screens never
build queries inline. If a table isn't touched in that file, the client
never reads it — which is what makes the RLS surface auditable.

---

## 4. Design system — read before any UI work

### The palette

`theme-colors.json` is the only place colours are defined. `tailwind.config.js`
requires it; `src/theme.ts` re-exports it as `colors`. **Never hardcode a hex
value in a component.**

| Token | Use |
| --- | --- |
| `ink.950` → `ink.600` | backgrounds (950 darkest) → secondary text |
| `ink.500` | avatar monograms, brighter secondary text |
| `lotus.400/500/600` | brand accent, primary buttons, links |
| `sideA` (green) / `sideB` (orange) | the two sides of a bet |
| `owed` (green) / `owing` (red) | money you're owed / you owe |

Use `className` everywhere you can. Reach for `colors.*` only where NativeWind
can't apply a class: React Navigation `screenOptions`, `placeholderTextColor`,
`RefreshControl` `tintColor`, `Switch` `trackColor`, and animated styles.

The app is **dark-only and committed to it** — there are no `dark:` variants
anywhere. That's a design decision, not an omission.

### NativeWind gotchas (each of these has already bitten once)

1. **`className` does nothing on `Animated.View`** from
   react-native-reanimated. NativeWind doesn't wrap it. The odds bar shipped
   invisible because of this. Style animated components with plain `style`
   objects and `colors.*`. See `src/components/odds-bar.tsx` for the pattern.

2. **No dynamic class names.** `` `border-${tone}` `` compiles to nothing —
   Tailwind needs literal strings. Spell both branches out:
   `tone === 'a' ? 'border-sideA' : 'border-sideB'`. See `SideButton` in
   `app/bet/[id].tsx`.

3. **`darkMode: 'class'` in `tailwind.config.js` must stay.** Under the
   default `'media'`, NativeWind's web colour-scheme observer calls
   `colorScheme.set()` when the stylesheet lands and that function throws
   outright. Every `npm start` on web crashed until this was set. Production
   `expo export` builds don't reproduce it — only the dev server does.

4. `contentContainerClassName` **is** supported on ScrollView. Use it.

5. Emoji ignore `color`. The tab bar dims inactive icons with `opacity`
   instead — see `TabGlyph` in `app/(tabs)/_layout.tsx`.

### Where the design currently stands

Screens verified rendering: auth, Home feed, Groups, group detail, bet detail
(open and resolved), settle-up, Profile.

Known-thin areas, in rough priority order for a design pass:

- **Loading states** are a bare spinner (`Loading` in `ui.tsx`). Skeletons
  would help most on Home and group detail.
- **Tab icons are emoji.** Deliberate, to avoid an icon-font dependency at
  MVP. Swapping to SF Symbols / `expo-symbols` is a one-component change.
- **Resolution has no moment.** A bet resolving is the emotional peak of the
  app and currently just re-renders a card. No animation, no celebration.
- **Empty states** are emoji + two lines of text. Fine, not memorable.
- **`avatar_url` exists in the schema but has no upload UI** — avatars are
  initials-only everywhere.
- **Contrast** was already too low once (`ink.600` monograms on `ink.700`).
  If you darken secondary text, check it against `ink.900` card backgrounds.
- Group detail is meant to be the most visually engaging screen. It's decent;
  it isn't yet delightful.

---

## 5. The money invariants — the highest-risk code in the repo

`supabase/functions/_shared/payout.ts` is the canonical implementation:
dependency-free, no imports, no I/O, no Deno or React Native globals.

- `src/lib/payout.ts` is a **pure re-export**. Don't put logic in it.
- `supabase/functions/resolve-bet/index.ts` imports the shared module
  directly.

That arrangement is deliberate: the unit-tested code is byte-for-byte the
code that writes the ledger. **Do not fork, copy or reimplement this
module** — if the app and the Edge Function ever run different maths,
someone gets paid the wrong amount.

The rules, which are settled product decisions and not open to redesign:

- One fixed pot per bet, set by the creator. It does not scale with joiners.
- Winners split `floor(pot / W)`; losers cover `floor(pot / L)`.
- Remainders (`pot % W`, `pot % L`) go one agora at a time to the
  lowest-sorting `userId`, so both sides net to **exactly** the pot and the
  result never depends on row order from Postgres.
- `W === 0` or `L === 0` → the bet resolves with `paidOut: false` and **no
  ledger rows**. Nothing moves.
- **Money is integer agorot everywhere.** 1 ILS = 100 agorot. Never floats,
  never `parseFloat`, never `toFixed` on a stored value.

`__tests__/payout.test.ts` includes property-style tests asserting the books
balance across every plausible split. If you change this module and those
tests still pass, you probably didn't break it. If you change the tests to
make a change pass, stop and reconsider.

---

## 6. Backend model

### Roles and who may write what

- **Clients** (anon key + RLS): read anything in their groups; write their
  own `bet_positions` and `settlement_confirmations`; create groups and bets.
- **`bet_ledger_entries` is read-only for clients.** Only the `resolve-bet`
  Edge Function writes it, using the service role.
- Membership is checked through `SECURITY DEFINER` helpers
  (`is_group_member`, `is_group_admin`, `shares_group_with`, `bet_group_id`)
  so the policy on `group_members` doesn't recurse into itself. **If you add
  a policy that queries `group_members` directly, you will create infinite
  recursion.** Use the helpers.
- Only a bet's `creator_id` can lock, resolve or cancel it.
- `bet_positions` can only be created, switched or withdrawn while the bet is
  `open` and before `close_at` — enforced by the `enforce_bet_open` trigger,
  so it holds no matter which path writes the row.

### RPC surface (`20260904090200_functions.sql`)

`create_group` · `join_group_with_code` · `join_bet` · `leave_bet` ·
`lock_bet` · `cancel_bet` · `group_balances` · `my_stats` · `set_push_token`

Anything spanning more than one table lives here rather than in the client,
so it stays atomic and can't be skipped.

### Settlement

Resolving writes one signed `bet_ledger_entries` row per participant — a
balance line, not a pairwise IOU. `group_balances(group_id)` sums those and
folds in `settlement_confirmations`: a payment of X from A to B moves A up X
and B down X. That's what stops a settled transaction reappearing.

`src/lib/settlement.ts` then runs greedy debt simplification client-side. It's
cheap and recomputed on every open — **don't persist the suggested
transactions.**

### bigint coercion

`group_balances` and `my_stats` return `bigint`, which PostgREST may hand
back as a string. Every read site wraps with `Number(...)`
(`use-settlement.ts:40`, `group/[id]/index.tsx:54`, `groups.tsx:82`,
`profile.tsx:81-82`). Keep doing that on any new consumer.

---

## 7. Known issues and suspected bugs

**The single most important caveat: none of the SQL in `supabase/migrations/`
has ever been run against a live Postgres by Claude.** It was written and
reviewed but never applied during the build — only the TypeScript was
typechecked and tested. Treat the schema, RLS policies and RPCs as
*unverified*. When a backend bug surfaces, the migration is a likely suspect.

Concrete things worth fixing, roughly by severity:

1. **`resolve-bet` can strand a bet permanently.**
   `supabase/functions/resolve-bet/index.ts` inserts the ledger rows (line 76)
   and *then* flips the bet's status (line 90). If the process dies between
   the two, the ledger rows exist but the bet is still `open`. A retry hits
   the `unique (bet_id, user_id)` index, throws, and the bet can never
   resolve. The two writes should be one transaction — most likely a
   `SECURITY DEFINER` RPC the function calls, or an upsert that ignores
   duplicates.

2. **`needsProfileSetup` traps a legitimate name.**
   `src/providers/auth-provider.tsx:84` decides setup is incomplete with
   `/^Player \d{0,4}$/`. A user who genuinely names themselves "Player 7"
   is redirected to profile-setup forever. Wants a real column
   (`profile_completed boolean`) rather than pattern-matching a placeholder.

3. **Signup trigger's phone fallback is unverified.**
   `handle_new_auth_user` uses `coalesce(new.phone, new.id::text)`. If
   `auth.users.phone` isn't populated at insert time for phone OTP signups,
   every user gets a UUID as their phone and a nonsense default display name.
   Check this first against a real signup.

4. **One push token per user.** `users.expo_push_token` is a single column,
   so a second device silently overwrites the first. Needs its own table when
   multi-device matters.

5. **`useFocusEffect` in `app/(tabs)/groups.tsx:19-24` has empty deps** with
   an eslint-disable. It works because `reload` is stable, but it's fragile —
   a refactor of `useAsync` could silently stop refreshing the group list.

6. **Realtime subscribes to `bet_positions` unfiltered** (in both
   `useGroupRealtime` and `useFeedRealtime`) because that table has no
   `group_id` column. Fine at friend-group scale, wasteful beyond it.

7. **`my_stats.bets_settled` counts ledger rows**, so bets that resolved with
   nobody on the winning side don't appear in the count. Arguably correct,
   worth a decision.

8. **`announceNewBet` is client-invoked** and fire-and-forget, so a client
   that skips it means no one gets notified. A database webhook would be more
   reliable.

### Fixed, but easy to reintroduce

**"cannot add `postgres_changes` callbacks for realtime:… after
`subscribe()`."** This crashed the group, settle-up and bet screens. Two
causes, both now guarded in `src/hooks/use-group-realtime.ts`:

- Callers built `refresh` with `useCallback(..., [bets, balances, group])`,
  but `useAsync` returns a **new object every render**, so the callback's
  identity changed constantly and the channel was torn down and reopened on
  every render. `removeChannel` is async, so the reopen raced its own
  teardown. Depend on `xxx.reload` (a stable `useCallback(..., [])`), never on
  the state object.
- Screens stack: settle-up sits on top of group detail and **both** watch the
  same group, so a channel named only `group:<id>` collided with a live one.
  Channel names now carry a per-instance `useId()` suffix.

If you add another `useAsync` consumer that feeds a Realtime callback, or a
third screen watching the same group, keep both properties.

---

## 8. Local dev: getting past phone auth without SMS

Hosted Supabase has **no** "test phone numbers" feature — that's self-hosted
only. To sign in without a paid SMS provider, the project uses a **Send SMS
Hook** implemented as a Postgres function that writes the OTP to a table.

Set up by hand in the SQL editor (deliberately **not** a migration — it must
never reach production):

```sql
create schema if not exists dev;

create table if not exists dev.sms_outbox (
  id bigint generated always as identity primary key,
  phone text not null, otp text not null,
  created_at timestamptz not null default now()
);

create or replace function dev.send_sms(event jsonb)
returns jsonb language plpgsql
security definer set search_path = dev, pg_temp
as $$
begin
  insert into dev.sms_outbox (phone, otp)
  values (event->'user'->>'phone', event->'sms'->>'otp');
  return '{}'::jsonb;
end;
$$;

alter function dev.send_sms(jsonb) owner to postgres;
grant usage on schema dev to supabase_auth_admin;
grant execute on function dev.send_sms(jsonb) to supabase_auth_admin;
revoke execute on function dev.send_sms(jsonb) from authenticated, anon, public;
```

`security definer` is required — `supabase_auth_admin` is locked down and
cannot reach outside the `auth` schema on grants alone. Enable it at
**Authentication → Hooks → Send SMS** (Postgres type, schema `dev`, function
`send_sms`). This disables the SMS provider settings, so Twilio fields become
irrelevant.

Then sign in with any number and read the code:

```sql
select otp from dev.sms_outbox order by created_at desc limit 1;
```

Raise **SMS OTP Expiry** to 300s — the 60s default is tight when copying a
code out of the SQL editor.

**This is a login backdoor.** Anyone who can read that table can sign in as
anyone. Drop the schema before production.

---

## 9. How to verify UI work without a backend

There is no committed E2E harness. The technique that found two real bugs
during the build, worth rebuilding when doing design work:

1. `npx expo export --platform web --output-dir /tmp/web-check`
2. Serve it with SPA fallback so deep links resolve:
   `npx http-server /tmp/web-check -p 8124 -P "http://127.0.0.1:8124?"`
3. Drive it with Playwright (Chromium is preinstalled at
   `/opt/pw-browsers/chromium`; use `--no-sandbox`), intercepting
   `**/*.supabase.co/**` to return canned PostgREST JSON, and seeding a fake
   session into `localStorage` under `sb-<project-ref>-auth-token`.
4. Screenshot each route and read the console for errors.

Two caveats learned the hard way: the **dev server and the export build
differ** (the `darkMode` crash only reproduces on the dev server), and
**colours in a downscaled screenshot mislead** — verify computed styles
rather than eyeballing a PNG.

---

## 10. Conventions

- Comments explain *why*, not *what*. Match the existing density — moderate,
  reserved for decisions and non-obvious constraints.
- `@/*` maps to `./src/*`.
- Money variables end in `Agorot` / columns in `_agorot`. Keep it.
- New Supabase access goes in `src/lib/queries.ts`, not inline in a screen.
- Migrations are append-only: add a new timestamped file, never edit an
  applied one.
- Don't add a dependency without a reason the existing stack can't cover.
  `useAsync` is deliberately tiny — an MVP with eight screens doesn't need a
  query cache when Realtime already says when to refetch.
