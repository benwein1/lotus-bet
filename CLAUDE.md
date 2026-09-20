# CLAUDE.md — Betta

Guidance for Claude Code working in this repo. Read this before touching
anything; the NativeWind, colour-scheme and money-invariant sections in
particular encode mistakes already made and fixed once.

---

## 1. What this is, and the one rule that never bends

An iOS-first React Native app where friends form groups, post two-outcome
bets against each other, and the app tracks who owes whom.

**Betta never touches money.** No payments, no wallets, no in-app
currency, nothing purchasable, no payment-processor integration. It records
obligations; users settle up outside the app (cash, Bit, bank transfer).

This is a deliberate product and App Store compliance decision, not an
oversight and not a gap to fill. Do not add payment features, "wallet
balance" UI, or anything that could read as holding funds — even if a task
description seems to imply it. The disclaimer text on the auth, new-bet,
settle-up and profile screens is load-bearing; don't delete it during a
redesign.

Other standing scope boundaries:

- **As many outcomes as the creator wants**, between 2 and 8. `bet_options`
  is the real list; `bets.option_a_label` / `option_b_label` survive as the
  first two, mirrored by a trigger, so data and clients written before options
  existed still read. Render from `options`, never from the label columns.
  The odds bar is a green/red split at two and a stacked bar with a legend
  past two.
- **No public or global discovery.** Bets are always scoped to a group; the
  Home feed shows only bets from groups you are in. A one-on-one challenge is
  no exception — it creates a real two-person group (`groups.kind = 'duel'`)
  that the Groups tab hides. **Looking somebody up is a prefix search over
  handles and nothing more** — `search_users_by_username`, which refuses a
  query under two characters, matches `'bar%'` and never `'%bar%'`, returns at
  most ten rows, and hands back only the handle, display name and avatar.
  This reversed a stricter rule (exact handle only) on the owner's call,
  because a field you can only use if you can already spell somebody's handle
  is a field most people cannot use. It is still a user-enumeration surface
  and the narrowness is what keeps it small; there is **no rate limit on it
  yet**, which the head of `…_username_search.sql` records as the open part.
  Do not widen it to `contains`, to a search over display names, or to a
  one-character query.
- **A bet can be private to some of its group.** `bets.visibility = 'private'`
  plus a `bet_invitees` list. It narrows an audience; it never reaches outside
  the group.
- **No editing a bet after creation.** The creator can lock, resolve or
  cancel. That's the whole surface.
- **A group picks its currency once, at creation, and keeps it.** `groups.
  currency` is one of USD, EUR, GBP or ILS; existing groups are ILS and new
  ones default to USD. The integers did not change — `total_pot_agorot` and
  `amount_agorot` are minor units of *that* currency, cents in a dollar group,
  and `payout.ts` never cared what they counted. **There is no exchange rate
  anywhere in this app and there must not be one**: a rate would make a debt
  two friends agreed on drift between the day it was recorded and the day it is
  paid. Anything that spans groups therefore reports per currency rather than
  summing — `personBalances` keys on (person, currency), and the profile's
  lifetime figures come from `my_totals_by_currency`, not from `my_stats`'s two
  money columns, which still add everything together and are only correct for
  an account whose groups all agree. Money is formatted by `lib/currency.ts`;
  `formatAgorot` is gone, because two formatters is how one figure ends up
  printed two ways.

---

## 2. Commands

```bash
npm install
cp .env.example .env      # fill in Supabase URL + anon key first

npm start                 # Expo dev server; press "i" for iOS simulator
npm run web               # fastest loop for design work — no Xcode needed
npm run ios / android

npm test                  # jest — 437 tests, pure logic + a theme drift check
npm run typecheck         # tsc --noEmit
npm run lint
npm run theme             # regenerate global.css from theme-colors.json
npm run legal             # regenerate public/legal/*.html from legal-text.json

supabase/test/run.sh      # migrations + RLS + RPCs against a throwaway Postgres
```

`run.sh` needs a local PostgreSQL 16 and never touches a real project. It is
the only thing that exercises the SQL — see §7.

Always run `npm run typecheck && npm test` before claiming a change works.
They are fast (a few seconds combined).

**There is CI now** — `.github/workflows/checks.yml` runs typecheck, the jest
suite, the theme drift check, an iOS bundle and the full SQL harness on every
pull request and on pushes to `main` and `dev`. It needs no secret: the harness
builds its own throwaway Postgres and never touches a real project. `npm run
lint` is in there as advisory only, because ESLint is not a devDependency and
`expo lint` installs it on first run — a failure there is as likely to be the
install as the code. That stops being true the moment somebody runs
`npm i -D eslint` locally and commits the lockfile.

CI is a backstop, not a substitute: it tells you after you push, and the loop
above tells you before.

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
  (auth)/                   sign-in · sign-up · profile-setup · reset-password ·
                            age-check (the one-time 16+ confirmation)
  (tabs)/                   index (the feed) · groups · profile
  legal/terms.tsx, privacy.tsx, support.tsx
  group/create.tsx, join.tsx
  join/[token].tsx          what a shared invite link opens
  challenge.tsx             start a one-on-one by handle
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
  components/bet-actions.tsx  the like/comment row; liking is optimistic
  components/bet-comments.tsx the thread inline under a bet, the sheet that
                            rises over the feed, and the composer both share
  components/double-tap-like.tsx  double-tap a photo to like it
  components/auth-shell.tsx   the frame every pre-sign-in screen sits in
  components/date-of-birth-field.tsx  three boxes, and the 16+ footnote
  components/social-auth.tsx  Continue with Apple / Google, and the divider
  components/bet-grid.tsx     the bets you started, as a grid on Profile
  components/bet-proof.tsx    proof-of-outcome gallery on a resolved bet
  components/payment-sheet.tsx amount entry for a part payment
  components/bet-cover.tsx  the generated background a bet with no photo gets
  components/legal-document.tsx  the terms, the policy and the support page
  components/app-mark.tsx  the app mark, wherever the app shows its own face
  components/animated-splash.tsx  the hand-off out of the native splash,
                            and where the name is revealed
  lib/auth-links.ts         pure: reading a GoTrue recovery redirect
  lib/oauth-rules.ts        pure: provider names, redirect tokens, terms state
  lib/oauth.ts              …and the device half — Apple's sheet, Google's browser
  lib/coalesce.ts           pure: collapsing a burst of refetches into one
  lib/invite-links.ts       pure: invite URL, share message, expiry wording
  lib/invites.ts            …and the device half — share sheet, pending token
  lib/legal.ts              URLs, support address, and the text, from one JSON
  lib/age.ts                pure: the 16+ rule, shared with the SQL that enforces it
  lib/payout.ts             re-export ONLY — see §5
  lib/settlement.ts         balance netting + greedy debt simplification
  lib/queries.ts            every Supabase read/write the app makes
  lib/media.ts              picking, uploading and signing bet media
  lib/media-rules.ts        …and its pure half, which is what the tests hold
  lib/currency.ts           minor units ↔ a string, per group; the picker's list
  lib/format.ts             countdowns, initials, email — NOT money any more
  lib/feed-order.ts         pure: live above closed, newest first inside each
  lib/bet-cover.ts          pure: which generated cover a bet gets, and the six
  lib/database.types.ts     hand-written row types
  lib/supabase.ts           client; `isSupabaseConfigured` guard
  lib/notifications.ts      push registration + the three server announcements
  lib/reminders.ts          local deadline reminders (the device half)
  lib/reminder-rules.ts     …and the pure half, which is what the tests hold
  lib/odds.ts               percentages that always total exactly 100
  lib/postgrest.ts          reading PostgREST's "column/function does not exist"
  hooks/                    use-async · use-group-realtime · use-settlement ·
                            use-reduced-motion · use-tab-bar-inset ·
                            use-bet-comments (one thread, two surfaces)
  providers/auth-provider.tsx
  providers/theme-provider.tsx   owns the colour scheme
  theme.ts                  palettes · motion · elevation · avatarColors
