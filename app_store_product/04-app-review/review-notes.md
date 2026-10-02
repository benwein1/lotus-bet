# App Review notes — task t34

Paste the block below into **App Store Connect → your version → App Review
Information → Notes**. Fill the demo account fields with the same credentials.

> Betta is a private social app for friendly bets between people who already
> know each other. It does **not** handle money in any form: there are no
> payments, no wallets, no in-app currency and nothing purchasable. When a bet
> is resolved the app records who owes whom, and users settle up between
> themselves outside the app, in cash. No funds ever pass through Betta or any
> payment processor.
>
> There is no public or global discovery — bets exist only inside private
> groups the user has been invited to, and users are found by username prefix
> search, which returns at most ten results and no contact details.
>
> Moderation: comments and bets can be reported by pressing and holding them,
> and users can be blocked from the same sheet. Objectionable content is
> filtered on submission, the terms carry a no-tolerance policy agreed to at
> sign-up, and reports are acted on within 24 hours.
>
> Demo account: appreview@betta.local / AppReview-2026!
> It is pre-seeded with a group of five, an open bet with a side still free to
> join, a three-option bet, a locked bet, a resolved bet with its ledger, a
> private bet, a one-on-one duel, and a comment thread — so the whole flow is
> visible without needing a second device.

## Demo account fields

| Field | Value |
| --- | --- |
| Sign-in required | **Yes** |
| User name | `appreview@betta.local` |
| Password | `AppReview-2026!` |

The four other seeded accounts share the password `betta-demo-1234`, if you
ever need a second side of a bet by hand.

## These credentials are live and verified

They were repaired on the production project on 2 Oct 2026. The accounts
originally had `auth.users` rows but **no `auth.identities` rows**, which GoTrue
needs to resolve a password sign-in — so they returned *"Invalid login
credentials"*, which reads exactly like a wrong password. That is a rejection
("we were unable to sign in with the credentials provided"), not a question.

Fixed, and the class is closed: the test harness now models `auth.identities`,
and section 57 of the policy checks fails if any seeded signable account is
missing one.

**Before you submit, sign in once yourself** with the credentials above, on the
build you are submitting. It takes a minute and it is the single highest-value
check in this folder.

## One thing the seed deliberately does not create

**Photos and video.** `bet_media` rows point at objects in a private bucket, and
a row without its object renders as a broken image — worse than no media.

**Attach a photo to a bet from a real device before you submit.** It is also the
only way to see the photo-permission prompt, which a reviewer will trigger.

## review_account.sql

`review_account.sql` in this folder is a copy of `supabase/seed/review_account.sql`.
It is idempotent, so re-running it is safe. Paste it into the Supabase SQL
editor **of the project the submitted build points at** if you ever need to
rebuild the demo data.
