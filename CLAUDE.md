# CLAUDE.md — Lotus Bet

Guidance for Claude Code working in this repo. Read this before touching
anything; the NativeWind, colour-scheme and money-invariant sections in
particular encode mistakes already made and fixed once.

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
- **No public or global discovery.** Bets are always scoped to a group; the
  Home feed shows only bets from groups you are in.
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

npm test                  # jest — 50 tests, pure logic + a theme drift check
npm run typecheck         # tsc --noEmit
npm run lint
npm run theme             # regenerate global.css from theme-colors.json
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
Storage, Realtime, RLS, Edge Functions) · expo-image / expo-video /
expo-image-picker for bet media.

```
app/                        Expo Router routes
  _layout.tsx               root stack + the single auth redirect gate
  (auth)/                   sign-in · sign-up · profile-setup
  (tabs)/                   index (the feed) · groups · profile
  group/create.tsx, join.tsx
  group/[id]/               index (detail) · new-bet · settle
  bet/[id].tsx              join a side, resolve, cancel
src/
  components/ui.tsx         the shared visual vocabulary — see §4
  components/icons.tsx      hand-rolled SVG icon set
  components/animated.ts    NativeWind-registered Animated — import from here
  components/screen.tsx     Screen · Glass · ContentWidth
  components/skeletons.tsx  screen-shaped loading placeholders
  components/bet-card.tsx   FeedCard (full-screen) + BetCard (compact)
  components/bet-media.tsx  photo/video renderer and pager
  components/odds-bar.tsx
  lib/payout.ts             re-export ONLY — see §5
  lib/settlement.ts         balance netting + greedy debt simplification
  lib/queries.ts            every Supabase read/write the app makes
  lib/media.ts              picking, uploading and signing bet media
  lib/format.ts             agorot ↔ shekels, countdowns, initials, email
  lib/database.types.ts     hand-written row types
  lib/supabase.ts           client; `isSupabaseConfigured` guard
  lib/notifications.ts      Expo push registration + announceNewBet
  hooks/                    use-async · use-group-realtime · use-settlement ·
                            use-reduced-motion · use-tab-bar-inset
  providers/auth-provider.tsx
  providers/theme-provider.tsx   owns the colour scheme
  theme.ts                  palettes · motion · elevation · avatarColors
theme-colors.json           SINGLE SOURCE OF TRUTH for both palettes
global.css                  GENERATED from it by scripts/build-theme-css.js
supabase/
  migrations/               schema · RLS · RPCs · email auth + media (4 files)
  functions/_shared/        payout.ts (canonical), push.ts, supabase.ts
  functions/resolve-bet/    the only writer of bet_ledger_entries
  functions/notify-new-bet/
__tests__/                  payout · settlement · format · theme
```

**All Supabase access goes through `src/lib/queries.ts`.** Screens never
build queries inline. If a table isn't touched in that file, the client
never reads it — which is what makes the RLS surface auditable.

---

## 4. Design system — read before any UI work

The direction is **Apple**: the platform's own type scale and metrics, system
font, translucent floating chrome, spring-driven motion, and colour used
sparingly and semantically. `.claude/skills/apple-design/SKILL.md` is the
reference; the rules below are what it means in this codebase.

### Colour: semantic tokens, two schemes

`theme-colors.json` holds **two complete palettes**, `light` and `dark`, with
identical key sets. `scripts/build-theme-css.js` generates `global.css` from
it as CSS custom properties under `:root` and `.dark:root`; `tailwind.config.js`
maps every colour class to `var(--c-*)`. `__tests__/theme.test.ts` fails if
`global.css` drifts from the JSON — run `npm run theme` after editing it.

The consequence, and the point: **one class name is correct in both schemes.**
There is not a single `dark:` variant anywhere in the app, and there should
never need to be.