theme-colors.json           SINGLE SOURCE OF TRUTH for both palettes
global.css                  GENERATED from it by scripts/build-theme-css.js
legal-text.json             SINGLE SOURCE OF TRUTH for terms, privacy, support
public/legal/*.html         GENERATED from it by scripts/build-legal-html.js,
                            at build time, gitignored — see §11
assets/logo/mark.svg       the mark — one green-to-blue ramp across the whole
                            fan; scripts/build-icons.mjs renders every size, and
                            animated-mark.tsx redraws the same petals and ramps
supabase/
  migrations/               schema · RLS · RPCs · email auth · media · avatars ·
                            bet options · notification prefs · social ·
                            private bets and duels · group invites ·
                            proof of outcome · bet-insert RLS fix · column
                            privileges · moderation · account deletion · terms ·
                            abuse limits · position group_id · media limits ·
                            user devices · moderation review · media retention ·
                            bets by creator · anon RPC lockdown ·
                            social sign-in · anon execute relock · feed index ·
                            minimum age · invite token search path ·
                            grandfather existing accounts · group currency ·
                            username search · stats by currency (34)
  functions/_shared/        payout.ts (canonical), push.ts, supabase.ts
  functions/notify/         the single push fan-out for all three server events
  functions/sweep-media/    scheduled retention for cancelled bets' media
supabase/seed/              test_members.sql · review_account.sql (the App
                            Review account; exercised by run.sh §37)
supabase/admin/             review_queue.sql — the moderation queue as things
                            to paste; guideline 1.2's 24 hours in practice
__tests__/                  payout · settlement · format · theme · odds · oauth-rules · age ·
                            postgrest · reminders · invite-links · media-split ·
                            auth-links · coalesce · content-rules · errors ·
                            suggestions · legal · feed-and-money
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
| `brand` (+ `-strong`, `-soft`, `-ink`) | Spring Mint — status and selection only |
| `positive` / `negative` (+ `-soft`) | money owed to you / that you owe |
| `sideA` / `sideB` (+ `-soft`, `-onMedia`) | the two sides of a bet |
| `chrome` / `chrome-edge` | translucent floating material and its lit edge |
| `scrim` | dim layer over media |
| `on-media` (+ `-soft`, `-faint`) | text over a photo or video, both schemes |

**Black and white are the app's colours; light blue is the only accent** — it
carries every action, and nothing else. **The two sides of a bet are green and
red**: side A is the people in favour, side B the people against, in the same
pair of colours the ledger uses for money owed to you and money you owe. One
learned convention, read the same way on the odds bar, the side buttons and the
balance rows. `sideA-media` / `sideB-media` are the brighter variants for use
over a photo; they are deliberately the *same value in both schemes*, because a
scrim is dark either way.

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
- The user's choice lives in AsyncStorage under `betta.appearance` and is
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
- **One accent, used with meaning** — blue carries every action; `positive` and
  `negative` carry direction, both on the ledger and on the two sides of a bet.
  Nothing is coloured for decoration.
- **`brand` is the fourth colour and it has one job.** Spring Mint, the app's
  secondary, marks *status and selection*: the live dot, the "open" badge, a
  selected chip, the mark itself. It never carries a number and never carries a
  side — that is `positive` and `sideA`, which sit only 8 degrees of hue away.
  The separation is the job, not the distance, which is why a green live dot
  labelled "Live" can sit on the same card as a green side button. The full
  rule is in `tailwind.config.js` next to the token.
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

4b. **`flex-1` on a `TextInput` does not let it shrink.** It sets a zero basis
   but leaves `min-width: auto`, so on the web the input keeps its intrinsic
   width and the row it is in cannot get smaller. `PaymentSheet` measured 326px
   wide around 448px of content, and `autoFocus` then scrolled the card 73px
   sideways and cut its title in half — invisibly, because the card clips. Any
   `TextInput` sharing a row needs an explicit `minWidth: 0`.

   It bit a second time, in `TextField` itself: the reveal-password eye was
   pushed 26px past the right edge of the field group on **every** auth screen,
   measurably (`x=353..380` against a row ending at 354). Both `TextField` and
   the comment composer now set it. Check any new row that pairs an input with
   anything else.

5. **Never nest a pressable control inside a `Link`.** On iOS the responder
   system lets the inner one win, so it looks fine; on the web the inner press
   fires *and* the browser's own anchor activation runs afterwards, doing a
   full document navigation. That silently broke picking a side from the feed
   card. `FeedCard` now puts the `Link` and the `SidePick` row side by side as
   siblings inside the padded column — copy that shape.

6. **`Alert.alert` is a no-op on react-native-web** — the implementation is
   literally `static alert() {}`. Every confirmation in the app therefore did
   nothing in a browser: sign out, resolve, cancel and "mark as paid" were dead
   controls on the one platform the design loop runs on. Confirmations go
   through `src/lib/confirm.ts`, which falls back to `window.confirm` on web.

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

### The bet detail screen

**One row of squares, not two.** There used to be a row of buttons to pick a
side and a second row underneath listing who had picked what — two rows of the
same N squares, same order, same colours, saying different halves of one thing.
You picked "Yes" in the top row and then looked down to a *different* "Yes" to
see who else had.

`OptionCard` is both: label, payoff preview, the avatars of everyone on that
side, and pressing it puts you there. The roster is what makes the choice
interesting — you are betting against the people on the other square more than
against an outcome — so it belongs on the thing you press.

It carries three states at once: joinable (pressable, previews the payoff),
locked or past deadline (not pressable, still shows who is in), and resolved
(winner outlined and badged, losers dimmed). The payoff line is hidden once the
bet closes, because the number would be a promise nobody can take. Its
accessibility label names who is on the side — the avatars are decorative to a
screen reader, and without `describeRoster` the merge would lose exactly the
information it exists to surface.

### The feed

`app/(tabs)/index.tsx` is the centre of the app: a `FlatList` of `FeedCard`s,
one per screenful, snapping so a flick always lands on a whole bet. There is
no greeting and no stats block — the bet is the content. A card with media
puts the photo or video full-bleed with everything else over a scrim; a card
without media gives the question the space the media would have had. Sides can
be picked straight from the card. Only the card actually on screen plays its
video (`active` prop, driven by `onViewableItemsChanged`).

**The card is a glance, and the bet screen is the detail.** That split is the
rule the card is built to, and it is what decides whether something belongs on
it: group, creator, title, ground, amount, the bar, and the three actions. Not
on it, and all still on the bet screen — the description, the word "pot", the
"share of the N people who've picked" caption, and the headcount under each
side. `OddsBar` carries that as a `compact` prop rather than a second
component, since the two differ in density and nothing else.

The one thing compact does **not** drop is the option labels. "65%  35%" with
no names is unreadable on a bet that is locked or resolved, because the option
buttons are gone from the card too and there is then no second copy anywhere —
so compact sets each label beside its figure instead of above it, which costs a
line of height rather than the meaning.

Screens leave room for the floating tab bar with `useTabBarInset()`.

### Bets you started

The Profile grid is **authorship, not participation** — what you put up, where
"Bet history" below it answers what you have been in. That distinction is the
whole point: a bet you created and never took a side on is still yours, and
this is the only screen that says so.

**Two kinds of tile, because half these bets have no photo.** A photo grid that
drew only bets with media would be mostly holes, and a placeholder image would
be worse, so a bet without an attachment shows its own question. The question
*is* the bet; that tile is not a fallback.

The cover comes from `splitMedia().attachments`, never from proof — letting a
receipt somebody added after the result become the bet's face in a grid is
exactly the permissive mistake that function exists to prevent.

A bet that is no longer running recedes, the way `OptionCard` dims a losing
side. **How it recedes depends on what is underneath**, and both halves were
learned by looking: over a photo only a scrim works; over a text tile a scrim
put grey on grey and made the question unreadable. And the tile's *ground* stays
constant either way — dropping a closed tile to `sunken` made it vanish in dark
mode, where sunken is the page ground, so it stopped reading as a tile and
became a hole with text floating in it.

### Likes and comments

The interaction is shaped like the feeds people already use, because nobody
should have to learn how to argue with their friends. What that means here:

- **The feed card carries three icons and nothing else.** Heart with its count,
  comment bubble with its count, share without one. There used to be a line of
  text underneath — "View all N comments", or "Add a comment" when there were
  none — and it is gone: the owner's call, on the grounds that the feed is a
  glance and a card that talks is not. The count moved to the bubble where a
  count belongs, which is also why `BetActions` lost its `showCommentCount`
  prop: it existed only so the card could suppress the number while that line
  printed it, and with the line gone nothing set it.

  What that cost, recorded because it was a real property and not an accident:
  an empty thread no longer *invites* the first comment, it just shows a bubble
  with no number beside it. The bet screen still asks.
- **From the feed the thread opens as a sheet, not as another screen.**
  Pressing the bubble on a card used to push the bet screen, which is the
  wrong trade: you lose the photo you were looking at, the feed's scroll
  position and the video that was playing, to read three sentences.
  `BetCommentsSheet` rises over the feed instead, dismissed by the scrim, the
  close button, or dragging the grabber down. Only the header carries the drag
  gesture, so it can never fight the thread's own scroll.

  **The feed mounts exactly one sheet** and points it at whichever bet is open.
  A `FlatList` keeps several cards alive at once, so a sheet per card would be
  several modals stacked on one screen. It is keyed on the bet id, so the
  thread's fetch and its half-typed draft belong to one bet and do not survive
  being pointed at another. When a post or delete lands, the confirmed count
  goes back to the feed and **patches the card's line** — the same trade the
  like makes, rather than re-reading a hundred bets to move one number.
- **Inline on the bet screen the thread is collapsed to the last three**, with
  "View all N comments" to open it and "Show fewer" to close it again. Three is
  what every social app converged on and for the same reason: enough to see a
  conversation is happening, few enough that the bet stays on screen. The sheet
  does not collapse — it exists to show the whole conversation.
- **One thread, two surfaces.** `useBetCommentThread` owns the fetch, the
  optimistic post and the delete; `bet-comments.tsx` only draws them. Two
  surfaces showing the same conversation must not drift into two slightly
  different sets of rules about when your own sentence appears.
- **The composer is pinned in the sheet and not inline.** In a sheet it *is*
  the bottom edge, above the safe-area inset, and the keyboard stays up after
  a send because the conversation is still in front of you. Inline it sits
  under the thread and the screen's own `KeyboardAvoidingView` keeps it
  visible — a floating bar there would cover the bet the comments are about.
- **Name and body share one flowing paragraph.** It reads the way a spoken
  remark reads, it wraps at any length, and it costs a line less per comment —
  which is most of why ten comments still fit under a bet.
- **Posting is optimistic.** The comment appears greyed the instant you send it
  and is removed with the error surfaced if the write fails — and the text is
  handed back to the box, because retyping a sentence is a worse outcome than
  tapping send twice.
- **Double-tap to like is on the bet screen's hero only, never the feed card.**
  A double-tap detector has to hold the first tap ~280ms to see whether a second
  is coming. On the feed a single tap opens the bet, so that trade would add a
  quarter-second of dead air to every navigation in the app to buy one
  shortcut. On the hero, a single tap does nothing, so it costs nothing.
- The heart is **accent blue**, never red. Red is money you owe. This is
  restated here because it is the first thing anyone copying Instagram changes.

### Making it feel fast

The rule is *remove work*, not *add caching*. `useAsync` stays small and there
is deliberately no query library (§10).

- **Never refetch a screen to move one number.** A like patches the feed's local
  state through `setData`. It used to re-read a hundred bets and re-sign every
  media URL to change a count by one, and the card visibly restated itself a
  second later.
- **Collapse bursts.** Screen focus, a Realtime event and the user's own write
  routinely ask for the same refetch in the same moment. `createCoalescer`
  (`lib/coalesce.ts`) turns N asks into a leading run plus at most one trailing
  one — measured at six asks → two runs in `__tests__/coalesce.test.ts`. The
  trailing run is load-bearing: a request that arrived mid-flight may be about a
  change the in-flight read was too late to see.
- **Embed rather than waterfall.** `fetchBet` carries the group's members and
  the ledger, because both used to be their own `useAsync` keyed on something
  only the first response could supply — the group id, the status — so opening a
  bet was three sequential round trips. It is one. The feed deliberately does
  **not** get those embeds: it reads a hundred bets and would pay for a hundred
  member lists it never renders.
- **Signed URLs are cached for 45 minutes** (`media.ts`), comfortably inside the
  hour they are valid for. Re-signing the same paths on every refresh was a
  storage round trip that bought nothing. The cache is dropped on sign-out, so
  the next person on the device inherits nothing.
- **`FeedCard` is memoised** on everything except its callbacks, which the feed
  writes as inline arrows. They close over nothing that is not also a compared
  prop.
- **Stills are resized on the way in, not just compressed.** `stripMetadata`
  used an empty action list, so a 4032×3024 camera photo was uploaded whole and
  then decoded whole to fill a card about 1170px wide. `COMPRESSION.maxEdge`
  caps the **long** edge — 1600 for an attachment, 1200 for proof — because
  capping width alone leaves a portrait photo, which is most of them, taller
  than the cap. It is roughly 85% fewer pixels, and pixels are where the cost
  is: bytes, decode time, bitmap memory, and the per-account quota.
- **The feed list is windowed deliberately.** `initialNumToRender` defaults to
  10, so the first paint built ten full-screen cards to show one.
  `INITIAL_CARDS` is 2 — the card plus the sliver of the next. `getItemLayout`
  is supplied because every row is exactly `snapInterval` tall, so the list
  never measures a cell to place the next one.
- **`recyclingKey` on every recycled image.** Without it expo-image holds the
  previous bet's photo on a reused cell until the new one decodes, which is the
  flash of the wrong picture that makes a fast scroll look broken.
  `cachePolicy="memory-disk"` keeps decoded bitmaps around, so scrolling back
  up costs no decode.
- **Effects that drive native work key on a signature, not on the array.**
  Rescheduling deadline reminders cancels and re-schedules every local
  notification one bridge call at a time, and it was keyed on `bets` — a new
  array on every like. It now keys on a string built from the four fields
  `toReminderBet` actually reads, so a like does not move it and picking a side
  still does.

### Chrome the tabs don't have

The floating tab bar is **icons only** — three destinations with unambiguous
glyphs do not need captions, and the label survives where it was actually doing
work, as the accessibility name. **No tab screen prints its own name at the top
either**: the bar already says where you are, so Feed, Groups and You open
straight onto their content.

---

### The entrance

`auth-shell.tsx` is the frame for sign-in, sign-up, profile setup and
reset-password. They used to each carry their own copy of the mark, the
headline, the scroll, the keyboard handling and the disclaimer — and the drift
showed, because moving between them is the first thing anyone does and the mark
jumped a few pixels each time.

The hero **gives way to the keyboard** rather than being shoved off the top: the
mark scales down and the explanatory sentence fades, on `transform` and
`opacity` only. By the time somebody is typing they have read it.

Profile setup swaps the app mark for the user's own avatar, because by then
the thing being introduced is them.

**The splash reveals the name, and the name is out of flow.** The native splash
is the mark alone, centred; `AnimatedSplash` redraws that same mark at the same
size on the same ground so the hand-off is invisible. A wordmark laid out as a
flex sibling still occupies its box at `opacity: 0`, which lifts the mark off
centre from the first frame — so the mark would sit centred on the native splash
and jump upward the instant the overlay mounted, giving away the seam the
component exists to hide. It is `position: absolute` for that reason, offset by
half the mark plus one section gap, and it is a sibling of the badge rather than
a child so the exit scale belongs to the mark alone. The name fades up once the
mark has settled; the hold is longer than it used to be because a word nobody
can read is not worth showing.

**The money disclaimer is in the shell, not in the screens.** It is load-bearing
(§1) and putting it in one place is what stops a future redesign of one screen
quietly dropping it.

---

## 5. The money invariants — the highest-risk code in the repo

`supabase/functions/_shared/payout.ts` is the canonical implementation:
dependency-free, no imports, no I/O, no Deno or React Native globals.

- `src/lib/payout.ts` is a **pure re-export**. Don't put logic in it.
- It lives under `supabase/functions/` because it began as Edge Function code
  and because that directory is Deno-shaped: no bundler, no `@/` alias, no
  React Native. Those constraints are what keep it dependency-free.

That arrangement is deliberate: the unit-tested code is byte-for-byte the
code whose output becomes the ledger. **Do not fork, copy or reimplement this
module** — a second implementation is how someone gets paid the wrong amount.
`resolve_bet_with_entries` is the backstop, not a second opinion: it refuses
entries that break the invariants, it does not recompute them.

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

**Email + password, plus Sign in with Apple and Google.**

### Social sign-in

**Both providers or neither.** Guideline 4.8 requires an app offering a
third-party login to also offer one that limits data collection to name and
email and does not track — Sign in with Apple is what satisfies that. Google
alone is a rejection, so `SocialAuthButtons` renders one list and has no prop
to show only Google.

**Two genuinely different mechanisms, deliberately not abstracted together.**
Apple on iOS is a native sheet returning a signed identity token that goes
straight to `signInWithIdToken` — no browser, no redirect. Google has no native
equivalent that avoids a config plugin and a native build, so it opens the
provider in `WebBrowser.openAuthSessionAsync` and the tokens come back on the
redirect URL, which `oauthTokens` lifts off using the same fragment-first
parser the password-reset link uses.

Three things that bite:

- **Apple's nonce is two values, not one.** Apple signs the SHA256 *hash* into
  its token; Supabase verifies against the *raw* string. Sending the same one
  to both fails verification.
- **Apple gives the name exactly once**, on the first authorisation ever, and
  `fullName: null` every time after — including after a reinstall. It is
  written to the profile immediately in `signInWithProvider`, because there is
  no way to ask again.
- **Apple's button is iOS-only.** `isAvailableAsync` gates it; Apple's *web*
  OAuth flow needs a service ID and key this project does not have, so it is
  hidden rather than shown and failing. The design loop on web therefore cannot
  see that button — it has to be checked on a device.

**The OAuth redirect is decided by the platform, not by configuration.** Invite
links and password resets both prefer `EXPO_PUBLIC_WEB_ORIGIN` when it is set,
because both are opened from somewhere else and have to land on something a
browser can show. An OAuth redirect is the opposite: it has to come back into
the process that started it. `openAuthSessionAsync(url, returnUrl)` only hands
control back when the browser reaches `returnUrl`, so on a device it must be
`betta://` — reusing `linkTargets()` here was a bug waiting for the domain to
be configured, and every native Google sign-in would have started hanging the
day `EXPO_PUBLIC_WEB_ORIGIN` was set, with nothing on screen to say why.

**A provider that is not enabled fails at the destination, not in the call.**
`signInWithOAuth` builds the authorize URL on the client and goes there without
talking to the server, so on the web the page has already navigated and the
person is looking at raw JSON on `supabase.co` with the back button as their
only way home — and nothing in the app ever sees an error, because the document
that called it is gone. `providerEnabled()` asks GoTrue's `/settings` first and
**fails open**: anything but an explicit `false` proceeds exactly as before,
because that endpoint's shape could not be verified from the environment the
check was written in.

**The terms are agreed by the button, not by a checkbox.** The email form has a
checkbox because it has a form; a social sign-in is one tap that creates the
account and lands on the feed, with nowhere to put a control. So the sentence
under the buttons is the agreement, and `accept_terms(version)` records it
on the next profile load rather than in the button's own handler — the web
flow navigates the page away, so there is no handler left alive by the time a
session exists — an RPC because `terms_accepted_at` and `terms_version`
are absent from the client's UPDATE grant. The same comparison re-asks when the
wording changes, which is why the column is a version and not a boolean.

**The signup trigger reads three name keys**, in order: `display_name` (the
app's own, already through `prepareContent`), then `full_name`, then `name`,
which is where Google and Apple put it. Without that every social account
arrives as "Player 3f2a" and is sent to profile setup to type a name the
provider already gave.

**Password reset needs four halves, and only the first existed.** Sending
the link was there and looked fine; what was missing was `redirectTo` (so the
link opens a screen that expects it), a `PASSWORD_RECOVERY` branch in
`onAuthStateChange`, a screen that calls `updateUser`, and — the one that was
missed on the first pass — **something that actually reads the link**.

The subtle part is the gate. **A recovery session is a real session** — that is
what lets `updateUser` work — so every branch in `app/_layout.tsx` would happily
wave it through to the tabs. `recovering` is checked *first*, holding you on
`reset-password` until `updatePassword` clears it.
`redirectTo` comes from `passwordResetRedirectTo()`, which reuses the invite
link's origin resolution; the app scheme is an acceptable fallback here, unlike
for invites, because anyone clicking a reset link already has the app.

**The latch is read off the URL, not waited for as an event**, and that is not
belt-and-braces. GoTrue lands on `…/reset-password#access_token=…&type=recovery`
under the implicit flow, which is the client default, and three things conspire
against the event:

- `detectSessionInUrl` was `false` on **every** platform, so nothing parsed the
  fragment at all. No parse, no session, no `PASSWORD_RECOVERY` — a perfectly
  valid link rendered "That link has expired", which is a lie that looks like a
  feature. It is now `Platform.OS === 'web'`.
- GoTrue emits the event from inside its own `_initialize()`, which can beat a
  React effect's subscription. The event is a race; the URL is not.
- It then **strips the fragment** once it has read it. So the URL has to be
  captured *before* `createClient` runs — that is what `openedWithUrl` in
  `supabase.ts` is, and why it sits above the client rather than next to it.

`auth-links.ts` is the pure parser (fragment *and* query, fragment wins, since
tokens arrive in one and some errors in the other). `isRecoveryRedirect` fires
without tokens present on purpose: the gate must latch before the session is
confirmed, or it gets a frame in which a recovery session looks ordinary.

On native there is no `detectSessionInUrl`, so the `betta://` deep link is
handled by hand: lift the tokens out, `setSession`, and latch **first**, because
`setSession` announces itself as an ordinary `SIGNED_IN`.

Email delivery is a separate problem: Supabase's built-in sender is heavily
rate-limited and in practice only reaches the project owner. Custom SMTP is the
fix; none of the above changes that. `signUp` sends the display name in `raw_user_meta_data`,
and the `handle_new_auth_user` trigger uses it to seed `public.users` with
`profile_completed = true`; an account without one gets a placeholder name and
the app routes it to profile-setup. There is no phone OTP and no SMS provider
any more — `users.phone` stays on the table, nullable, for accounts created
under the old flow.

If the project has email confirmation on, `signUp` returns no session and the
sign-up screen shows a "check your inbox" state. Both configurations work.

### The 16+ minimum

Betta is a 16+ app and the database is what makes that true, not the sign-up
screen. `…_minimum_age.sql` is the whole mechanism.

**The date of birth is never stored.** Not as a column, not anywhere. It is
passed in, compared against `current_date` in SQL, and discarded in the same
statement; what survives is `users.age_verified_at`, a timestamp that proves
the check happened and cannot be run backwards into a birthday. Holding the
date as well would mean keeping identity data on every account forever to
answer a question that was already answered — so if a future feature wants an
age, it wants a new decision, not this column.

Three layers, and only the last two are enforcement:

- `src/lib/age.ts` is the pure rule, and the sign-up form's copy of it. It
  exists to explain — to grey the button and say why — and is bypassed the
  moment anybody calls PostgREST directly.
- `handle_new_auth_user` reads `date_of_birth` out of `raw_user_meta_data`,
  the same channel the display name and the terms version travel in, and
  **raises** if it is under 16 or malformed. The raise aborts the insert into
  `auth.users`, so no account exists at all. A malformed date is refused rather
  than ignored, because ignoring it would make "send rubbish" the way past.
- `require_age_verified()` is a `before insert` trigger on `bets`,
  `bet_positions`, `bet_comments`, `bet_likes`, `groups` and `bet_media`. It
  refuses every content write from an account with a null `age_verified_at`.

**A trigger and not RLS, deliberately.** A policy on table X whose `using`
clause re-queries X breaks `INSERT ... RETURNING`, which is how `queries.ts`
writes — the trap the "Who can see a bet" section below records in full. A
`before insert` trigger has no such interaction, touches no existing policy,
and sits next to the rate-limit triggers already guarding the same tables.

**Reads are untouched, and that is the design.** Apple and Google return no
date of birth, so a social sign-in creates a real account with nothing to
verify against; the same is true of every account predating the rule. Those
people land on `app/(auth)/age-check.tsx`, can still see the app, and can post
nothing until they answer. The root gate puts that screen *before* profile
setup: an account that is about to be turned away should not first be asked
for a name and a photo.

`age_verified_at` is readable and absent from the UPDATE grant, so a client
cannot stamp itself — section 45(e) of the policy checks asserts exactly that.
Nothing deletes an account that never answers; it can write nothing, so it
harms nobody, and putting it on a timer is a product decision the migration
says is still open.

**Accounts that predate the rule are grandfathered, not verified**, and the
column carries both meanings. `…_age_grandfather_existing.sql` exempts every
account created before a **fixed literal cutoff** — the product decision being
that the check belongs at signup and an established account should not be
interrupted by a question that did not exist when it was made. The cutoff is a
literal rather than `now()` precisely so the set stops growing: an unbounded
`where age_verified_at is null` would exempt whatever happened to be unstamped
whenever it ran, including the Apple and Google signups that are *supposed* to
be waiting on the in-app check. Those rows are stamped with their own
`created_at` rather than the migration's clock, because a today's-date stamp on
a two-week-old account would read as "checked today", which is the one thing
that is definitely untrue of them.

So `age_verified_at` non-null means "may post", and what it means underneath
depends on which side of that timestamp the row sits. Sections 48 and 49 assert
the line holds in both directions — exempt before it, untouched after it, and a
new under-age signup still refused outright. Nothing else about the gate
changed; only its starting population did.

### Roles and who may write what

- **Clients** (anon key + RLS): read anything in their groups; write their
  own `bet_positions` and `settlement_confirmations`; create groups, bets and
  bet media.
- **`bet_ledger_entries` is read-only for clients.** Only
  `resolve_bet_with_entries` writes it, as a `SECURITY DEFINER` RPC.
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

`create_group` · `join_group_with_code` · `create_group_invite` ·
`join_group_with_invite` · `revoke_group_invite` · `join_bet` · `join_bet_option` ·
`leave_bet` · `lock_bet` · `cancel_bet` · `group_balances` · `my_stats` ·
`set_push_token` · `resolve_bet_with_entries` · `can_see_bet` ·
`find_user_by_username` · `create_duel` ·
`push_targets_for_bet` / `push_targets_for_group` (service role only)

Anything spanning more than one table lives here rather than in the client,
so it stays atomic and can't be skipped.

### Resolution

**Resolving a bet is one RPC, not an Edge Function.** `resolve_bet_with_entries`
inserts every ledger row and flips the bet's status in a single transaction, so
the bet can no longer be stranded half-resolved by a process that dies between
the two writes. The client computes the split with `computeBetPayouts` and
hands the entries over; the RPC does not recompute them, it *checks* them —
one entry per participant, winners positive, losers negative, credits totalling
the pot exactly and debits totalling minus the pot. A ledger that does not
balance is refused rather than written.

The `resolve-bet` Edge Function it replaced has been **deleted**. It could
only ever name a winner as `'a'` or `'b'`, so once bets grew options it was a
stale second path into the ledger — and it wrote the status flip separately,
which is the stranding bug the RPC exists to close.

### Settlement

Resolving writes one signed `bet_ledger_entries` row per participant — a
balance line, not a pairwise IOU. `group_balances(group_id)` sums those and
folds in `settlement_confirmations`: a payment of X from A to B moves A up X
and B down X. That's what stops a settled transaction reappearing.

`src/lib/settlement.ts` then runs greedy debt simplification client-side. It's
cheap and recomputed on every open — **don't persist the suggested
transactions.**

### Notifications

Four events, **one switch** on Profile.

The four `users.notify_*` columns stay: `push_targets_for_bet` and
`push_targets_for_group` read them per kind, and the reminder scheduler reads
`notify_deadlines` on its own. Collapsing the *storage* would mean touching the
push fan-out and the SQL that decides who hears about what, to solve a problem
that was entirely in the UI. So one switch writes all four together and the
backend never learns anything changed.

It reads as on if **any** kind is on. An account from before the collapse can be
in a mixed state, and a switch reading "off" while the phone still buzzes would
be a lie; toggling either way writes all four, so a mixed state survives exactly
one tap. Turning it off also cancels the local reminders and drops the push
token — with one switch, off means off.

Three are **push**, sent by the `notify` Edge Function: a new bet in one of
your groups, somebody joining a group you are in, and a bet you took a side on
being called. One function rather than three: they all check the caller may
announce this, ask the database who wants to hear it, and hand the list to
Expo — only the sentence differs.

*Who* hears about something is decided in SQL (`push_targets_for_bet`,
`push_targets_for_group`), not in TypeScript, so it sits next to the RLS that
decides who may see the thing being announced and is covered by the same
harness. Both are `SECURITY DEFINER` and **revoked from `authenticated`** —
they return device tokens, and a group member must not be able to list their
friends' phones.

The fourth, a **deadline reminder**, is a *local* notification scheduled on the
device by `src/lib/reminders.ts`. It needs no cron, no push credentials and no
delivery guesswork, and — unlike remote push — it works in Expo Go. The feed
rebuilds the whole schedule whenever it changes: everything this module owns is
cancelled, then what is currently true is scheduled. That is how a reminder
disappears once you pick a side.

Announcements are fired from `queries.ts`, not from screens, so a caller cannot
forget one. All of them are `void`-ed and swallow their failure: the user's
action already succeeded, and a notification that did not go out must never be
reported as a failed bet.

### Embedding `bet_options`

There are **two foreign keys between `bets` and `bet_options`** — every option's
key back to its bet, and `bets.winning_option_id` pointing the other way. So a
plain `bet_options(*)` embed is ambiguous and PostgREST refuses it outright:
*"Could not embed because more than one relationship was found."* The whole
select fails, so the feed comes back **empty**, not merely without its options.

`BET_SELECT` therefore names the key: `bet_options!bet_options_bet_id_fkey(*)`.
That makes a constraint name part of the client's contract, which section 16 of
the policy checks asserts. Any new table with two keys to the same table needs
the same treatment.

### Likes, comments and the Profile ledger

`bet_likes` and `bet_comments` are protected by `bet_group_id` +
`is_group_member` — the same rule as the bet itself, so a reaction can never be
visible where the thing it reacts to is not. A comment has **no UPDATE
policy**: it can be withdrawn but not edited, because an editable comment on a
bet people wagered against is a way to rewrite what was agreed after the fact.

**Liking is optimistic.** `BetActions` owns the state while the write is in
flight and rolls itself back if it throws; the caller's job is only the write.
The heart fills **accent blue, not red** — red already means "money you owe"
throughout this app, and a red heart would give it a third job in the one place
people read amounts.

The Profile ledger ("who owes who") is netted per person across every group.
Crucially it does **not** compute that in SQL: `my_group_balances()` returns the
same per-group balances `group_balances` does, for all your groups at once, and
`personBalances` in `settlement.ts` runs the same `simplifyDebts` the settle-up
screen runs. There is no such thing as a pairwise debt in the ledger — a bet
writes a balance line per person, and who pays whom is a *suggestion*. Netting
it a second time in SQL would drift from settle-up within a week. Section 18 of
the policy checks asserts the two functions agree.

### Who can see a bet

**`can_see_bet(id)` is the single gate**, and every policy that guards a bet or
anything attached to one goes through it — `bet_options`, `bet_positions`,
`bet_media`, `bet_likes`, `bet_comments`, `bet_invitees`. It is group
membership *plus* the invitee list. Keeping it in one function is the whole
point: a private bet whose comments were still readable, or whose options
leaked, would be private in name only. If you add a table that hangs off a bet,
gate it on `can_see_bet`, never on `is_group_member(bet_group_id(...))`.

**`bets` itself is the one exception, and it has to be.** Its SELECT policy
calls `can_see_bet_row(id, group_id, visibility, creator_id)` — the same rule,
over the row's own columns rather than over an id.

The reason is a trap worth remembering, because it cost the app its
post-a-bet flow entirely. `queries.ts` inserts with
`.insert(...).select().single()`, which PostgREST turns into
`INSERT ... RETURNING *`, and **Postgres evaluates the SELECT policy against
the new row to satisfy that RETURNING**. `can_see_bet` is `stable` and looks
the bet up in `bets`; a `stable` function sees the snapshot from the start of
the statement, where the row being inserted does not exist yet. So it returned
false, the SELECT policy denied the row, and Postgres reported it as

    new row violates row-level security policy for table "bets"

— pointing at the INSERT policy, which was fine all along. The insert worked
without `RETURNING` and failed with it, which is what made it findable.

It was a regression: the policy `…_private_and_duels.sql` replaced was
`is_group_member(group_id)`, which reads `group_members` — a row that already
exists — and so never had to see the row being written.

There is still exactly one implementation of the rule: `can_see_bet(id)` is now
a thin wrapper that looks the row up and delegates to `can_see_bet_row`. Both
live in `…_fix_bet_insert_returning.sql`.

**Never write a policy on table X whose `using` clause re-queries table X**, if
anything ever inserts into X with `RETURNING`. Sections 23 and 24 of the policy
checks guard this one.

### Proof of outcome

`bet_media` carries **two kinds of file, told apart by `purpose`**. An
`attachment` is the creator's illustration, posted with the bet while it is
open — that was the table's only job until now, and the old insert policy said
so (`creator_id = auth.uid() and status = 'open'`). A `proof` is the receipt,
added *after* the bet is called.

They live in one table because they are the same object: same bucket, same
`<group_id>/<bet_id>/<file>` path, same signing code, same viewer. What differs
is when each may be written and where it is shown, and one column carries that.

**Proof belongs to the people who were in the bet, not to its creator.** The
policy accepts an insert from the creator *or* anyone with a `bet_positions`
row, and only once `status = 'resolved'`. A group member who never picked a
side is a spectator, and a spectator's photo is not evidence. It is gated on
`can_see_bet`, like everything else hanging off a bet, so a private bet's proof
is exactly as private as the bet.

The two rules do not overlap: the attachment policy now also requires
`purpose = 'attachment'`, which it did not before — without that a creator
could file an open bet's illustration as "proof" and have it render in the
receipt gallery.

Deleting is `uploaded_by = auth.uid()`: you can withdraw what you put up, and
nobody else can, **including the bet's creator**. The old rule required you to
be uploader *and* creator, which was the same person in every row that could
exist then and would now stop a participant removing their own photo.

`splitMedia` (in `media-rules.ts`, pure so it is testable) keeps the two apart
on the way out. **A row with no `purpose` is an attachment** — not a guess: until
the column existed the creator posting a bet was the only way a row could be
made. Get this wrong in the permissive direction and a photo somebody added
after the result silently becomes the bet's own face at the top of the screen.

Compression lives in one table in `media.ts`. Proof is squeezed harder than an
illustration (quality 0.6 vs 0.85, Medium vs High, **15s vs 60s**) because a
receipt only has to be legible enough to end an argument and is uploaded on a
phone in a bar; the illustration sits full-bleed in the feed. Video is the
overwhelming majority of the storage risk for a small slice of the value, which
is why the proof cap is the shorter one.

**Every still is re-encoded before it is uploaded**, by `stripMetadata`. A
photo taken to prove a bet in somebody's flat can carry GPS, and every member
of the group can download the object — SECURITY.md finding #6. The picker's own
re-encode drops most metadata *in practice*, and "in practice" is not a
property; a manipulator pass with no actions writes a fresh file from decoded
pixels, so there is no EXIF block to carry anything over. A failure throws
rather than falling back to the original, because a silent fallback uploads the
coordinates anyway.

**Videos are not covered and the code says so.** Nothing here transcodes them.
The 15-second cap is the mitigation that exists.

Media on bets **cancelled** more than 30 days ago is swept by the `sweep-media`
Edge Function. Nothing is owed on a cancelled bet, so its photos are evidence of
nothing. Proof on a *resolved* bet is never swept — that is somebody's record of
who won.

### Invite links

A group has **two ways in, and they are different objects**. `groups.invite_code`
is six characters, printed on the group screen, typed on the join screen — the
thing you read out loud to someone sitting next to you, and it never expires
because it never travels. `group_invites` is a link: a 72-bit base64url token
with an expiry, a use count and a revocation, minted on demand by
`create_group_invite` and redeemed by `join_group_with_invite`.

The split is the point. A permanent code pasted into a group chat is a door
that never closes — anyone who scrolls back far enough can walk in a year
later, and the only way to stop them is to abandon the group.

`create_group_invite` **reuses a live invite** rather than minting per tap, for
the same reason `create_duel` does: four taps on "Share invite" leaving four
working links means revoking "the" link stops meaning anything. Nothing writes
`group_invites` directly — there is a SELECT policy for members and no INSERT,
UPDATE or DELETE policy at all, so a client cannot mint itself an invite or push
an existing expiry out.

**A duel refuses both paths.** `create_group_invite` rejects `kind = 'duel'`,
and `join_group_with_code` now rejects it too — a duel's auto-generated code
used to let a third person walk into "just the two of you", which also silently
broke a balance both sides read as pairwise.

Sharing goes through the **OS share sheet** (`Share.share`), never a WhatsApp
button: which app a group actually lives in is not something to guess, and a
hardcoded `whatsapp://` is a dead end on a phone without it with no way to find
out beforehand.

`inviteUrl` prefers `https://` over `betta://` and that is not cosmetic — a
custom scheme is dead text everywhere until the app is installed, and the person
being invited is by definition the one who has not installed it. On the web the
origin is read from `window.location`; on a device it comes from
`EXPO_PUBLIC_WEB_ORIGIN`, falling back to the scheme when nothing is deployed.
Opening straight into the installed app from an `https://` link additionally
needs an `apple-app-site-association` file on the domain and the
associated-domains entitlement — **not set up yet**; today an https link opens
the web build.

A link opened by somebody with no account is the normal case, and the redirect
gate in `app/_layout.tsx` would otherwise eat it. `rememberInvite` parks the
token in AsyncStorage, and the gate hands it back after sign-in instead of
dropping them on an empty Groups tab.

### Duels

A one-on-one challenge is a **real two-person group** with `kind = 'duel'`, not
a second kind of object. That is the entire reason it was cheap: every policy,
balance, settlement, notification and realtime path already works on groups and
keeps working untouched.

`create_duel` **reuses** an existing duel between the same two people rather
than making another. Without that, a running total with one friend fragments
across a dozen identical groups and the Profile ledger stops meaning anything.

`fetchMyGroups` filters duels out (the Groups tab would otherwise become a
roster of everyone you have ever bet against); `fetchAllMyGroups` keeps them,
which is what the Profile ledger reads.

### Usernames

Assigned on signup by `handle_new_auth_user`, and backfilled for older accounts
by the same `suggest_username` function — **one implementation, called from
both**. They were written separately at first and the trigger was simply
forgotten, so every account created *after* the migration had no handle and
could not be challenged by anyone. The backfill made the existing rows look
fine, which is exactly what hid it.

### bigint coercion

`group_balances` and `my_stats` return `bigint`, which PostgREST may hand
back as a string. Every read site wraps with `Number(...)`. Keep doing that on
any new consumer.

---

## 7. Known issues and suspected bugs

**The SQL is now exercised.** `supabase/test/run.sh` spins up a throwaway
PostgreSQL 16, fakes just enough of the Supabase platform (`auth.users`,
`auth.uid()`, `storage.objects`, the realtime publication, and the table
grants Supabase hands out on its own), applies every migration in order, runs
the seed script on top, and then drives the policies as the `authenticated`
role with a JWT subject. It checks that a member sees their group and an
outsider sees nothing without the `group_members` policy recursing, that
clients cannot write `bet_ledger_entries`, that `join_bet`/`leave_bet` and
`join_group_with_code` work, that `enforce_bet_open` rejects a position on a
resolved bet, that a non-creator cannot cancel, that `resolve_bet_with_entries`
refuses every shape of unbalanced ledger, that the push-target functions pick
the right people and are not callable by a signed-in client, and that a
settlement moves both balances and still nets to zero. All of that passes.

**A migration that backfills existing rows needs rows to exist.** Against an
empty database every backfill is a no-op that passes for the wrong reason —
which is exactly how the options migration shipped a bug that made it fail on
any real project with settled history: its `bet_positions` update is refused by
`bet_positions_require_open` on every locked, resolved, cancelled or
past-deadline bet. `supabase/test/pre/<migration filename>.sql`, when one
exists, is applied immediately *before* that migration, so the old shape is in
the table and the migration has real work to do. Write one for any migration
that touches rows rather than only schema.

The grants `anon` and `authenticated` get are modelled as **default
privileges, set before the migrations run** — which is how Supabase actually
does it. They used to be a blanket `GRANT` after them, which silently
re-granted anything a migration revoked, so a function locked down to the
service role tested as locked down while being callable by anyone.

**A stub that is more forgiving than the platform asserts the bug is not
there.** The same shape as the grants above, found a second time and worth
stating as a rule. `00_supabase_stub.sql` used to install pgcrypto into
`public`; Supabase installs it into `extensions`. `create_group_invite` mints
its token with `gen_random_bytes` under `search_path = public`, so against the
stub the name resolved and the check passed, while on a real project the
function is not in `public` at all and **every tap on "Share invite" failed**
with `function gen_random_bytes(integer) does not exist`. Nothing called the
function in the harness either, so the whole path was untested twice over.
Both halves are fixed: pgcrypto now lives where the platform puts it, and
section 47 actually mints a link. `gen_random_uuid()` was never affected — it
has been a core built-in since PostgreSQL 13 and needs no extension, which is
precisely why that one call broke alone.

When you model a piece of the platform, model it as it is, not as it would be
convenient. A difference in the permissive direction is invisible until a user
finds it.

What it does **not** cover is anything the platform provides rather than this
repo: real storage behaviour, GoTrue, and Edge Function deployment. The
storage policies are only checked for syntax, not for effect.

Concrete things worth fixing, roughly by severity:

1. **Media upload is not transactional with the bet.** `createBet` inserts the
   bet, uploads each file, then inserts the `bet_media` rows. A failure part
   way leaves a posted bet with some or none of its attachments, and orphaned
   objects in the bucket. That is the better of the two failure modes — the
   bet survives — but it wants a cleanup path.

2. **Signed URLs expire after an hour.** A feed left open longer than that
   shows broken media until the next refresh. Realtime and pull-to-refresh
   both re-sign, so it is only visible on a screen left untouched.

3. **A part payment is capped at what is outstanding.** `PaymentSheet` refuses
   an amount above the suggested figure, because overpaying would flip the
   balance and quietly make the other person the debtor. A genuine overpayment
   is a new debt the other way and has nowhere to be recorded yet.

4. ~~**One push token per user.**~~ **Fixed** — `user_devices`, keyed on the
   token so a device changing hands re-points it rather than notifying the
   previous owner. `users.expo_push_token` is still read, so an account that
   has not reopened the app is not dropped.

5. ~~**`useFocusEffect` in `app/(tabs)/groups.tsx` has empty deps.**~~ It does
   not, and has not for a while — it depends on `reloadGroups`. Recorded here
   as a reminder that a known-issues list rots unless it is read against the
   code.

6. ~~**Realtime subscribes to `bet_positions` unfiltered.**~~ **Fixed** —
   `…_position_group_id.sql` denormalises `group_id` onto the position, so the
   group screen filters on `eq.` and the feed on `in.(…)`. The column is
   derived by a trigger that overwrites whatever the client sent, because a
   value a client cannot express an opinion about needs no validating.

7. **`my_stats.bets_settled` counts ledger rows**, so bets that resolved with
   nobody on the winning side don't appear in the count. Arguably correct,
   worth a decision.

8. **Announcements are still client-invoked.** They now live in
   `queries.ts` rather than in a screen, so no caller can forget one, but a
   client that dies between the write and the `notify` call still means nobody
   is told. A database webhook would be more reliable.

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
  explicit `EXPO_PUBLIC_ENABLE_DEMO=1` for testing an exported bundle.

  **It reached a deployable build once, so this is not automatic.** Metro
  inlines `process.env.EXPO_PUBLIC_*` as literals and *caches them*, so an
  export run after any demo export inherits `"1"` and ships the "Skip sign-in"
  button — with the variable itself nowhere in the output, because the value
  was folded in, not the name. Grepping the bundle for the flag finds nothing;
  grepping for the button's text always finds it, because the component is
  imported either way. The only honest check is to load the built page and look
  for the button. `build:web` therefore passes `--clear`, and any deploy path
  must keep doing so.
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
- **Every new function in `public` needs its own explicit
  `revoke execute ... from public, anon`**, in the migration that creates it,
  next to its grant. `…_anon_rpc_lockdown.sql` also set the schema's default
  privileges to prevent this, and that was not enough: the platform re-grants
  on newly created objects, so `accept_terms` — added by the very next
  migration — came back anon-callable while the other 37 stayed locked.
  `…_relock_anon_execute.sql` records the whole finding. There is no setting
  that makes this automatic here.
- Route files under `app/` export their screen and nothing else — shared
  helpers live in `src/` (see `use-tab-bar-inset.ts`).
- **Delete a branch once its pull request is merged** — every one, with two
  permanent exceptions: `main`, and `dev`. `dev` is the integration branch
  everything is cut from and merged back into; it is never deleted, including
  when it is merged into `main`. If a `dev` → `main` pull request is merged
  with GitHub's "automatically delete head branches" setting on, `dev` will be
  deleted — recreate it immediately (`git checkout -B dev main && git push -u
  origin dev`), since at that moment it is identical to `main` anyway.
- Don't add a dependency without a reason the existing stack can't cover.
  `useAsync` is deliberately tiny — an MVP with eight screens doesn't need a
  query cache when Realtime already says when to refetch.

---

## 11. The legal text, and why it is bundled

The terms (which are the EULA), the privacy policy and the support page live as
text in **`legal-text.json`** and are rendered twice: by `app/legal/*` inside
the app, and by `scripts/build-legal-html.js` into `public/legal/*.html` for the
web, which `npm run build:web` regenerates on every build.

One source, two renderers, the same arrangement as the palette and for the same
reason. What somebody agrees to on the sign-up screen, what `users.terms_version`
refers to, and what a reviewer reads at the privacy-policy URL in App Store
Connect are the same words by construction rather than by diligence.
`TERMS_VERSION` is read *off* the JSON rather than typed next to it, so the
recorded version and the words actually read cannot drift apart.

**The text is bundled, not only hosted, and that is the point.** The sign-up
checkbox used to link at `example.invalid` — so the one screen where a person
agrees to the rules opened nothing at all. Bundling makes the agreement real
from the first account, before any hosting decision and with no network. The
hosted copy is then the *listing's* URL rather than the only copy.

Three consequences worth keeping:

- **Two placeholders, `{{app}}` and `{{support}}`.** The app name is a
  placeholder so the rename ahead is one constant rather than a hunt through
  nine paragraphs; the support address because it genuinely differs per
  deployment. `fillPlaceholders` is the only substitution, and
  `__tests__/legal.test.ts` fails if either survives into rendered output.
- **The generated pages are gitignored.** They carry the support address from
  the environment, so a committed copy would carry whichever machine last built
  them. They also carry no script, no stylesheet and no image — a legal page
  that fails to render because an asset did not load is a legal page that is
  not published.
- **`EXPO_PUBLIC_SUPPORT_EMAIL` unset means no contact row**, rather than a row
  that opens a mail composer addressed at a placeholder. Guideline 1.2 wants
  published contact information; a contact that silently goes nowhere is worse
  than an absent one, because it looks like the app answered you.

`__tests__/legal.test.ts` holds the clauses that are compliance rather than
prose — no tolerance for objectionable content, a 24-hour response, reporting,
blocking, removal of accounts that post abuse, and a privacy policy naming
every row of the App Store nutrition label. They go missing through a
well-meaning edit, not through a bug, which is exactly why they are tests.
