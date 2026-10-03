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
2. Find **`app.betta.mobile`**, or create it: **+** → **App IDs** → **App** →
   Description `Betta`, Bundle ID **Explicit** = `app.betta.mobile`.
3. Open it, scroll the **Capabilities** list, tick **Sign In with Apple**.
   Leave it on the default "Enable as a primary App ID".
4. **Save**, and confirm the prompt.

That is the whole Apple side. No Services ID, no key, no `.p8` download.

## Step 2 · Supabase (~1 min)

1. **Authentication → Sign In / Providers → Apple**.
2. Toggle **Enable Sign in with Apple**.
3. **Client IDs**: `app.betta.mobile`
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

---

# Testing it — task t19

## There is no shortcut around a real device

Sign in with Apple needs a real Apple ID on real hardware. **A simulator cannot
do it** — the sheet will not authenticate. Neither can the web build: the button
is iOS-only by design.

So the test is: get a build onto your iPhone.

## The fast loop — `preview`, about 25 minutes

```bash
git pull                       # the bundle ID changed; build the old one and nothing matches
eas device:create              # once — opens a link, install the profile on the iPhone
eas build --platform ios --profile preview
```

`eas device:create` prints a URL. Open it **on the iPhone**, install the
registration profile, and the device is registered for ad-hoc builds. When the
build finishes, EAS gives a QR code — scan it on the phone and the app installs.

This needs no App Store Connect record, so it does not wait on anything else.

### Why `preview` and not `development`

The `development` profile is a **simulator** build (`ios.simulator: true`), and a
simulator cannot do Sign in with Apple. Use `device` instead if you want a dev
client with hot reload on hardware; `preview` if you just want the app.

### One thing that would have wasted a build

`preview` and `development` carried **no `env` block** — only `production` did.
A build from either would have shipped with no `EXPO_PUBLIC_SUPABASE_URL` and no
anon key, so `isSupabaseConfigured` would be false and the app would open on the
"finish setting up" screen. **You would never have reached the sign-in screen at
all**, let alone the Apple button.

All four profiles now extend a `base` profile that holds the env once.

## What to do on the phone

1. Open the app. You should see **Continue with Apple** above Continue with
   Google. *(If it is missing, you are not on iOS or the build is stale.)*
2. Tap it. Apple's sheet appears.
3. Choose **Share My Email** or **Hide My Email** — both are fine, and Hide My
   Email is worth trying since it is what a privacy-minded reviewer will pick.
4. Confirm with Face ID.
5. You should land in the app, signed in.

## How we know it really worked

Not by the screen — by the database. Say the word and this runs:

```sql
select provider, count(*) from auth.identities group by provider;
```

**As of now:** `google 14 · email 10 · phone 2` — **no `apple` row at all.**

An `apple` row appearing is the proof, and it is a strong one: it means Apple
signed a token, Supabase accepted its audience and nonce, and a real account
exists. **t10 and t19 both close on it.**

## If it fails

The app names which step you missed — see the table above. The two most likely:

- *"not switched on for this project yet"* → the Supabase toggle
- *"bundle ID is missing from the provider's allowed client IDs"* → the Client
  IDs field. **It must now read `app.betta.mobile`**, not the old
  `com.betta.app`. If you pasted the old value, this is the error you will get.
