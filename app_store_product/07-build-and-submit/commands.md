# Build and submit — tasks t06, t07, t15, t17, t35

Every command runs from the repo root.

## 1 · Install and sign in — t06

```bash
npm i -g eas-cli
eas login
```

## 2 · Link the project — t07  ⚠️ BLOCKER

```bash
eas init
```

This writes `extra.eas.projectId` into `app.json`, which is **currently `{}`**.

**Without it, push notifications are silently dead.** Not broken loudly — the
token request just never resolves to anything Expo can route to. Nothing on
screen says so, which is why this is called out rather than left to the build.

Commit the changed `app.json` afterwards.

## 3 · Confirm the bundle ID is free — t08

`com.betta.app`, in App Store Connect. **It cannot be changed after the first
build is uploaded**, so check before you build, not after.

## 4 · Build — t15

```bash
eas build --platform ios --profile production
```

The `production` profile in `eas.json` already carries the Supabase URL, the
publishable key, the web origin and the support email. **`EXPO_PUBLIC_ENABLE_DEMO`
is deliberately absent** — that is what keeps the "Skip sign-in, use demo data"
button out of the shipped app.

EAS will offer to create the distribution certificate and provisioning profile.
Let it; that is the normal path.

Expect roughly 20–30 minutes in the queue.

### What was already pre-flighted for you — t16

`expo prebuild` was run locally and the generated Xcode project inspected. All
correct, so none of these should surprise you:

- Apple Sign In entitlement (`com.apple.developer.applesignin`) — the Guideline 4.8 one
- Push entitlement (`aps-environment`)
- Camera, photo-library and microphone usage strings, all real sentences
- `betta://` URL scheme, portrait lock, `ITSAppUsesNonExemptEncryption: false`

`expo-doctor` passed 19/21; the two failures were network lookups blocked by a
proxy, not project problems.

## 5 · Submit the binary — t17

```bash
eas submit --platform ios --latest
```

It will ask for your Apple ID and the App Store Connect app. Then wait for
processing (**t18**) — usually 10–30 minutes, occasionally hours. The build will
not be selectable in App Store Connect until processing finishes.

## 6 · Attach and submit for review — t35, t36, t37

In App Store Connect: attach the processed build, set release to **Manually
release this version** (t36), then Submit for Review.

## If you are rejected on Guideline 5.3 — t38

**Reply, do not redesign.** The argument is already written in
`04-app-review/review-notes.md`. The app genuinely does not touch money, and the
settle-up screenshot says so in the app's own words. A rewrite in a panic is how
a two-day appeal becomes a two-week one.