| Token | Use |
| --- | --- |
| `canvas` | the page ground — white on light, black on dark |
| `sunken` | grouped-list ground, the tone inset cards sit on |
| `surface` / `surface2` / `surface3` | card → raised → control fill |
| `hairline` / `hairline-strong` | 1px rules and borders |
| `primary` / `secondary` / `tertiary` | label → secondary label → placeholder |
| `inverse` | text on an inverted surface |
| `accent` (+ `-strong`, `-soft`, `-ink`) | the one decisive colour |
| `positive` / `negative` (+ `-soft`) | money owed to you / that you owe |
| `sideA` / `sideB` (+ `-soft`) | the two sides of a bet |
| `chrome` / `chrome-edge` | translucent floating material and its lit edge |
| `scrim` | dim layer over media |
| `on-media` (+ `-soft`, `-faint`) | text over a photo or video, both schemes |

**Black and white are the app's colours; light blue is the only accent.** Side
A is that blue, side B is ink (near-black on light, near-white on dark) — the
two sides of a bet are literally the two colours the product is made of.
`positive`/`negative` stay green/red because ledger direction is the one place
where a learned colour convention beats a house style.

**Never hardcode a hex in a component.** Reach for `useColors()` only where a
class cannot go: navigator options, `placeholderTextColor`, `Switch`,
`RefreshControl`, SVG, gradients, animated styles. `#FFFFFF` on a scrim over
media is the sole literal, because white-on-media does not follow the scheme.

### Colour scheme plumbing (this bit has already bitten)

- `darkMode: 'class'` in `tailwind.config.js` **must stay**. Under the default
  `'media'`, NativeWind's web colour-scheme observer calls `colorScheme.set()`
  when the stylesheet lands and that function throws outright. Every
  `npm start` on web crashed until this was set.
- Because it is `'class'`, **nothing follows the OS setting on the web on its
  own.** `ThemeProvider` resolves the preference (`system` | `light` | `dark`)
  against React Native's `useColorScheme()` and always hands NativeWind a
  *concrete* scheme. Passing `'system'` to `setColorScheme` leaves the web
  build stuck in light mode — verified, then fixed.
- The user's choice lives in AsyncStorage under `lotusbet.appearance` and is
  changed from the Appearance control on Profile.

### Type

The **system font** — SF Pro on iOS. Apple ships optical sizing, tracking
tables and legibility tuning with it, and a downloaded face throws all of that
away for a novelty that stops the app feeling native. There is no webfont and
nothing to wait on at launch.

The scale in `tailwind.config.js` is Apple's, with Apple's tracking: `text-2xs`
11 → `text-sm` 13 (Footnote) → `text-subhead` 15 → `text-callout` 16 →
`text-base` 17 (Body) → `text-lg` 20 (Title 3) → `text-xl` 22 → `text-2xl` 28
→ `text-3xl` 34 (Large Title) → 44 / 56 / 72 for display moments. **Tracking is
size-specific** — large text tightens, small text opens up; a single
`letter-spacing` value is wrong somewhere.

Hierarchy comes from weight + size together, not size alone: `font-semibold`
for a headline at body size is a real step.

### Layout and shape

- 4pt grid, `px-gutter` (20) at screen edges, `mb-section` (28) between blocks.
- Radius says what kind of object something is: `rounded-4xl` (28) for feed
  cards and media, `rounded-3xl` (22) for cards, `rounded-2xl` (16) for
  controls and inset groups, `rounded-xl` (12) for small controls, `full` for
  pills and avatars. Hairlines are never rounded.
- The inset grouped list (`ListGroup` + `Row`, `FieldGroup` + `TextField`) is
  the default container. It is the most familiar shape on the platform and
  needs no chrome of its own.

### Motion

Motion tokens live in `src/theme.ts` in **Apple's two parameters**, not the
physics triplet: `duration` is the *response* (how fast the value reaches the
target) and `dampingRatio` controls overshoot. `motion.press` and
`motion.settle` are critically damped (1.0); `motion.momentum` (0.8) and
`motion.celebrate` (0.62) are the only places overshoot is allowed, and only
because a gesture or a payoff earned it.

- **Feedback lands on press-in, never on release.** `PressableScale` springs
  the instant a finger touches it. A control that only reacts once you let go
  reads as broken.
