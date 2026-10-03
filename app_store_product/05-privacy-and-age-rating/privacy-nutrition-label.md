# App Privacy questionnaire — task t32

App Store Connect → **App Privacy**. It is a click-through wizard, not a table.
Answer it once and it stays answered across versions.

## First question

**Does this app collect data? → Yes.**

## Then, per data type

| Screen | Answer |
| --- | --- |
| Contact Info → Email Address | **Collect.** Linked to identity. App Functionality. Tracking: **No** |
| Contact Info → Name | **Collect.** Linked. App Functionality. Tracking: No |
| Contact Info → Phone Number | **Collect.** Linked. App Functionality. Tracking: No — *legacy accounts only; nothing collects one now, but rows still carry them, so declaring it is the honest answer* |
| User Content → Photos or Videos | **Collect.** Linked. App Functionality. Tracking: No |
| User Content → Other User Content | **Collect.** Linked. App Functionality. Tracking: No — *bet titles, descriptions, option labels, comments* |
| User Content → Customer Support | **Do not collect** — *support is plain email, outside the app* |
| Identifiers → User ID | **Collect.** Linked. App Functionality. Tracking: No |
| Identifiers → Device ID | **Collect.** Linked. App Functionality. Tracking: No — *the Expo push token, and only when notifications are on* |
| Usage Data · Diagnostics · Location · Financial Info · Health · Contacts · Search History · Browsing History · Sensitive Info · Purchases | **Do not collect** |

## Tracking: none

There is no analytics SDK, no ad SDK and no third-party tracker anywhere in
`package.json`.

- Declare **"Data Not Used to Track You."**
- **Do not add an ATT prompt.** Guideline 5.1.2(i) requires it only if you
  track; showing it without tracking is itself a problem.
- If you ever add analytics, redo this whole page before shipping it.

## Financial Info is "do not collect", and that is the whole point

The app records an amount; it never sees a payment instrument, a balance or a
transaction. **If a future change makes that answer anything else, the app has
become something Apple will review very differently.**
