# app_store_product — everything you need to submit Betta

One folder, in the order you will use it. Each section says **which task it
belongs to** and **what you do with it**.

Task numbers match the launch runbook: <https://claude.ai/artifact/JcTDURRyk8XmCYTjsvuYKT>

---

## Do these four first — nothing else moves until they are done

| | Task | What | Why it is first |
| --- | --- | --- | --- |
| 1 | **t07** | `eas init` | Writes the `projectId` that is currently `{}`. **Push notifications are silently dead without it** — no error, nothing on screen |
| 2 | **t10** | Enable **Sign in with Apple** in Supabase | Guideline 4.8: an app offering Google login *must* also offer Apple. Verified: **zero Apple identities exist**, so this has never been switched on |
| 3 | **t04** | Merge `dev` → `main` | `main` is **25 commits behind**, and the production Worker builds from it — so the legal URLs you are about to paste may be stale or missing |
| 4 | **t19** | Test Sign in with Apple on a real iPhone | The one flow nothing in this repo has ever exercised. Apple's button is iOS-only and cannot be checked on web |

---

## What is in here

### `01-screenshots/` — t30 ✅ done
26 PNGs at exact App Store pixel sizes, light and dark, demo badge suppressed.

**Read `01-screenshots/HOW-TO-UPLOAD.md`** — the upload *order* matters more
than the images. Lead with `01b-feed-alt.png`, then `05-settle-up.png`.

### `02-app-icon/` — t27
`icon-1024.png`. Verified **1024×1024, no alpha channel** (App Store Connect
rejects an alpha channel at upload, after a full build). Full-bleed and not
pre-rounded — Apple applies its own mask.

Upload under App Information → App Icon.

### `03-listing-copy/listing.md` — t28, t29
Name, subtitle, description, keywords, category, promotional text. Paste as-is;
character counts are already checked.

**Category: Social Networking. Never Casino.**

### `04-app-review/` — t34
`review-notes.md` — the block to paste into App Review Information, plus the
demo credentials (`appreview@betta.local` / `AppReview-2026!`).

`review_account.sql` — a copy of the seed, idempotent, if you ever need to
rebuild the demo data.

**Sign in with those credentials yourself before submitting.** They were broken
until 2 Oct and are the single highest-value check in this folder.

### `05-privacy-and-age-rating/` — t32, t33
`privacy-nutrition-label.md` — the App Privacy wizard, screen by screen.
`age-rating.md` — the age questionnaire, row by row. Lands at 12+.

### `06-urls/urls.md` — t09, t31
The Privacy Policy and Support URLs to paste, plus what was verified about them
and what you still have to check.

### `07-build-and-submit/commands.md` — t06, t07, t15, t17, t35
Every command in order, with what each one does and what to expect.

---

## Four things I could not do from here, and why

Not oversights — each is genuinely outside what this environment can reach.

| Task | What | Why not | What you do |
| --- | --- | --- | --- |
| **t09** | Open the three legal URLs | The environment's network policy denied the host at the gateway (403 on CONNECT). The **pages themselves are verified** — they build, render, substitute your email, carry no placeholders and load no external assets | Open the three URLs in a browser. 30 seconds. **After t04**, or they may be stale |
| **t11** | Confirm Google is still enabled | Same network block on the auth settings endpoint. **Evidence it works: 14 Google identities, most recent sign-in 25 Sep 2026** | Supabase → Authentication → Providers. Glance at the toggle |
| **t12** | Redirect allow-list | Dashboard-only setting; no API or SQL path to it | Supabase → Authentication → URL Configuration. Add `betta://` and `https://betta.weinsteinben2.workers.dev` |
| **t13** | Custom SMTP | Needs an account with a third-party mail provider in your name | Sign up for Resend or SendGrid, paste the SMTP details into Supabase → Authentication → Emails. **Until then, only you receive password-reset mail** — Supabase's built-in sender is rate-limited to roughly the project owner |

If you want t09 and t11 done here rather than by hand, widen **Network access**
in this environment's settings (the cloud environment menu in the title bar,
then Edit) — either a broader access level, or add
`betta.weinsteinben2.workers.dev` and `ckuyggihxeedkovswjhj.supabase.co` to the
allowed domains. Then ask and I will run both.

---

## What was already verified for you

- **Native build config** — `expo prebuild` run locally and the Xcode project
  inspected: Apple Sign In entitlement, push entitlement, all three permission
  strings, URL scheme, portrait lock, encryption flag. All correct.
- **`expo-doctor`** — 19/21; the two failures were blocked network lookups.
- **Legal pages** — all three render, no placeholders, no external assets, zero
  console errors, support address substituted.
- **Repo** — typecheck clean, **482 tests passing**, SQL harness green.
- **Demo accounts** — repaired on production and verified by reading each row back.

---

## The one judgment call left for you

**Whether to raise the declared age rating from 12+ to 17+.** The content rates
12+ honestly; the terms require 16 and the database enforces it. Raising it is
conservative and costs reach; leaving it is defensible and accurate.
`05-privacy-and-age-rating/age-rating.md` lays out both sides. Nothing in the
product contradicts itself either way.