- **Animate `transform` and `opacity` only.** Never width, height, flex,
  margin or `left` — those re-layout the subtree every frame. `OddsBar`
  animates `scaleX` on a full-width track with `transformOrigin` at each end so
  the two bars meet exactly at the split; `Segmented`'s thumb travels on
  `translateX` off a measured width.
- **`useReducedMotion()` gates every entrance and spring.** Motion is
  neutralised, never removed: content still arrives and presses still respond,
  they just stop travelling.

### Materials

`Glass` (in `screen.tsx`) is a registered `BlurView` over the `chrome` token
with a lit `chrome-edge` border. Floating chrome — the tab bar — lets content
scroll underneath it rather than consuming a strip. Bigger surfaces read as
thicker: the tab bar takes a much higher blur intensity than a chip would.

### Design tells to keep out

- **No tracked ALL-CAPS eyebrows.** `SectionTitle` is sentence case at Title 3.
- **No middle-dot meta strings** (`A · B · C`). Write the sentence.
- **No near-black-as-grey.** The dark ramp is genuinely black-first.
- **One accent, used with meaning** — blue carries side A and every action;
  green and red carry ledger direction. Nothing is coloured for decoration.
- **Loading states are skeletons, not spinners**, anywhere the shape of the
  content is known.

### NativeWind gotchas (each of these has already bitten once)

1. **`className` is silently dropped on any component NativeWind doesn't
   know** — including reanimated's `Animated.View`, `expo-blur`'s `BlurView`,
   `expo-image`'s `Image`, `expo-video`'s `VideoView`, and anything built with
   `Animated.createAnimatedComponent`. No error; the styles simply never
   arrive. This cost a whole redesign pass once.

   The fix is registration, not avoidance. `src/components/animated.ts` calls
   `cssInterop` on `Animated.View`/`Text`/`ScrollView` and re-exports
   `Animated`; `ui.tsx` does the same for `AnimatedPressable`, `screen.tsx`
   for `BlurView`, `bet-media.tsx` for `Image` and `VideoView`.
   **Import `Animated` from `@/components/animated`, never from
   `react-native-reanimated` directly.** If you animate or style a new
   component type, register it too.

2. **No dynamic class names.** `` `border-${tone}` `` compiles to nothing —
   Tailwind needs literal strings. Spell both branches out:
   `tone === 'a' ? 'border-sideA' : 'border-sideB'`. See `SidePick` in
   `bet-card.tsx` and `SideButton` in `app/bet/[id].tsx`.

3. **No opacity modifiers on the semantic colours.** They resolve to
   `var(--c-*)`, and Tailwind cannot compute an alpha of a `var()`, so
   `text-primary/60` silently produces no class at all. If you need a
   translucent token, add it to `theme-colors.json` as its own value — that is
   what `on-media-soft` and `chrome` are.

4. `contentContainerClassName` **is** supported on ScrollView. Use it.

5. **Eight-digit hex alpha is not reliable in `LinearGradient`.** A stop that
   doesn't truly reach zero leaves a hard horizontal seam. The feed card's
   scrim builds explicit `rgba()` — follow that.

### Component library

`src/components/ui.tsx` is the shared vocabulary; screens compose it and add
no bespoke chrome of their own.

- `PressableScale` — every tappable surface springs under the finger. Use it
  instead of a bare `Pressable`. `tap()` / `selectionTap()` are the haptics,
  already no-ops on web.
- `Card`, `ListGroup` + `Row`, `Divider`, `Title`, `SectionTitle`, `Overline`,
  `InfoRow`, `Stat`
- `FieldGroup` + `TextField` (leading label, iOS form row) and `BlockField`
  (label above, for long text)
- `Button` (`variant`: primary/secondary/tinted/plain/destructive ·
  `size`: sm/md/lg · `icon` · `loading`), `Chip`, `Segmented`, `Badge`,
  `LiveDot`
- `Money` — tabular figures, coloured by direction. All money goes through it.
- `Avatar` / `AvatarStack` — colour is derived from the user id via
  `avatarColors`, per scheme, so the same person is the same colour everywhere.
