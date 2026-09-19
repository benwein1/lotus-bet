/**
 * The filter on what people type.
 *
 * App Store Review Guideline 1.2 asks apps with user-generated content for "a
 * method for filtering objectionable material from being posted". This is that
 * method, and it is worth being clear about what it can and cannot be.
 *
 * It **cannot** be a judge of whether a sentence is abusive. Word lists do not
 * understand context, every one of them has a famous false positive, and a
 * filter that refuses "Scunthorpe" teaches people the app is broken rather
 * than that the rule exists. Reporting and blocking are what actually handle
 * abuse here; they involve a human, which is the only thing that works.
 *
 * What it **is** is a floor: the handful of slurs nobody types by accident,
 * plus the structural abuse that has nothing to do with meaning — a wall of
 * one character, a name made of invisible codepoints, a comment that is
 * entirely a URL. Those are objective, and catching them at the point of
 * typing is worth more than catching them afterwards.
 *
 * Pure and dependency-free so it can be tested directly, and so the same rules
 * apply identically to a comment, a bet title, a group name and a display
 * name. Same split as `media-rules.ts` and `reminder-rules.ts`.
 */

/**
 * Slurs, as word-boundary patterns.
 *
 * Deliberately short. This list exists to catch what is unambiguous; anything
 * requiring judgement goes to the report queue instead, where a person reads
 * it. Padding it out with insults would make the app refuse ordinary
 * trash talk between friends, which is most of what it is for.
 *
 * Written as fragments joined at word boundaries so leetspeak substitutions do
 * not walk straight past — `[il1|]` for i, `[ae@]` for a, and so on.
 */
const SLUR_PATTERNS: RegExp[] = [
  /n[il1|]gg(?:er|a)/i,
  /f[ae@4]gg?[oe0]t/i,
  /k[il1|]ke\b/i,
  /sp[il1|]c\b/i,
  /ch[il1|]nk\b/i,
  /tr[ae@4]nn(?:y|ie)/i,
  /r[ae@4]t?[il1|]?ard\b/i,
  /c[uv]nt/i,
];

/** Zero-width and bidirectional-override characters. */
const INVISIBLE = /[​-‏‪-‮⁠-⁯﻿]/g;

/** Combining marks, which stack into "zalgo" text that overflows its line. */
const COMBINING = /[̀-ͯ҃-҉⃐-⃰]/g;

export type ContentRejection =
  | 'slur'
  | 'shouting'
  | 'repetition'
  | 'link-only'
  | 'empty';

export interface ContentCheck {
  ok: boolean;
  reason?: ContentRejection;
  /** What to show the person. Explains the rule, never scolds. */
  message?: string;
}

const OK: ContentCheck = { ok: true };

/**
 * Strips the characters that exist to defeat a filter or to break a layout.
 *
 * Applied before *storing* text, not only before checking it — a display name
 * made of combining marks renders over its neighbours in every list it appears
 * in, and normalising at the boundary is the only place that fixes all of them
 * at once.
 *
 * NFKC folds the compatibility forms (ﬁ, ①, fullwidth Latin) that let the same
 * word be written a dozen ways, which is also what stops the slur patterns
 * below being trivially bypassed.
 */
export function normaliseText(input: string): string {
  return input
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(COMBINING, '')
    // Any run of whitespace, newlines included, becomes one space. A comment
    // is not a place to lay out a poster.
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Whether this text may be posted.
 *
 * `strict` is for the fields that are *identity* rather than speech — a display
 * name, a group name — where the same text sits on every screen that mentions
 * the person, and the repetition and shouting rules apply at a lower threshold.
 */
export function checkContent(
  raw: string,
  options: { strict?: boolean } = {}
): ContentCheck {
  const text = normaliseText(raw);
  if (!text) {
    return { ok: false, reason: 'empty', message: 'Write something first.' };
  }

  for (const pattern of SLUR_PATTERNS) {
    if (pattern.test(text)) {
      return {
        ok: false,
        reason: 'slur',
        message: 'That word is not allowed here. Say it another way.',
      };
    }
  }

  const letters = text.replace(/[^A-Za-z֐-׿]/g, '');

  // Shouting: mostly capitals, and long enough that it is a choice rather than
  // an acronym. "OMG" and "LFG" stay legal; a paragraph in caps does not.
  // 10 in strict mode rather than something tighter: "THE LADS" is a real
  // group name and refusing it would teach people the app is broken. A dozen
  // letters of unbroken capitals is a different thing.
  const shoutFloor = options.strict ? 10 : 20;
  if (letters.length >= shoutFloor) {
    const upper = letters.replace(/[^A-Z]/g, '').length;
    if (upper / letters.length > 0.8) {
      return {
        ok: false,
        reason: 'shouting',
        message: 'Try that without the caps lock.',
      };
    }
  }

  // The same character over and over — "aaaaaaaaaa", "!!!!!!!!!!". Six in a row
  // is past anything anyone types for emphasis.
  const runLimit = options.strict ? 4 : 6;
  const run = new RegExp(`(.)\\1{${runLimit},}`);
  if (run.test(text)) {
    return {
      ok: false,
      reason: 'repetition',
      message: 'That looks like a keyboard held down. Try again.',
    };
  }

  // A comment that is nothing but a link is the shape spam arrives in. A link
  // *inside* a sentence is fine, and is how somebody shares the thing they are
  // betting about.
  if (!options.strict && /^(?:https?:\/\/|www\.)\S+$/i.test(text)) {
    return {
      ok: false,
      reason: 'link-only',
      message: 'Add a few words about what you are linking to.',
    };
  }

  return OK;
}

/**
 * Check and normalise in one step, for a caller that is about to write.
 *
 * Returns the text to store, so nobody stores the raw string by accident after
 * validating the cleaned one — which would let every invisible character
 * straight through the check it just passed.
 */
export function prepareContent(
  raw: string,
  options: { strict?: boolean } = {}
): { ok: true; text: string } | { ok: false; message: string } {
  const check = checkContent(raw, options);
  if (!check.ok) return { ok: false, message: check.message ?? 'That cannot be posted.' };
  return { ok: true, text: normaliseText(raw) };
}
