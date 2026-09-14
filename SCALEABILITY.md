# SCALEABILITY.md — Lotus Bet

What actually breaks first, with numbers, based on this schema and these
providers — not on generic advice about Postgres.

Reviewed at `dc94dd6` plus this branch. Last updated 2026-09-14.

---

## 0. The short answer

**You will hit three walls, in this order, and none of them is the database:**

1. **Realtime concurrent connections — 200 on the Free plan.** Every open
   screen holds a channel. This is the first hard ceiling and it arrives at
   roughly **120–200 simultaneously-active users**, which is a much smaller
   number of *registered* users.
2. **File storage — 1 GB on Free.** Roughly **3,000–5,000 photos** at the
   quality this app compresses to. A media-heavy group of ten can eat a
   meaningful fraction of that in a month.
3. **Egress — 5 GB/month on Free.** Media downloads dominate; a feed full of
   photos costs a few MB per scroll.

The Postgres row count is a non-issue for a very long time. 500 MB holds on the
order of **a million bets with their positions and options**. You will have
moved to Pro for connections and storage long before rows matter.

**The single cheapest thing you can do for scale is narrow the Realtime
subscriptions** (§6). It is also the one that is currently most wrong.

### A note on these numbers

Realtime limits are quoted from Supabase's own docs (mirrored on GitHub, since
`supabase.com` is unreachable from this environment). Plan quotas and overage
rates are corroborated across several secondary sources but I could not load
`supabase.com/pricing` directly — **verify the pricing table before you budget
against it.** Everything about *this repository* — the schema, the queries, the
subscriptions — I read directly.

---

## 1. The architecture being scaled

Seven base tables plus six added by later migrations:

```
users            groups            group_members     group_invites
bets             bet_options       bet_positions     bet_invitees
bet_media        bet_likes         bet_comments
bet_ledger_entries                 settlement_confirmations
```

Read patterns that matter:

| Query | Shape | Called from |
| --- | --- | --- |
| `fetchFeedBets` | every open/locked bet across every group you are in, `limit 100`, with options, positions, media, likes and a comment count embedded | the feed, on focus **and on every Realtime event** |
| `fetchBet` | one bet + options + positions + media + likes + comment count + **group members + ledger** | bet screen (one round trip as of this branch) |
| `fetchGroupBets` | every bet in one group, same embeds, **no limit** | group screen |
| `group_balances(group_id)` | aggregate over that group's whole ledger + settlements | group + settle-up |
| `my_group_balances()` | the same, for every group you are in, at once | Profile ledger |

The two expensive ones are `fetchFeedBets` (wide embed, fired often) and
`my_group_balances()` (unbounded aggregate).

---

## 2. Users

| Limit | Free | Pro ($25/mo) |
| --- | --- | --- |
| Monthly active users (Auth) | 50,000 | 100,000, then ~$0.00325/user |
| Active projects | 2 | — |
| Project pausing | **after 1 week idle** | never |

**MAU is not your constraint.** 50,000 is far beyond where the other limits
bite. Do not let the headline number mislead you: an app that supports 50,000
MAU on paper will fall over at a few hundred concurrent ones because of
Realtime.

**Project pausing is a real risk before launch.** A Free project with no traffic
for seven days is paused, and the first person to open the app gets errors until
it wakes. If you are doing slow private beta, this will bite you. It alone
justifies Pro at launch.

### Auth rate limits

Supabase Auth applies per-IP token buckets — most cap around **30 requests** —
across sign-up, sign-in, verify, token refresh, OTP and password recovery, plus
a separate cap on outbound email.

**The email cap is the one that will hurt you.** The built-in shared SMTP sender
is heavily rate-limited and in practice only delivers to the project owner. You
cannot raise it; it is a shared server. **Custom SMTP is not a scale
optimisation, it is a launch requirement** — see `RESET_PASSWORD_SUPABASE.md`.
With custom SMTP configured, the per-hour email limit becomes yours to set.

---

## 3. Bets and rows

### Storage per bet

Rough per-row costs including index overhead:

| Row | Bytes (approx) |
| --- | --- |
| `bets` | ~400 (two labels, a title, a description) |
| `bet_options` × 2–8 | ~100 each |
| `bet_positions` × participants | ~120 each |
| `bet_ledger_entries` × participants (resolved only) | ~130 each |
| `bet_comments` | ~200 each |
| `bet_likes` | ~90 each |

A typical resolved 5-person bet with 2 options, 4 comments and 6 likes lands
around **2.5 KB all-in**.

**500 MB / 2.5 KB ≈ 200,000 bets** — and that is the naive figure. Allowing
generously for bloat, WAL and the fact that Postgres does not pack that tightly,
call it **100,000+ bets comfortably, and low hundreds of thousands before you
are worried**. At a friend-group cadence of a few bets per group per week, that
is years.

**Rows are not your problem.** Do not optimise here.

### Which tables grow fastest

In order, for a healthy app:

1. **`bet_likes`** — one row per person per bet, and liking is frictionless.
2. **`bet_comments`** — unbounded per bet; the only table with no natural cap.
3. **`bet_positions`** — bounded by participants per bet.
4. **`bet_ledger_entries`** — one per participant per *resolved* bet.
5. **`bet_media`** — few rows, but each points at an object that is the real cost.

### Indexes

Present and correct for the current queries:

```
bets (group_id, created_at desc)     -- the group screen's exact access path
bets (status)                        -- the feed's status filter
bet_positions (user_id)
bet_options (bet_id, position)
bet_likes (bet_id)
bet_comments (bet_id, created_at)
bet_media (bet_id, position) and (bet_id, purpose, created_at)
bet_ledger_entries (group_id, user_id)
group_members (user_id)
```

**The gap: there is no index on `bet_positions (bet_id)`.** Every embed of
`positions:bet_positions(...)` — which is every bet read in the app — filters by
`bet_id`, and only `user_id` is indexed. Postgres will sequential-scan
`bet_positions` for these. It is invisible at a few thousand rows and will not
stay that way.

```sql
create index if not exists bet_positions_bet_id_idx on public.bet_positions (bet_id);
```

**That one line is the highest-value database change in this document.** Add it
when you next touch migrations.

Also worth adding eventually: `bet_likes (bet_id, user_id)` as a covering index,
since the feed reads exactly that pair.

### Which query degrades first

**`fetchGroupBets` has no `limit`.** The feed caps at 100; the group screen does
not. A group two years old with 800 bets will fetch all 800 with every embed,
every time that screen opens. This is the first query that will feel slow, and
the fix is pagination, not an index.

`my_group_balances()` is second: it aggregates the full ledger of every group
you belong to, with no time bound. Someone in fifteen groups with years of
history will notice.

---

## 4. Photos and video — the real constraint

| Limit | Free | Pro |
| --- | --- | --- |
| File storage | **1 GB** | 100 GB, then ~$0.0213/GB |
| Storage egress | **5 GB/mo** | 250 GB/mo, then ~$0.09/GB |
| Cached egress | 5 GB/mo | 250 GB/mo, then ~$0.03/GB |
| Max single file | 50 MB | 50 MB (configurable higher on paid) |

### How big is one photo here

`media.ts` compresses through `expo-image-picker`:

- **Attachments**: `quality: 0.85`, video `High`, max 60s
- **Proof**: `quality: 0.6`, video `Medium`, max 30s

A modern phone photo re-encoded at 0.85 JPEG lands around **1.5–3 MB**; at 0.6,
around **0.6–1.2 MB**. Call it **2 MB average for attachments, 0.9 MB for
proof**.

### So how many photos fit

| At | 1 GB (Free) holds | 100 GB (Pro) holds |
| --- | --- | --- |
| 0.9 MB (proof) | ~1,160 | ~116,000 |
| 2 MB (attachment) | **~520** | ~52,000 |
| 3 MB (large attachment) | ~350 | ~35,000 |

**Realistic mixed figure on Free: 600–1,000 photos total, across the whole
product.** Not per user — total.

