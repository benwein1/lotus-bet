# Password reset — what you have to do in Supabase

The code is done and on `claude/proof-media-and-ui-fixes`. These four steps are
the part only you can do. Nothing here is a migration.

---

## 1. Allow the reset URLs

**Dashboard → Authentication → URL Configuration → Redirect URLs → Add URL**

Add all three:

```
https://lotus-bet.weinsteinben2.workers.dev/reset-password
http://localhost:8081/reset-password
lotusbet://reset-password
```

Without these Supabase ignores where the app asks to send people and drops them
on the Site URL instead — they land signed in on the feed with no way to set a
password. This is the step that most often gets missed.

While you are on that screen, check **Site URL** is
`https://lotus-bet.weinsteinben2.workers.dev` and not `http://localhost:3000`.

## 2. Turn on your own SMTP

**Dashboard → Project Settings → Authentication → SMTP Settings → Enable**

Supabase's built-in sender only delivers to you, the project owner, and is
capped at a few emails an hour. Until this is on, nobody else can reset a
password no matter what the app does.

Any provider works. Resend, Brevo and Mailgun all have a free tier. You need
the host, port, username, password, and a sender address on a domain you own.

## 3. Set the web origin

In your `.env`:

```
EXPO_PUBLIC_WEB_ORIGIN=https://lotus-bet.weinsteinben2.workers.dev
```

On a phone there is no address bar to read, so without this the app builds
`lotusbet://` links, which only work if the app is already installed.

Set the same variable in **Cloudflare → Workers → lotus-bet → Settings →
Variables** so the deployed build has it too.

## 4. Check it

1. Sign-in screen → **Forgot password** → your email
2. Open the link from the inbox
3. You should land on **"Pick a new password"**

If you get **"That link has expired"** on a fresh link, step 1 is wrong — the
URL you are being sent to is not on the allowlist.

If no email arrives, step 2 is wrong. Confirm under **Authentication → Logs**.

---

## Not needed

- No migration.
- No changes to the email template — the default recovery template is fine.
- Nothing in the app's code. That part is finished.
