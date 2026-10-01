/**
 * Every Supabase read/write the app makes, in one place.
 *
 * Screens call these; they never build queries inline. Keeping them together
 * makes the RLS surface easy to audit — if a table is not touched here, the
 * client never reads it.
 */

/**
 * It is a directory now rather than one file, and the rule is unchanged:
 * **screens import from `@/lib/queries` and never build a query inline.** The
 * modules below are how that file stopped being 1,470 lines — one per part of
 * the product, so a change to commenting does not sit three hundred lines
 * from a change to settlement, and two people touching different features do
 * not touch the same file.
 *
 * Everything is re-exported here, so every existing `@/lib/queries` import
 * keeps resolving and no call site had to move.
 */
export * from './core';
export * from './account';
export * from './groups';
export * from './bets';
export * from './settlement';
export * from './challenges';
export * from './social';
export * from './profile';