- `Skeleton` plus screen-shaped compositions in `skeletons.tsx`
- `EmptyState` / `ErrorNotice` / `Loading`

`src/components/icons.tsx` is a hand-rolled SVG set on a 24×24 grid, 1.75
stroke, defaulting to the active scheme's secondary label colour. Emoji ignore
`color` and render differently per platform — use these instead. Emoji remain
only as user-chosen group avatars.

### The feed

`app/(tabs)/index.tsx` is the centre of the app: a `FlatList` of `FeedCard`s,
one per screenful, snapping so a flick always lands on a whole bet. There is
no greeting and no stats block — the bet is the content. A card with media
puts the photo or video full-bleed with everything else over a scrim; a card
without media gives the question the space the media would have had. Sides can
be picked straight from the card. Only the card actually on screen plays its
video (`active` prop, driven by `onViewableItemsChanged`).

Screens leave room for the floating tab bar with `useTabBarInset()`.

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

### Auth

**Email + password.** `signUp` sends the display name in `raw_user_meta_data`,
and the `handle_new_auth_user` trigger uses it to seed `public.users` with
`profile_completed = true`; an account without one gets a placeholder name and
the app routes it to profile-setup. There is no phone OTP and no SMS provider
any more — `users.phone` stays on the table, nullable, for accounts created
under the old flow.

If the project has email confirmation on, `signUp` returns no session and the
sign-up screen shows a "check your inbox" state. Both configurations work.

### Roles and who may write what

- **Clients** (anon key + RLS): read anything in their groups; write their
  own `bet_positions` and `settlement_confirmations`; create groups, bets and
  bet media.
- **`bet_ledger_entries` is read-only for clients.** Only the `resolve-bet`
  Edge Function writes it, using the service role.
- Membership is checked through `SECURITY DEFINER` helpers
  (`is_group_member`, `is_group_admin`, `shares_group_with`, `bet_group_id`)
  so the policy on `group_members` doesn't recurse into itself. **If you add
  a policy that queries `group_members` directly, you will create infinite
  recursion.** Use the helpers.
- Only a bet's `creator_id` can lock, resolve or cancel it, and only the
  creator can attach media, only while the bet is `open`.
- `bet_positions` can only be created, switched or withdrawn while the bet is
  `open` and before `close_at` — enforced by the `enforce_bet_open` trigger,
  so it holds no matter which path writes the row.

### Media

`bet_media` rows hold a `storage_path` into the **private** `bet-media`
bucket, laid out as `<group_id>/<bet_id>/<file>`. The storage policies read
the group out of the first path segment and reuse `is_group_member`, so the
bucket and the table enforce exactly the same rule.

Nothing is public. `src/lib/media.ts` signs URLs on read, and `queries.ts`
batches the signing across a whole result — a feed of ten bets with photos
costs one round trip, not ten. Uploads happen *after* the bet row exists,
because its id is part of the path.

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
back as a string. Every read site wraps with `Number(...)`. Keep doing that on
any new consumer.

---

## 7. Known issues and suspected bugs

**The single most important caveat: none of the SQL in `supabase/migrations/`
has ever been run against a live Postgres by Claude.** It was written and
reviewed but never applied during the build — only the TypeScript was
typechecked and tested. Treat the schema, RLS policies, storage policies and
RPCs as *unverified*. When a backend bug surfaces, the migration is a likely
suspect.

Concrete things worth fixing, roughly by severity:

1. **`resolve-bet` can strand a bet permanently.**
   `supabase/functions/resolve-bet/index.ts` inserts the ledger rows and
   *then* flips the bet's status. If the process dies between the two, the
   ledger rows exist but the bet is still `open`. A retry hits the
   `unique (bet_id, user_id)` index, throws, and the bet can never resolve.
   The two writes should be one transaction — most likely a `SECURITY DEFINER`
   RPC the function calls, or an upsert that ignores duplicates.

