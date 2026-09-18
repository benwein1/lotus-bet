import { CATALOGUE, suggestBets, suggestionSeed } from '@/lib/suggestions';

/**
 * Guideline 1.4.5 — an app must not urge users into activities that risk
 * physical harm.
 *
 * `suggestions.ts` is the only feature in Lotus Bet that *proposes* content
 * rather than rendering what somebody wrote, so it is the only place the app
 * could put a dare in a user's mouth. APP_STORE.md asks for a read-through;
 * this is that read-through turned into a check, because a one-off audit does
 * not survive the next person adding a suggestion.
 *
 * The rule it enforces: **a suggestion predicts something that was going to
 * happen anyway, and never asks anybody to do anything.**
 */

/**
 * Words that only appear when somebody is being asked to *perform*.
 *
 * Kept narrow on purpose. This is not a profanity filter — it is looking for
 * the grammar of a dare, and a list padded with vaguely risky nouns would fire
 * on "Does it rain before the weekend?" and teach the next person to ignore it.
 */
const DARE_VOCABULARY = [
  /\bdare\b/i,
  /\bchallenge (?:someone|them|him|her|you)\b/i,
  /\bwho can\b/i,
  /\bfirst to (?:finish|drink|eat|reach|touch|jump|climb|run)\b/i,
  /\blast one to\b/i,
  /\bhow (?:many|long) can (?:you|they|he|she)\b/i,
  /\b(?:down|chug|neck|skull) (?:a|the|your)\b/i,
  /\bshots?\b/i,
  /\bfight\b/i,
  /\bpunch|slap|hit\b/i,
  /\bjump (?:off|from|into)\b/i,
  /\bclimb\b/i,
  /\bhold (?:your|their) breath\b/i,
  /\bstay awake\b/i,
  /\bwithout (?:eating|sleeping|breathing|stopping)\b/i,
];

const everyString = CATALOGUE.flatMap((s) => [s.title, s.labelA, s.labelB]);

describe('Guideline 1.4.5 — no suggestion is a dare', () => {
  it('has a catalogue to check', () => {
    // Guards against the whole suite passing vacuously if the export moves.
    expect(CATALOGUE.length).toBeGreaterThan(5);
  });

  it.each(everyString)('%p uses no dare vocabulary', (text) => {
    for (const pattern of DARE_VOCABULARY) {
      expect(text).not.toMatch(pattern);
    }
  });

  // The structural rule, and the one that actually generalises: a prediction
  // is a question. An instruction is not.
  it.each(CATALOGUE.map((s) => s.title))('%p is a question, not an instruction', (title) => {
    expect(title.trim().endsWith('?')).toBe(true);
  });

  // Narrowly an imperative, not "does not start with a question word". An
  // earlier version of this test required a leading auxiliary and failed on
  // "Clean sheet this weekend?" — an elliptical question where `clean` only
  // looks like a verb. A rule that fires on a legitimate suggestion is worse
  // than no rule, because the next person deletes it rather than reads it.
  const IMPERATIVE_OPENERS =
    /^(drink|down|neck|chug|eat|finish|run|jump|climb|touch|hold|punch|slap|hit|fight|text|call|post|send|dare|race|swim|drive|smoke|snort)\b/i;

  it.each(CATALOGUE.map((s) => s.title))('%p is not an instruction to the user', (title) => {
    expect(title.trim()).not.toMatch(IMPERATIVE_OPENERS);
  });
});

describe('suggestBets', () => {
  it('never repeats an idea within one draw', () => {
    const picked = suggestBets(6, 12345);
    expect(new Set(picked.map((s) => s.id)).size).toBe(picked.length);
  });

  it('is deterministic for a seed, so a screen does not reshuffle on re-render', () => {
    expect(suggestBets(4, 99).map((s) => s.id)).toEqual(suggestBets(4, 99).map((s) => s.id));
  });

  it('never returns more than it has', () => {
    expect(suggestBets(CATALOGUE.length + 10, 7)).toHaveLength(CATALOGUE.length);
  });

  it('asks for none and gets none', () => {
    expect(suggestBets(0, 7)).toHaveLength(0);
  });

  it('survives a negative or absurd seed', () => {
    expect(suggestBets(3, -1).length).toBe(3);
    expect(suggestBets(3, Number.MAX_SAFE_INTEGER).length).toBe(3);
  });

  it('suggestionSeed produces something usable', () => {
    expect(Number.isFinite(suggestionSeed())).toBe(true);
  });
});
