# Required URLs — tasks t09, t31

App Store Connect refuses to submit without a live Privacy Policy URL, and
Guideline 1.2 wants published support contact. Both pages exist in this repo and
are generated from one source (`legal-text.json`) by `npm run legal`, which
`npm run build:web` runs on every build.

## The URLs

| Field in App Store Connect | URL | Required |
| --- | --- | --- |
| **Privacy Policy URL** | `https://betta.weinsteinben2.workers.dev/legal/privacy.html` | **Yes** |
| **Support URL** | `https://betta.weinsteinben2.workers.dev/legal/support.html` | **Yes** |
| Marketing URL | `https://betta.weinsteinben2.workers.dev` | Optional |

The terms are also published, at `/legal/terms.html`. Apple does not ask for a
EULA URL unless you use a custom one — the terms double as the EULA and are
bundled in the app, so there is nothing to supply.

## What was verified, and what you still have to do — t09

**Verified here (2 Oct 2026):** all three pages build and render in a browser.
Correct titles, the support address substituted, **no `{{placeholders}}`
survived**, **no external scripts, stylesheets or images**, zero console errors.
A legal page that fails to render because an asset did not load is a legal page
that is not published — hence the no-external-assets check.

**What you still have to do:** open the three URLs above in a browser and
confirm they load. That could not be done from the environment this was prepared
in — its network policy denied the host at the gateway.

## ⚠️ Check this before you paste the URLs

The production Worker builds from **`main`**, and `main` is currently **25
commits behind `dev`**. If the legal pages are missing or stale at those URLs,
that is why.

**Fix:** merge `dev` → `main` (task **t04**) and let the Worker rebuild. Then
re-open the URLs.

Do not submit with a Privacy Policy URL that 404s — it is an immediate
rejection, and it is the kind that costs you a whole review cycle for nothing.
