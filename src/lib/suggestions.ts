/**
 * Bet ideas, for the two places the feed has nothing to show.
 *
 * The hardest part of posting a bet is not the form — it is thinking of one.
 * A blank feed with a "New bet" button asks the user to be funny on demand;
 * a blank feed with six specific, slightly pointed suggestions asks them to
 * pick. Every one of these is a real thing friends argue about, phrased as a
 * question with a yes/no answer, because the app only does two outcomes.
 *
 * These are prompts, not templates: tapping one opens the ordinary new-bet
 * form with the fields already filled, and everything stays editable. Nothing
 * here is stored or sent anywhere.
 */

export interface BetSuggestion {
  id: string;
  /** Goes straight into the title field. */
  title: string;
  labelA: string;
  labelB: string;
  /** In agorot, like every other amount in the app. */
  potAgorot: number;
  category: SuggestionCategory;
}

export type SuggestionCategory = 'football' | 'friends' | 'life' | 'silly';

export const CATEGORY_LABEL: Record<SuggestionCategory, string> = {
  football: 'Football',
  friends: 'Your friends',
  life: 'Real life',
  silly: 'Nonsense',
};

const CATALOGUE: BetSuggestion[] = [
  // --- The people you are in a group with -----------------------------------
  {
    id: 'late',
    title: 'Does everyone actually show up on time?',
    labelA: 'All on time',
    labelB: 'Someone is late',
    potAgorot: 3000,
    category: 'friends',
  },
  {
    id: 'plan-survives',
    title: 'Do we still do this on the day?',
    labelA: 'It happens',
    labelB: 'Cancelled',
    potAgorot: 5000,
    category: 'friends',
  },
  {
    id: 'first-to-leave',
    title: 'Is anyone leaving before midnight?',
    labelA: 'Someone bails',
    labelB: 'Everyone stays',
    potAgorot: 2000,
    category: 'friends',
  },
  {
    id: 'reply',
    title: 'Does anyone reply in the group chat within an hour?',
    labelA: 'Someone replies',
    labelB: 'Total silence',
    potAgorot: 1000,
    category: 'friends',
  },

  // --- Football -------------------------------------------------------------
  {
    id: 'match-winner',
    title: 'Do they win their next match?',
    labelA: 'Win',
    labelB: 'Anything else',
    potAgorot: 5000,
    category: 'football',
  },
  {
    id: 'clean-sheet',
    title: 'Clean sheet this weekend?',
    labelA: 'Clean sheet',
    labelB: 'They concede',
    potAgorot: 3000,
    category: 'football',
  },
  {
    id: 'over-two',
    title: 'More than two goals in the match?',
    labelA: 'Three or more',
    labelB: 'Two or fewer',
    potAgorot: 4000,
    category: 'football',
  },

  // --- Things that are actually going to happen -----------------------------
  {
    id: 'rain',
    title: 'Does it rain before the weekend?',
    labelA: 'It rains',
    labelB: 'Stays dry',
    potAgorot: 2000,
    category: 'life',
  },
  {
    id: 'finish-it',
    title: 'Do they finish it by the end of the month?',
    labelA: 'Finished',
    labelB: 'Still going',
    potAgorot: 8000,
    category: 'life',
  },
  {
    id: 'new-job',
    title: 'Do they take the job?',
    labelA: 'They take it',
    labelB: 'They turn it down',
    potAgorot: 10000,
    category: 'life',
  },
  {
    id: 'move-out',
    title: 'Is the flat sorted by the end of the month?',
    labelA: 'Sorted',
    labelB: 'Still looking',
    potAgorot: 6000,
    category: 'life',
  },

  // --- Low stakes, high entertainment ---------------------------------------
  {
    id: 'coffee',
    title: 'Do they order the same thing again?',
    labelA: 'Same as always',
    labelB: 'Something new',
    potAgorot: 1000,
    category: 'silly',
  },
  {
    id: 'gym',
    title: 'Do they actually go to the gym three times this week?',
    labelA: 'Three times',
    labelB: 'Fewer',
    potAgorot: 4000,
    category: 'silly',
  },
  {
    id: 'phone',
    title: 'Whose phone dies first tonight?',
    labelA: 'Mine',
    labelB: 'Someone else’s',
    potAgorot: 1000,
    category: 'silly',
  },
  {
    id: 'argument',
    title: 'Does this argument last more than ten minutes?',
    labelA: 'More than ten',
    labelB: 'They give up',
    potAgorot: 2000,
    category: 'silly',
  },
];

/**
 * A handful of ideas, different each time the feed is opened.
 *
 * Seeded rather than random so that a re-render — a refresh, a keyboard
 * appearing — does not reshuffle the cards under the user's finger. Pass
 * something that changes per visit rather than per render.
 */
export function suggestBets(count: number, seed: number): BetSuggestion[] {
  const pool = [...CATALOGUE];
  const picked: BetSuggestion[] = [];
  let cursor = Math.abs(Math.floor(seed));

  while (picked.length < Math.min(count, CATALOGUE.length) && pool.length > 0) {
    // A small linear step through a shrinking pool: cheap, deterministic, and
    // it cannot pick the same idea twice.
    cursor = (cursor * 1103515245 + 12345) >>> 0;
    const [taken] = pool.splice(cursor % pool.length, 1);
    if (taken) picked.push(taken);
  }

  return picked;
}

/** A stable-per-session seed. */
export function suggestionSeed(): number {
  return Math.floor(Date.now() / (1000 * 60 * 30));
}