2. **Media upload is not transactional with the bet.** `createBet` inserts the
   bet, uploads each file, then inserts the `bet_media` rows. A failure part
   way leaves a posted bet with some or none of its attachments, and orphaned
   objects in the bucket. That is the better of the two failure modes — the
   bet survives — but it wants a cleanup path.

3. **Signed URLs expire after an hour.** A feed left open longer than that
   shows broken media until the next refresh. Realtime and pull-to-refresh
   both re-sign, so it is only visible on a screen left untouched.

4. **One push token per user.** `users.expo_push_token` is a single column,
   so a second device silently overwrites the first. Needs its own table when
   multi-device matters.

5. **`useFocusEffect` in `app/(tabs)/groups.tsx` has empty deps** with an
   eslint-disable. It works because `reload` is stable, but it's fragile — a
   refactor of `useAsync` could silently stop refreshing the group list.

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

---

## 8. TEMPORARY: offline demo mode

`src/lib/demo.ts` is an in-memory fake of the whole backend, so the app can be
opened and clicked through with no Supabase project, no email provider and no
network. The way in is a small "Skip sign-in, use demo data" button on the
sign-in screen and on the setup screen (`src/components/demo-entry.tsx`).

It is scaffolding, not a feature. Three properties keep it honest:

- The entry point renders only when `DEMO_AVAILABLE` — `__DEV__`, or an
  explicit `EXPO_PUBLIC_ENABLE_DEMO=1` for testing an exported bundle. It
  cannot reach a production build.
- Resolving a bet runs the real `computeBetPayouts`, so the demo cannot drift
  into a second implementation of the money maths.
- Demo media is inlined as SVG data URIs rather than fetched, so the offline
  claim stays true.

**To remove it:** delete `src/lib/demo.ts` and `src/components/demo-entry.tsx`,
then grep for `isDemoMode`, `DemoEntry` and `DemoBadge` — every call site is a
one-line guard.

---

## 9. How to verify UI work without a backend

There is no committed E2E harness. This loop has found several real bugs and
is worth rebuilding whenever doing design work:

1. Export with demo mode and a placeholder project, so the sign-in screen
   renders and the demo button is available:

   ```bash
   EXPO_PUBLIC_ENABLE_DEMO=1 \
   EXPO_PUBLIC_SUPABASE_URL=https://demo.supabase.co \
   EXPO_PUBLIC_SUPABASE_ANON_KEY=demo-anon-key \
   npx expo export --platform web --output-dir /tmp/web-demo
   ```

   Metro caches the inlined `process.env.EXPO_PUBLIC_*` values — if a flag
   doesn't take, re-export with `--clear`.

2. Serve it with SPA fallback so deep links resolve:
   `npx http-server /tmp/web-demo -p 8124 -P "http://127.0.0.1:8124?"`
3. Drive it with Playwright (Chromium is preinstalled under
   `/opt/pw-browsers/`; use `--no-sandbox`), with `colorScheme: 'light'` and
   `'dark'` contexts so **both schemes** get walked.
4. Screenshot each route and read the console for errors.

Three things learned the hard way: the **dev server and the export build
differ** (the `darkMode` crash only reproduces on the dev server);
**colours in a downscaled screenshot mislead** — verify computed styles rather
than eyeballing a PNG; and when a scheme looks wrong, probe
`document.documentElement.className` and `getPropertyValue('--c-canvas')`
before touching any component.

---

## 10. Conventions

- Comments explain *why*, not *what*. Match the existing density — moderate,
  reserved for decisions and non-obvious constraints.
- `@/*` maps to `./src/*`.
- Money variables end in `Agorot` / columns in `_agorot`. Keep it.
- New Supabase access goes in `src/lib/queries.ts`, not inline in a screen.
- Migrations are append-only: add a new timestamped file, never edit an
  applied one.
- Route files under `app/` export their screen and nothing else — shared
  helpers live in `src/` (see `use-tab-bar-inset.ts`).
- Don't add a dependency without a reason the existing stack can't cover.
  `useAsync` is deliberately tiny — an MVP with eight screens doesn't need a
  query cache when Realtime already says when to refetch.
