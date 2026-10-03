# Sign in with Apple — task t10

**Guideline 4.8.** An app offering a third-party login must also offer one that
limits data collection to name and email and does not track. Sign in with Apple
is what Apple accepts for that. Betta ships the Google button, so **Apple is not
optional — shipping without it is an automatic rejection.**

Measured on the live project: `auth.identities` holds **14 `google` rows and
zero `apple` rows.** Apple has never been switched on.

## The code is done

Nothing below needs a code change. Already in place and verified:

| | Where |
| --- | --- |
| The native sheet, and the two-value nonce Apple requires | `src/lib/oauth.ts` |
| The button, iOS-only, inverting per colour scheme | `src/components/social-auth.tsx` |
| Apple's name captured on the one authorisation that gives it | `src/providers/auth-provider.tsx` |
| `usesAppleSignIn: true` + the `expo-apple-authentication` plugin | `app.json` |
| The entitlement in the built app | confirmed via `expo prebuild` |

**Betta uses the native flow** (`signInWithIdToken` with Apple's identity
token), not web OAuth. That is why the next part is short: the Services ID and
the `.p8` secret key — with its 6-month rotation — are only needed for the OAuth
flow, which this app does not use.

---

## Step 1 · Apple Developer (~2 min)

1. Go to **[Identifiers](https://developer.apple.com/account/resources/identifiers/list/bundleId)**.
   Set the filter in the top right to **App IDs**.
2. Find **`com.betta.app`**, or create it: **+** → **App IDs** → **App** →
   Description `Betta`, Bundle ID **Explicit** = `com.betta.app`.
3. Open it, scroll the **Capabilities** list, tick **Sign In with Apple**.
   Leave it on the default "Enable as a primary App ID".
4. **Save**, and confirm the prompt.

That is the whole Apple side. No Services ID, no key, no `.p8` download.

## Step 2 · Supabase (~1 min)

1. **Authentication → Sign In / Providers → Apple**.
2. Toggle **Enable Sign in with Apple**.
3. **Client IDs**: `com.betta.app`
   — exactly the bundle identifier, no spaces, nothing else in the field.
4. **Secret Key (for OAuth)**: leave **empty**. Native does not use it.
5. **Save**.

## Step 3 · While you are on that screen — task t12

**Authentication → URL Configuration → Redirect URLs.** Add both:

```
betta://
https://betta.weinsteinben2.workers.dev/**
```

The first is where a native OAuth redirect and the password-reset deep link come
back to; the second is the web build. Save.

## Step 4 · Verify — task t19

A simulator **cannot** do this: Sign in with Apple needs a real Apple ID signed
into a real device. Build to your own iPhone, or wait for TestFlight.

Tap **Continue with Apple**, complete the sheet, and you should land in the app.

Then say so, and this query settles it:

```sql
select provider, count(*) from auth.identities group by provider;
```

An **`apple` row appearing is the proof** — it means Apple signed a token,
Supabase accepted it, and an account exists. t10 and t19 both close on it.

---

## If it fails, the app now tells you which of the two steps you missed

Both messages were added for this, because the generic "Could not sign you in
with Apple" sent you looking at the app rather than at one dashboard field.

| On screen | What it means |
| --- | --- |
| *"Apple sign-in is not switched on for this project yet."* | **Step 2** — the toggle is off. The id-token path returns `provider_disabled`, whose wording differs from the OAuth path's; both are matched now |
| *"Apple sign-in is not finished: the app's bundle ID is missing from the provider's allowed client IDs."* | **Step 2.3** — the Client IDs field is empty or misspelt. This is the one that looks like the app is broken: the sheet opens and Apple signs a perfectly valid token, and only the exchange fails |
| The button is missing entirely | You are on web or Android. It is iOS-only by design — Apple's *web* flow needs the Services ID and key this project deliberately does not have |
| Nothing happens, no error | You dismissed the sheet. That is a normal outcome and is deliberately silent |

## One thing that will surprise you

**Apple gives the user's name exactly once** — on the very first authorisation
for this App ID, and `null` every time after, including after deleting the app
and reinstalling. The app writes it to the profile immediately for that reason.

So if you test, delete the account, and test again, the second run arrives with
no name and routes you to profile setup. **That is correct behaviour, not a
bug.** To get a first-authorisation again: iPhone **Settings → your name → Sign
in with Apple → Betta → Stop using Apple ID**.
