# APP_STORE.md — shipping Lotus Bet to the App Store

A launch checklist for *this* app, built from reading the repository and the
current App Store Review Guidelines. Every item is classified:

- **P0** — must be fixed before you can submit, or you will be rejected
- **P1** — strongly recommended before submitting
- **P2** — can ship later

Reviewed at `dc94dd6` plus this branch. Guidelines checked against
[developer.apple.com/app-store/review/guidelines](https://developer.apple.com/app-store/review/guidelines/)
on 2026-09-14.

---

## 0. The three things that will get you rejected

Read this section even if you read nothing else.

1. **No in-app account deletion (P0).** Guideline 5.1.1(v): *"If your app
   supports account creation, you must also offer account deletion within the
   app."* There is no delete path in `queries.ts`, no RPC, no UI. This is an
   automatic rejection and it needs a product decision first (see §3).
2. **No reporting, blocking or moderation (P0).** Guideline 1.2 requires, for
   apps with user-generated content: a filtering method, a way to report
   offensive content with timely response, the ability to block abusive users,
   and published contact information. This app has comments, display names,
   group names, bet titles and user-uploaded photos and video — it is squarely
   a UGC app. **None of the four exists.**
3. **Demo mode must not ship (P0).** See §7. It has reached a deployable build
   once already.

**The good news:** the single biggest risk you might have expected — being
treated as a gambling app — is manageable, and your existing architecture is
most of the defence. See §2.

---

## 1. Product readiness

### Works today

| Flow | State | Notes |
| --- | --- | --- |
| Account creation | ✅ | Email + password, handles confirmation on and off |
| Profile setup | ✅ | Redesigned on this branch |
| Password recovery | ✅ | Complete end to end as of `9efedcb`; **needs custom SMTP** |
| Group create / join by code | ✅ | |
| Invite links | ✅ | 72-bit token, expiry, revocation, reuse |
| Duels | ✅ | Real two-person group, sealed from both join paths |
| Private bets | ✅ | `bet_invitees` + `can_see_bet` |
| Multi-option bets (2–8) | ✅ | |
| Join / switch / leave a bet | ✅ | Trigger-enforced while open |
| Lock / resolve / cancel | ✅ | Creator only; resolution is one transaction |
| Proof of outcome | ✅ | **Needs its migration run** |
| Comments and likes | ✅ | Redesigned on this branch |
| Settlement | ✅ | Client-side simplification, server-side balances |
| Push notifications | ✅ | Three server events, one switch |
| Local deadline reminders | ✅ | |
| Media upload | ✅ | With the caveats in §1.2 |
| Logout | ✅ | |
| Empty states | ✅ | Feed, groups, comments all have real ones |
| Loading states | ✅ | Skeletons, not spinners, where the shape is known |
| Light / dark | ✅ | One class name correct in both; drift test in CI-less jest |

### Gaps

| # | Gap | Pri |
| --- | --- | --- |
| 1 | **Account deletion** — missing entirely | **P0** |
| 2 | **Report / block / moderate** — missing entirely | **P0** |
| 3 | **Custom SMTP** — password reset only reaches the project owner without it | **P0** |
| 4 | **Proof-media migration not run** on the live project | **P0** |
| 5 | Offline behaviour — requests fail with a generic error; no offline state | P1 |
| 6 | Media upload is not transactional with the bet (CLAUDE.md §7.1); a partial failure orphans objects | P1 |
| 7 | Signed URLs expire after an hour; a screen left open shows broken media | P1 |
| 8 | No global 401 handler — a revoked session surfaces as a failed request, not a clean sign-out | P1 |
| 9 | Part payment capped at the outstanding amount; genuine overpayment has nowhere to go (CLAUDE.md §7.3) | P2 |
| 10 | One push token per user — second device silently overwrites the first | P2 |
| 11 | `my_stats.bets_settled` counts ledger rows, so zero-winner bets do not appear | P2 |

### Error and offline states (P1)

Today a failed request becomes a string in an `ErrorNotice`. That is honest but
undifferentiated: "Failed to fetch" reads identically whether the user is in a
lift, the project is paused, or their session expired. Before submitting, add a
connectivity check so an offline feed says so. Reviewers **do** test in
Airplane Mode.

---

## 2. Apple requirements

### 2.1 Gambling — how to not become a gambling app

This is the existential positioning question, so be precise about it.

**Guideline 5.3.4** governs *real money gaming* — "sports betting, poker, casino
games, horse racing" and lotteries — and requires licensing, geo-restriction and
that the app be free. **It does not apply to you**, because no money or
anything of value moves through the app. The `bet_ledger_entries` table records
an obligation; settlement happens in cash outside the app. There is no wallet,
no in-app currency, no payment processor, nothing purchasable.

**That is a compliance posture, not an accident, and it is fragile in exactly
one way: how the app presents itself.** A reviewer decides what your app *is*
in about ninety seconds, from the name, the icon, the screenshots and the first
screen.

Which is why the **name is a genuine risk**. "Lotus Bet" is currently also the
name of a live online casino and sportsbook (`lotusbet.casino`, operated by
DLDAtech N.V., launched 2026), alongside Lotus365, Lotusbook365 and
lotusbet365 — a whole cluster of real-money gambling brands. A reviewer who
searches your app name will find casinos. See the naming recommendation
delivered separately; **this is the strongest single argument for renaming
before submission.**

**Do (P0):**
- Keep the money disclaimer on the auth, new-bet, settle-up and profile screens.
  It is load-bearing (CLAUDE.md §1) and it is the first thing a reviewer reads.
- Say "keeps score" and "who owes whom", never "place a bet", "odds", "stake"
  or "payout", in the App Store description, subtitle and keywords.
- Put the disclaimer in the **App Store description itself**, not just in-app.
- Use review notes (§6) to state plainly that no money is handled.

**Never:**
- Add a wallet, balance top-up, or any payment integration.
- Use casino iconography — chips, dice, cards, roulette — in the icon or
  screenshots.
- Buy gambling keywords.

**Also relevant: guideline 1.4.5** — apps should not urge users into activities
that risk physical harm. The bet-suggestion feature (`suggestions.ts`) should be
checked to make sure nothing it proposes is a dare. Worth a read-through. **P1.**

### 2.2 Sign in with Apple — **not required**

Guideline 4.8 applies when an app uses a *third-party* login service (Google,
Facebook, etc.) as a primary sign-in. It explicitly does not apply when "your
app exclusively uses your company's own account setup and sign-in systems".

Lotus Bet uses Supabase email + password — your own system, not a third-party
social login. **Sign in with Apple is therefore not required.**

If you later add Google sign-in, it becomes required immediately. **P2** as a
UX nicety; not a blocker.

### 2.3 Account deletion — **P0**

Guideline 5.1.1(v), quoted in §0. Required, in-app, discoverable, not
"email us to delete".

**The product decision first:** a user's rows are load-bearing for other people.
Deleting a participant's `bet_ledger_entries` would unbalance a settled ledger
for everyone else in the group. The defensible design is a **soft delete**:

- Scrub `display_name` to "Deleted user"; null `email`, `phone`, `avatar_url`,
  `expo_push_token`, `username`
- Delete `bet_comments` and `bet_likes`
- **Keep** `bet_ledger_entries` and `bet_positions` so other people's history
  stays coherent
- Delete the `auth.users` row so they can no longer sign in

Tell the user what is kept and why, on the confirmation screen. Apple accepts
this; what it does not accept is no path at all.

### 2.4 User-generated content — **P0**

Guideline 1.2 requires four things. You have none:

| Required | State | Minimum viable |
| --- | --- | --- |
| Filter objectionable material | ❌ | A profanity filter on comments and bet titles, or an explicit content policy plus reactive takedown |
| Report offensive content | ❌ | Long-press a comment or bet → Report, writing to a `reports` table; **respond within 24 hours** |
| Block abusive users | ❌ | A `user_blocks` table; blocked users' comments hidden, and they cannot challenge you |
| Published contact info | ❌ | Support email on the support URL and in the app |

You must also present an **EULA** that includes a no-tolerance policy for
objectionable content, and agreement to it at sign-up. Apple's standard EULA is
acceptable; add the UGC clause.

**Scope note:** your content is only ever visible inside private groups, never
publicly. That reduces real-world risk considerably but does **not** exempt you
— 1.2 is about user-to-user content, and friends-only content is still
user-to-user.

### 2.5 Privacy, nutrition labels and ATT

**Privacy nutrition labels (P0)** — declare in App Store Connect. Based on the
schema, you collect and link to identity:

| Data | Collected | Linked | Used for |
| --- | --- | --- | --- |
| Email address | Yes | Yes | Account |
| Name (display name) | Yes | Yes | App functionality |
| Photos or videos | Yes | Yes | App functionality |
| User content (comments) | Yes | Yes | App functionality |
| Identifiers (user id, push token) | Yes | Yes | App functionality |
| Phone number | Legacy accounts only | Yes | Account |

**Tracking: none.** There is no analytics SDK, no ad SDK, no third-party
tracker anywhere in `package.json`. So:

- **ATT prompt: not required**, and you should not add one. Guideline 5.1.2(i)
  requires the prompt only if you track; showing it without tracking is itself a
  problem.
- Declare "Data Not Used to Track You".
- If you later add analytics, revisit this whole section first.

**Privacy policy (P0)** — required, must be a live URL in App Store Connect, and
must cover what the table above says.

### 2.6 Push notifications

Guideline 4.5.4: push must be opt-in and must not be required to use the app.
✅ Already correct — one switch on Profile, off means off, the app works fine
without it.

The permission prompt should be preceded by context rather than fired on launch.
Currently `registerForPushNotifications()` runs as soon as a session exists,
which triggers the system prompt with no explanation. **P1** — show a short
"we'll tell you when a bet you're in is called" sheet first. A cold prompt gets
declined, and a declined prompt is very hard to recover.

### 2.7 In-app purchase

Not applicable — nothing is sold. Guideline 3.1.1 is not engaged. **Keep it that
way**: the moment you sell anything digital, you are in IAP and the "no money"
positioning gets more complicated.

### 2.8 Age rating

Answer the App Store Connect questionnaire honestly. "Contests" and
"Simulated Gambling" are the questions that matter.

- This app is **not** simulated gambling (no simulated wagering with virtual
  currency — there is no currency at all).
- It **does** facilitate contests between users.
- Expect **12+**, possibly 17+ depending on how you answer the UGC questions
  (unrestricted web access: no; user-generated content: yes).

Do not under-declare to chase a lower rating. Misrepresenting here is its own
violation. **P0** to answer; the outcome is what it is.

---

## 3. Store listing

| Item | Requirement | Pri |
| --- | --- | --- |
| **App name** | 30 chars. **Rename strongly recommended** — see §2.1 | P0 |
| **Subtitle** | 30 chars. Lead with friends and score, not betting. e.g. "Settle it with your friends" | P0 |
| **Description** | Open with what it is and what it is not. Put the no-money line in the first paragraph | P0 |
| **Keywords** | 100 chars. **Avoid** casino, gambling, betting odds, sportsbook, wager. **Use** friends, group, challenge, scoreboard, settle, dare, prediction | P0 |
| **Screenshots** | 6.9" and 6.5" required; 5.5" if supporting older devices. iPad not needed (`supportsTablet: false`) | P0 |
| **App icon** | 1024×1024, no alpha, no rounded corners. The lotus mark already renders every size via `scripts/build-icons.mjs` | P0 |
| **Privacy policy URL** | Required, live | P0 |
| **Support URL** | Required, live, with a working contact — also satisfies the 1.2 "published contact information" requirement | P0 |
| **Marketing URL** | Optional | P2 |
| **Promotional text** | 170 chars, editable without review — good for "new this week" | P2 |

**Screenshot advice specific to this app:** show the group, the comment thread
and the settle-up screen. Do **not** lead with the odds bar and a large ₪
figure — out of context it is the most gambling-looking screen you have.

---

## 4. Build and release configuration

### Current state, read from `app.json`

| Setting | Value | Verdict |
| --- | --- | --- |
| `name` | "Lotus Bet" | See §2.1 |
| `version` | `0.1.0` | Bump to `1.0.0` for release — **P0** |
| `ios.bundleIdentifier` | `com.lotusbet.app` | Fine; must match App Store Connect. Changing it later means a new app |
| `ios.supportsTablet` | `false` | Fine — no iPad screenshots needed |
| `ITSAppUsesNonExemptEncryption` | `false` | **Correct and valuable** — pre-answers export compliance, see §4.2 |
| `orientation` | `portrait` | Consistent with the design |
| `userInterfaceStyle` | `automatic` | Correct — both schemes are real |
| `newArchEnabled` | `true` | Fine on SDK 57 |
| Splash | configured light + dark | ✅ |
| Permission strings | photos, camera, microphone — all present and human | ✅ **Reviewers read these** |
| `extra.eas` | `{}` — **empty** | **P0**: no EAS project id |
| `eas.json` | **absent** | **P0** |

### Missing (P0)

- **`eas.json`** with `development`, `preview` and `production` profiles.
- **EAS project id** (`eas init`), which also fills `EXPO_PUBLIC_EAS_PROJECT_ID`
  — currently blank in `.env.example`, and **push tokens do not work without
  it** on a dev build.
- **Build number** strategy. Use `autoIncrement` in `eas.json` so every upload
  gets a distinct build; App Store Connect rejects duplicates.
- **Signing**: let EAS manage certificates and provisioning unless you have a
  reason not to.

### 4.2 Export compliance

`ITSAppUsesNonExemptEncryption: false` is already set, which skips the upload
questionnaire. That is the right answer here: the app uses HTTPS and the
platform's own crypto, and implements none of its own. Keep it. **P0 — verify
it survives any `app.json` edit.**

### 4.3 Environment variables

Production build must have:

```
EXPO_PUBLIC_SUPABASE_URL=<prod>
EXPO_PUBLIC_SUPABASE_ANON_KEY=<prod publishable key>
EXPO_PUBLIC_WEB_ORIGIN=https://<your domain>
EXPO_PUBLIC_EAS_PROJECT_ID=<from eas init>
```

and must **not** have `EXPO_PUBLIC_ENABLE_DEMO`. See §7.

### 4.4 Crash reporting and analytics

**Neither exists.** No Sentry, no analytics SDK.

- Crash reporting: **P1**. Shipping without it means a crash on someone's iPhone
  15 is invisible to you. Note that adding Sentry changes your privacy labels.
- Analytics: **P2**, and think hard. Adding one flips you into "Data Used to
  Track You" and an ATT prompt, for an app that currently has the cleanest
  possible privacy story. That story has real value.

---

## 5. Technical release checklist

### Run before every submission

```bash
npm run typecheck                  # tsc --noEmit
npm test                           # jest
npm run lint                       # expo lint
npm run theme:check                # global.css has not drifted from theme-colors.json
supabase/test/run.sh               # migrations + RLS + RPCs on throwaway Postgres
npx expo export --platform ios --output-dir /tmp/export-check
```

**Note:** `npm run lint` currently fails in a clean checkout — the repo has **no
ESLint config**, so `expo lint` tries to download one. Either commit an ESLint
config or drop the script; a check that cannot run is worse than no check.
**P1.**

### Device matrix

| Check | Pri |
| --- | --- |
| iPhone SE (smallest supported) — nothing clipped, no overflow | P0 |
| iPhone 15/16 Pro — the design target | P0 |
| iPhone Pro Max — hero and feed card proportions hold | P1 |
| Physical device, not just simulator — media picker, camera, push, haptics **do not work properly in the simulator** | P0 |
| Light mode | P0 |
| Dark mode | P0 |
| Reduce Motion on | P1 |
| Dynamic Type at larger sizes | P1 |
| Safe areas — notch and home indicator | P0 |
| Keyboard — every form; the comment composer especially | P0 |

### Functional matrix

| Check | Pri |
| --- | --- |
| Fresh install → sign up → profile setup → create group → post bet | P0 |
| Existing account sign-in | P0 |
| Password reset end to end **on a real device with real email** | P0 |
| Invite link: `https://` on a device without the app installed | P0 |
| Deep link: `lotusbet://` with the app installed | P1 |
| Media permissions: grant, deny, and deny-then-enable-in-Settings | P0 |
| Notification permission: grant and deny | P0 |
| Slow network (Network Link Conditioner, 3G) | P1 |
| **No network** — every screen must fail legibly | P0 |
| Account deletion, once built | P0 |
| Sign out, then sign in as someone else on the same device | P1 |
| Release build, not just dev — Metro inlining differs | P0 |

---

## 6. App Store review notes

Reviewers reject what they do not understand. Give them this:

> Lotus Bet is a private social app for friendly bets between people who
> already know each other. It does **not** handle money in any form: there are
> no payments, no wallets, no in-app currency and nothing purchasable. When a
> bet is resolved the app records who owes whom, and users settle up between
> themselves outside the app, in cash. No funds ever pass through Lotus Bet or
> any payment processor.
>
> There is no public or global discovery — bets exist only inside private groups
> the user has been invited to, and users are found by exact handle only.
>
> Demo account: <email> / <password>. It is pre-seeded with a group, several
> bets and a resolved bet so you can see the full flow without needing a second
> device.

**Provide a working demo account (P0).** An app whose content only exists inside
private groups is otherwise an empty screen to a reviewer, and "we couldn't
evaluate it" is a rejection.

---

## 7. What must not ship

| Item | Where | Risk | Pri |
| --- | --- | --- | --- |
| **Demo mode** | `src/lib/demo.ts`, `src/components/demo-entry.tsx` | **Has reached a deployable build before.** Metro inlines and *caches* `EXPO_PUBLIC_*`, so an export after a demo export inherits `"1"` and ships the "Skip sign-in" button — with the variable name nowhere in the output | **P0** |
| Placeholder Supabase project | `.env` | Pointing release at `demo.supabase.co` | P0 |
| `.env` committed | gitignored ✅ | — | ✅ |
| Seed data | `supabase/seed/test_members.sql` | Only applied by the test harness; never run it against production | P0 |
| Debug UI | `DemoBadge` | Gated by `DEMO_AVAILABLE` | ✅ |
| Service-role key | not present ✅ | Would bypass all RLS | ✅ |

### The only honest demo-mode check

Grepping the bundle for `EXPO_PUBLIC_ENABLE_DEMO` **finds nothing even when the
flag is on**, because Metro folds in the value, not the name. Grepping for the
button text always finds it, because the component is imported either way.

**Load the built app and look for "Skip sign-in".** That is the check.
`build:web` passes `--clear` for this reason; any deploy path must too.

---

## 8. Recommended execution order

### Phase 1 — unblock submission (P0, ~2–3 weeks)

1. **Decide the name.** Everything downstream — bundle id, icon, listing,
   screenshots — depends on it, and the current name collides with live casino
   brands. Decide first or redo the work.
2. **Fix SECURITY.md finding #1** (email/phone/push-token exposure). Not an
   Apple requirement, but you should not ship a known privacy hole, and it
   touches the same `users` table that account deletion will.
3. **Account deletion** (§2.3) — after the soft-delete decision.
4. **Report, block, moderate** (§2.4) — the largest single piece of work here.
5. **Custom SMTP** — password reset does not work for real users without it.
6. **Run the proof-media migration** on the live project.
7. **EAS setup**: `eas init`, `eas.json`, project id, build numbering.
8. **Legal pages**: privacy policy, terms/EULA with the UGC clause, support URL.

### Phase 2 — submission quality (P1, ~1 week)

9. Offline and error states.
10. Pre-permission context sheet for notifications.
11. Crash reporting.
12. ESLint config so `npm run lint` actually runs.
13. Full device matrix (§5), on physical hardware.
14. Screenshots, description, keywords, age rating.
15. Privacy nutrition labels.

### Phase 3 — submit

16. Bump to `1.0.0`, production build, TestFlight.
17. Internal testing on real devices, real network conditions.
18. Review notes + demo account.
19. Submit.

### Phase 4 — after approval (P2)

20. Universal Links (`apple-app-site-association` + associated domains) so
    invite links open the app rather than the web build.
21. Multi-device push (`user_devices` table).
22. Media upload transactionality and orphan sweep.
23. Overpayment handling.
24. Sign in with Apple, if you ever add a social login.

**Realistically: 3–5 weeks to submittable**, dominated by moderation tooling
and account deletion. Neither is glamorous and neither is optional.
