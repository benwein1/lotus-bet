import { checkContent, normaliseText, prepareContent } from '@/lib/content-rules';

/**
 * The thing worth asserting here is not "does it catch bad words" — any list
 * does that. It is the **false-positive** side: an app for trash talk between
 * friends that refuses ordinary trash talk is worse than one with no filter,
 * because people stop using it rather than learn the rule.
 *
 * So most of these tests are things that must stay legal.
 */

describe('normaliseText', () => {
  it('strips zero-width characters used to defeat a filter', () => {
    expect(normaliseText('he​llo')).toBe('hello');
  });

  // NFKC runs first, so the *first* mark composes into the base letter and
  // the rest are dropped. That ordering is deliberate — it is the same pass
  // that folds fullwidth Latin, which is how a slur gets spelled past a word
  // list — so one accent surviving is correct, and the zalgo stack is gone.
  it('collapses a zalgo stack to a single composed accent', () => {
    expect(normaliseText(`a${'\u0301'.repeat(10)}b`)).toBe('\u00E1b');
  });

  it('collapses any run of whitespace, newlines included', () => {
    expect(normaliseText('one\n\n\n   two')).toBe('one two');
  });

  it('folds compatibility forms so one word has one spelling', () => {
    // Fullwidth Latin — the usual way to write a word the filter knows.
    expect(normaliseText('ｈｅｌｌｏ')).toBe('hello');
  });

  it('leaves ordinary text alone', () => {
    expect(normaliseText('Yossi is never on time')).toBe('Yossi is never on time');
  });
});

describe('checkContent — what must stay legal', () => {
  const allowed = [
    'no chance mate',
    'OMG he actually showed up',
    'LFG!!!',
    'I said 3-1 and I meant 3-1',
    'אין סיכוי',
    'that is 100% happening',
    'look at this https://example.com/goal it was offside',
    'hahahaha',
    'nooo way',
    'A',
  ];

  it.each(allowed)('allows %p', (text) => {
    expect(checkContent(text).ok).toBe(true);
  });
});

describe('checkContent — what it refuses', () => {
  it('refuses empty and whitespace-only text', () => {
    expect(checkContent('   ').reason).toBe('empty');
    expect(checkContent('​​').reason).toBe('empty');
  });

  it('refuses a slur, and its leetspeak spelling', () => {
    expect(checkContent('you f4ggot').reason).toBe('slur');
    expect(checkContent('n1gger').reason).toBe('slur');
  });

  it('sees through invisible characters inserted mid-word', () => {
    expect(checkContent('c​unt').reason).toBe('slur');
  });

  it('refuses a paragraph in capitals but not a short shout', () => {
    expect(checkContent('OMG').ok).toBe(true);
    expect(
      checkContent('I CANNOT BELIEVE YOU ACTUALLY SAID THAT TO ME').reason
    ).toBe('shouting');
  });

  it('refuses a held-down key', () => {
    expect(checkContent('aaaaaaaaaaaaa').reason).toBe('repetition');
    expect(checkContent('!!!!!!!!!!!').reason).toBe('repetition');
    // Five is still emphasis.
    expect(checkContent('noooo').ok).toBe(true);
  });

  it('refuses a comment that is only a link', () => {
    expect(checkContent('https://spam.example.com/buy').reason).toBe('link-only');
    expect(checkContent('www.spam.example.com').reason).toBe('link-only');
  });

  it('gives every refusal a message that explains the rule', () => {
    for (const bad of ['   ', 'n1gger', 'AAAAAAAAAAAAAAAAAAAAAAAA', 'https://x.example']) {
      const result = checkContent(bad);
      expect(result.ok).toBe(false);
      expect(result.message).toBeTruthy();
      // No scolding, no exclamation marks.
      expect(result.message).not.toMatch(/!/);
    }
  });
});

describe('checkContent — strict mode, for names rather than speech', () => {
  it('is harder on shouting, because a name sits on every screen', () => {
    expect(checkContent('SUNDAY LEAGUE', { strict: true }).reason).toBe('shouting');
    expect(checkContent('SUNDAY LEAGUE').ok).toBe(true);
  });

  // The floor is deliberately not tighter than that: a short name in capitals
  // is a style, and refusing it would teach people the app is broken.
  it('still allows a short name in capitals', () => {
    expect(checkContent('THE LADS', { strict: true }).ok).toBe(true);
  });

  it('is harder on repetition', () => {
    expect(checkContent('Daaaaan', { strict: true }).reason).toBe('repetition');
    expect(checkContent('Daaaaan').ok).toBe(true);
  });

  it('still allows a normal name', () => {
    expect(checkContent('Sunday League Degenerates', { strict: true }).ok).toBe(true);
    expect(checkContent('Dana Peretz', { strict: true }).ok).toBe(true);
  });

  it('allows a link-shaped group name, since only comments have that rule', () => {
    expect(checkContent('https://example.com', { strict: true }).ok).toBe(true);
  });
});

describe('prepareContent', () => {
  it('hands back the cleaned text, not the raw string', () => {
    const result = prepareContent('  he​llo   there  ');
    expect(result).toEqual({ ok: true, text: 'hello there' });
  });

  // The whole reason this function exists: validating the cleaned string and
  // then storing the raw one would let every invisible character through the
  // check it just passed.
  it('never returns text that would fail its own check', () => {
    const result = prepareContent('ｈｅｌｌｏ​');
    expect(result.ok).toBe(true);
    if (result.ok) expect(checkContent(result.text).ok).toBe(true);
  });

  it('returns a message rather than throwing', () => {
    const result = prepareContent('');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe('Write something first.');
  });
});
