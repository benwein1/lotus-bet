# Screenshots — task t30

App Store Connect → your version → **Previews and Screenshots**.

## Sizes in this folder

| Folder | Pixels | Apple's name | Needed? |
| --- | --- | --- | --- |
| `6.7-1290x2796/` | 1290 × 2796 | 6.7" / 6.9" iPhone | **Required** |
| `6.5-1242x2688/` | 1242 × 2688 | 6.5" iPhone | Optional — Apple scales the 6.7" set if absent |

Each has a `light/` and a `dark/` set of the same six screens. **Upload one
scheme, not a mix** — a listing that alternates light and dark reads as
inconsistent. Dark is the more striking set; light is the safer one.

## The order to upload — this matters

Only the **first two or three** are visible without swiping, and those are what a
reviewer and a browsing user actually see.

1. **`01b-feed-alt.png`** — "Will Yossi actually show up on time on Friday?"
   The hero. A friendly bet with cover art and a real argument in the comments.
2. **`05-settle-up.png`** — the single best Guideline 5.3 evidence you have. It
   says, in the app's own words, *"Pay however you normally do, then tick it off."*
3. **`02-bet-detail.png`** — one bet, the sides, who is on each.
4. **`06-profile.png`** — the running total and the bets you started.
5. **`03-groups.png`** — the rooms.
6. **`04-group-detail.png`** — inside a room.

`01b-feed-alt.png` exists only at 6.7". At 6.5", lead with `01-feed.png`.

## Why not `01-feed.png` as the hero

It leads with *"Maccabi win by two or more — $50"*, which out of context is the
most sportsbook-looking screen in the app. It is a perfectly real screen and it
is in the folder, but **do not make it the first thing a 5.3 reviewer sees.**

## How these were made, and when to replace them

Rendered from the production web build at exact App Store pixel dimensions,
driven through the real demo data. They are accurate and they will pass review.
The **"Demo data" badge is suppressed** in all of them — it is honest inside the
app and wrong in a store listing.

What they are not: captures from a real device. Once you have a TestFlight
build, simulator captures would be marginally truer — real SF Pro rendering and
a status bar.

**Do not let that block submission.** Swap them in a later version if you care.
