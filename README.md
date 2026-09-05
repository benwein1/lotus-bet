# 🪷 Lotus Bet

Friendly bets with your group chat. Post a two-outcome bet, watch your friends
pick sides, and let the app keep score of who owes whom.

**Lotus Bet never touches money.** There are no payments, no wallets, no in-app
currency, and nothing purchasable. It records obligations; you settle up
outside the app — cash, Bit, bank transfer, whatever you already do. This is a
deliberate product and App Store compliance decision, not a missing feature.

## Stack

| Layer | Choice |
| --- | --- |
| App | React Native + Expo (SDK 57), Expo Router, TypeScript |
| Styling | NativeWind (Tailwind for RN) |
| Backend | Supabase — Postgres, Auth, Realtime, RLS, Edge Functions |
| Auth | Supabase phone-number OTP |
| Push | Expo Notifications (APNs underneath) |

## Getting started

```bash
npm install
cp .env.example .env      # then fill in your Supabase URL + anon key
npm start                 # press "i" for the iOS simulator
```

Without a `.env` the app boots to a "finish setting up" screen rather than
crashing.

### Setting up the backend

See [`supabase/README.md`](supabase/README.md) for applying the migrations,
enabling phone auth, and deploying the two Edge Functions.

### Checks

```bash
npm test          # unit tests — payout maths, settlement, formatting
npm run typecheck # tsc --noEmit
```

## How a bet works

The creator sets **one fixed pot** for the whole bet — say ₪100. It does not
grow as more people join. Everyone in the group picks side A or side B; nobody
chooses a personal stake.

When the creator declares a winner:

- Each of the `W` winners receives `floor(pot / W)`.
- Each of the `L` losers owes `floor(pot / L)`.
- Integer division leaves a remainder on each side. Those leftover agorot are
  handed out one at a time to the lowest-sorting user ids, so both sides always
  net to **exactly** the pot.
- If nobody backed the winning side, the bet still resolves — it just has no
  winners and no money moves.

Worked example: a ₪100 (10 000 agorot) pot, 2 people on A, 3 on B, B wins.
Winners get `floor(10000/3) = 3333` each and one of them gets the spare agora
(3334). Losers owe `floor(10000/2) = 5000` each. Both sides total 10 000.

This lives in [`supabase/functions/_shared/payout.ts`](supabase/functions/_shared/payout.ts):
a dependency-free pure module, re-exported to the app as `@/lib/payout` and
imported directly by the `resolve-bet` Edge Function, so the tested code is the
code that writes the ledger. It is covered by property-style tests that assert
the books balance for every plausible split.

## How settling up works

Resolving a bet writes one signed `bet_ledger_entries` row per participant —
a balance line, not a pairwise IOU. The settle-up screen sums those per member,
then runs greedy debt simplification to produce the shortest list of payments
that clears everyone (`src/lib/settlement.ts`).

Nothing is persisted until someone taps **Mark as paid**, which writes a
`settlement_confirmations` row. That row is folded back into the balance
calculation, so a settled payment does not reappear.

## Layout

```
app/                      Expo Router routes
  (auth)/                 phone → OTP → profile setup
  (tabs)/                 Home feed · Groups · Profile
  group/                  create, join, [id] detail, new-bet, settle
  bet/[id].tsx            bet detail — join a side, resolve, cancel
src/
  lib/payout.ts           re-export of the canonical payout maths
  lib/settlement.ts       balance netting + greedy debt simplification
  lib/queries.ts          every Supabase read/write the app makes
  lib/format.ts           agorot ↔ shekels, countdowns, initials
  components/             BetCard, OddsBar, UI primitives
  hooks/                  useAsync, group Realtime channels, settlement view
  providers/              auth + profile context
supabase/
  migrations/             schema, RLS policies, RPCs
  functions/resolve-bet   declares a winner, writes the ledger, pushes results
  functions/notify-new-bet announces a new bet to the rest of the group
__tests__/                unit tests
```

## Notifications

Two pushes, deliberately:

- A new bet is posted in one of your groups.
- A bet you joined is resolved (the body carries your result and amount).

Joins are **not** notified — that gets noisy fast in an active group. Both are
toggleable per user on the Profile tab.

## MVP scope

Not built yet, on purpose:

- No payments, wallets, or purchasable currency of any kind.
- Two-outcome bets only. The `bets` table is shaped so a `bet_options` table
  can supersede the two label columns later without rewriting readers.
- No public or global bet discovery — bets are always scoped to a group.
- No editing a bet after creation. The creator can lock, resolve or cancel it,
  and that is all.