That is the number that should worry you. It is four bets a day with a photo
each, for eight months, by *everyone combined*. **A hundred active users would
exhaust the Free bucket in weeks.**

Video is worse by an order of magnitude: a 30-second clip at Medium is
comfortably **15–30 MB**, so **thirty to sixty videos fill the entire Free
bucket**. Video is the single most expensive thing this app allows.

### Theoretical vs realistic capacity

- **Theoretical**: 1 GB ÷ average file size, as above.
- **Realistic**: substantially less, because storage is monotonic. Nothing in
  this app ever deletes media. A cancelled bet keeps its photos. A bet resolved
  two years ago keeps its proof. **There is no deletion or archival path at
  all**, and CLAUDE.md §7 already notes that a failed `createBet` can leave
  orphaned objects in the bucket with no row pointing at them — those are
  invisible and unreclaimable without a sweep job.

Budget **60–70% of nominal capacity** in practice.

### Egress

5 GB/month at 2 MB per image is **~2,500 image loads per month**, shared across
everyone. The feed shows one card per screenful and only the active card plays
video, which helps a lot. But signed URLs mean **the CDN cache is per-URL**, and
this branch's 45-minute signing cache makes that materially better than before —
previously every feed refresh minted new URLs, which meant every refresh was a
cache miss and a fresh download of the same bytes. That change is worth real
egress.

### What to do about it, in order

1. **Cap video, or drop it.** It is 90% of the storage risk for a small
   fraction of the value. Shortening proof video to 15s would roughly halve the
   worst case.
2. **Use Supabase image transformations** to serve a feed-sized rendition rather
   than the original. Serving a 400 KB rendition instead of a 2 MB original cuts
   egress ~5×. This is a Pro feature and is the best egress-per-shekel available.
3. **Keep the signing cache** added on this branch.
4. **Build a retention policy** before you need one: delete media for bets
   cancelled more than 30 days ago, and archive attachments on bets resolved
   more than a year ago. Needs a product decision — proof of outcome is evidence
   somebody may want to keep.
5. **Build an orphan sweep** for the `createBet` failure mode.
6. **Per-user storage quota** (see SECURITY.md finding #2) — this is a security
   control and a cost control at the same time.

---

## 5. Database

Beyond §3: the things that are about *shape* rather than size.

**RLS cost.** Every policy on a bet-adjacent table calls `can_see_bet(bet_id)`
or `is_group_member(group_id)`, and these are `SECURITY DEFINER` functions doing
their own subqueries. Postgres calls them **per row**. Reading 100 feed bets
with their positions, options, likes and media means the helpers run thousands
of times per request. They are correct and they are the right design — but they
are not free, and they are the reason feed latency will grow super-linearly with
group count rather than linearly.

Mitigation when it bites: mark the helpers `stable` (they already should be, so
Postgres can cache within a statement) and consider a `security definer`
function that returns the caller's group ids once, cached per statement.

**Connection pooling.** PostgREST pools for you. Direct connections are only a
concern if you add a server component. Not an issue today.

**The aggregates.** `group_balances` and `my_stats` return `bigint`, which
PostgREST may hand back as a string — every read site already wraps in
`Number(...)`, and any new consumer must too.

---

## 6. Realtime — the first wall you hit

### The limits

| | Free | Pro | Pro (no spend cap) / Team |
| --- | --- | --- | --- |
| Concurrent peak connections | **200** | 500 | 10,000 |
| Messages per second | 100 | 500 | 2,500 |
| Channel joins per second | 100 | 500 | 2,500 |
| Max channels per connection | 100 | 100 | 100 |
| `postgres_changes` payload | 1,024 KB | 1,024 KB | 1,024 KB |

Overage is about **$10 per 1,000 peak connections**.

### What this app currently does

From `use-group-realtime.ts`:

```ts
// useFeedRealtime — the Home tab
.on('postgres_changes', { event: '*', schema: 'public', table: 'bets' }, handle)
.on('postgres_changes', { event: '*', schema: 'public', table: 'bet_positions' }, handle)
```

**Both are unfiltered.** There is no `filter:` clause. `useGroupRealtime` filters
`bets`, `bet_ledger_entries` and `settlement_confirmations` by `group_id`, but
`bet_positions` is unfiltered there too, because that table has no `group_id`
column to filter on.

### Why that does not scale

Three separate problems, compounding:

1. **Every user's feed channel wakes on every position change in the entire
   product.** RLS decides what they can *read*, but the change event is
   evaluated against every subscriber. With 500 users and someone picking a side
   every few seconds, that is a broadcast storm.
2. **Every wake triggers a full `fetchFeedBets`** — 100 bets, every embed. So a
   cheap write by one user causes an expensive read by everyone.
3. **Channels are per mounted screen**, with a `useId()` suffix. Open the feed,
   a group and a bet and you hold three channels on one connection. The tab
   screens stay mounted, so the feed's channel never closes.

At **200 concurrent connections on Free**, and one connection per active app
instance, the ceiling is roughly **200 people with the app open at once**. The
message ceiling (100/s) may bite sooner during a busy evening.

### The mitigation, in stages

**Stage 1 — stop the stampede (do this first, it is cheap).** This branch
already added request coalescing to `useAsync`, so a burst of Realtime events
collapses into at most two fetches instead of N. That is most of problem 2
solved for a one-line-per-screen change. Next, debounce the handler itself by
~500ms.

**Stage 2 — add `group_id` to `bet_positions`.** It is denormalisation, and it
is the correct trade: it makes the subscription filterable, which is the only
way to stop the fan-out. Backfill from `bets`, maintain with a trigger, then:

```ts
.on('postgres_changes',
    { event: '*', schema: 'public', table: 'bet_positions', filter: `group_id=in.(${ids})` },
    handle)
```

**Stage 3 — stop refetching, start patching.** The feed already patches likes
locally as of this branch instead of refetching. Extend that to positions: the
Realtime payload contains the changed row, so the card can be updated from it
without a round trip.

**Stage 4 — move off `postgres_changes` to Broadcast.** `postgres_changes`
re-checks RLS per subscriber per change and is the expensive primitive.
Broadcast from a trigger into a per-group topic scales considerably better. This
is an architectural change and is not warranted below a few thousand users.

---

## 7. Push notifications

**Expo's push service accepts 600 notifications per second per project.** Well
beyond anything this app will generate — a new bet notifies one group.

The real limit is architectural, and CLAUDE.md §7 already names it:
**`users.expo_push_token` is a single column**, so a second device silently
overwrites the first. Sign in on an iPad and your iPhone stops receiving
notifications, with no error anywhere.

That is a **correctness** bug that presents as a scale bug: it does not degrade
gradually, it just quietly halves your notification reach as soon as people own
two devices. Fix with a `user_devices` table (`user_id`, `token`, `platform`,
`last_seen_at`, unique on token) and have `push_targets_for_*` return the set.
Do it when multi-device matters — but know that it is already wrong, not
merely unscalable.

Also relevant: the `notify` Edge Function counts against **500,000 invocations
per month** on Free. Not a concern.

---

## 8. Provider-side limits and application-level rate limiting

See SECURITY.md §7 for the full treatment; the scale-relevant summary:

- Supabase rate-limits **auth** endpoints per IP out of the box.
- Supabase does **not** rate-limit ordinary PostgREST reads and writes.
- So a single authenticated client can create bets, comments, likes and uploads
  as fast as the network allows, and each one costs you rows, storage and a
  Realtime broadcast.

The cheapest effective control is a `SECURITY DEFINER` trigger counting recent
rows per user, because it cannot be bypassed by a modified client. Bucket
`file_size_limit` and `allowed_mime_types` are a dashboard change and remove the
most expensive vector.

---

## 9. Scaling plan by stage

### 0–100 users — **stay on Free, change almost nothing**

- **Works as-is**: everything. Rows, connections and storage are all far inside
  the limits.
- **Do now anyway**: the `bet_positions (bet_id)` index; bucket size/MIME limits;
  custom SMTP (a launch requirement, not a scale one).
- **Watch**: storage. 1 GB is genuinely small and media is the one thing that
  can surprise you at this stage.
- **First bottleneck**: file storage, if anyone uploads video.
- **Move to Pro when**: you want the project to stop pausing — i.e. at launch.

### 100–1,000 users — **Pro, $25/mo**

- **Change**: Realtime stage 1 and 2 (debounce, then `group_id` on
  `bet_positions`). Paginate `fetchGroupBets`. Add the rate-limit triggers.
- **Watch**: peak Realtime connections against the 500 ceiling; storage growth
  rate; egress.
- **First bottleneck**: **Realtime connections**, around 400–500 concurrent.
- Storage at 100 GB is comfortable here; egress at 250 GB is the one to model.

### 1,000–10,000 users — **Pro without the spend cap**

- **Change**: Realtime stage 3 (patch from payloads). Image transformations for
  feed renditions — at this scale egress is your largest variable cost. Media
  retention policy. `user_devices` table.
- **Watch**: egress in shekels; the RLS helper cost on feed latency; `p95` on
  `fetchFeedBets`.
- **First bottleneck**: **egress cost**, then feed query latency.

### 10,000–100,000 users — **Team, and real engineering**

- **Change**: Realtime stage 4 (Broadcast from triggers). Materialise group
  balances rather than aggregating live. Read replicas. Move media to a CDN with
  proper cache headers and long-lived signed URLs or a signing edge worker.
- **Watch**: database CPU, replication lag, storage bill.
- **First bottleneck**: `postgres_changes` fan-out, and the unbounded
  aggregates.

### 100,000+ — **a different document**

Partition `bet_positions`, `bet_likes` and `bet_comments` by time or group.
Dedicated Realtime infrastructure. At this point the interesting constraint is
organisational, not technical.

---

## 10. "Scale only when needed" — the prioritised list

Ordered by **value ÷ effort**, not by severity.

| # | Do it | When | Effort |
| --- | --- | --- | --- |
| 1 | `bet_positions (bet_id)` index | **now** | one line |
| 2 | Bucket `file_size_limit` + `allowed_mime_types` | **now** | dashboard |
| 3 | Custom SMTP | **before launch** | 30 min |
| 4 | Pro plan (stop project pausing) | **at launch** | $25 |
| 5 | Debounce the Realtime handler | ~100 users | one hook |
| 6 | `limit` + pagination on `fetchGroupBets` | ~100 users / old groups | small |
| 7 | Rate-limit triggers on comments/bets/media | ~200 users | half a day |
| 8 | `group_id` on `bet_positions` + filtered subscriptions | ~500 users | migration + trigger |
| 9 | Patch from Realtime payloads instead of refetching | ~1,000 users | medium |
| 10 | Image transformations for feed renditions | when egress costs money | small, Pro only |
| 11 | Media retention + orphan sweep | when storage costs money | needs a product call |
| 12 | `user_devices` table | when anyone reports missing notifications | small |
| 13 | Broadcast instead of `postgres_changes` | ~5,000 users | large |
| 14 | Materialised balances, read replicas, partitioning | ~50,000 users | large |

**Items 1–4 are worth doing this month. Items 13–14 are worth actively
resisting until the numbers force them** — the current architecture is
appropriate for its stage, and the biggest scaling risk to an MVP is spending
the runway on capacity nobody is using yet.

---

## Sources

Realtime limits are from Supabase's own documentation, read via the GitHub
mirror of `apps/docs/content/guides/realtime/limits.mdx` (`supabase.com` is
blocked from this environment). Expo's 600/second figure is from Expo's push
notification documentation. Plan quotas and overage rates are corroborated
across multiple secondary sources but were **not** read from
`supabase.com/pricing` directly — confirm them before budgeting.

- [Realtime Limits | Supabase Docs](https://supabase.com/docs/guides/realtime/limits)
- [Rate limits | Supabase Docs](https://supabase.com/docs/guides/auth/rate-limits)
- [Push notifications FAQ | Expo](https://docs.expo.dev/push-notifications/faq/)
- [Pricing & Fees | Supabase](https://supabase.com/pricing)
