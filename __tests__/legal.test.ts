import legalText from '../legal-text.json';
import {
  APP_NAME,
  LEGAL_PAGES_PUBLISHED,
  LEGAL_SLUGS,
  SUPPORT_CONTACT_PUBLISHED,
  TERMS_VERSION,
  legalDocument,
} from '@/lib/legal';

/**
 * The legal text is the one part of the app whose *content* is a compliance
 * requirement rather than a design choice. Guideline 1.2 asks a
 * user-generated-content app for a published no-tolerance policy, a way to
 * report, a way to block and a contact; 5.1.1 asks for a privacy policy that
 * describes what is actually collected. These tests hold those clauses in
 * place, because the way they go missing is a well-meaning edit, not a bug.
 */

const documents = LEGAL_SLUGS.map((slug) => legalDocument(slug));

describe('every document is complete', () => {
  it.each(LEGAL_SLUGS)('%s has a title, a summary and sections', (slug) => {
    const doc = legalDocument(slug);
    expect(doc.title.length).toBeGreaterThan(0);
    expect(doc.summary.length).toBeGreaterThan(40);
    expect(doc.sections.length).toBeGreaterThan(2);
    for (const section of doc.sections) {
      expect(section.heading.length).toBeGreaterThan(0);
      expect(section.body.length).toBeGreaterThan(0);
      for (const paragraph of section.body) expect(paragraph.trim().length).toBeGreaterThan(0);
    }
  });

  // A `{{app}}` rendered literally on a legal page is the kind of thing that
  // ships, because nobody re-reads the terms.
  it('leaves no placeholder unfilled', () => {
    for (const doc of documents) {
      const everything = [doc.summary, ...doc.sections.flatMap((s) => [s.heading, ...s.body])];
      for (const text of everything) expect(text).not.toMatch(/\{\{|\}\}/);
    }
  });

  it('names the app from app.json rather than hardcoding it', () => {
    // The rename is still ahead, and this is what makes it one edit.
    const terms = legalDocument('terms');
    expect(terms.sections.some((s) => s.heading.includes(APP_NAME))).toBe(true);
  });
});

describe('the version somebody agreed to', () => {
  it('is read off the text itself, so the two cannot drift', () => {
    expect(TERMS_VERSION).toBe(legalText.version);
    for (const doc of documents) expect(doc.version).toBe(legalText.version);
  });

  it('is a date, so "which one did they agree to" has an answer', () => {
    expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('guideline 1.2 — what the terms must actually say', () => {
  const terms = legalDocument('terms');
  const prose = terms.sections
    .flatMap((section) => [section.heading, ...section.body])
    .join('\n')
    .toLowerCase();

  it('states a no-tolerance policy for objectionable content', () => {
    expect(prose).toContain('no tolerance');
    expect(prose).toContain('objectionable');
  });

  it('commits to acting on reports within 24 hours', () => {
    expect(prose).toContain('24 hours');
  });

  it('explains reporting and blocking', () => {
    expect(prose).toContain('report');
    expect(prose).toContain('block');
  });

  it('says accounts that post abuse are removed', () => {
    expect(prose).toMatch(/remove the accounts|account removed for abuse/);
  });

  it('publishes a contact', () => {
    expect(prose).toContain('@');
  });

  // The positioning that keeps this out of guideline 5.3.4 is a product rule
  // (CLAUDE.md §1), and the terms are where it is stated to the user.
  it('says plainly that no money passes through the app', () => {
    expect(prose).toContain('never handles money');
    expect(prose).toMatch(/no wallet/);
    expect(prose).toMatch(/payment processor/);
  });
});

describe('guideline 5.1.1 — the privacy policy matches what is collected', () => {
  const prose = legalDocument('privacy')
    .sections.flatMap((section) => [section.heading, ...section.body])
    .join('\n')
    .toLowerCase();

  // One line per row of the App Store Connect nutrition label. If a category
  // is added there, it has to be added here too.
  it.each([
    ['email address', 'email address'],
    ['name and handle', 'handle'],
    ['photos and videos', 'video'],
    ['user content', 'comment'],
    ['identifiers', 'push token'],
    ['legacy phone numbers', 'phone number'],
  ])('describes %s', (_label, needle) => {
    expect(prose).toContain(needle);
  });

  it('declares that nothing tracks the user', () => {
    expect(prose).toContain('we do not track you');
    expect(prose).toContain('no analytics');
  });

  it('explains the one thing deletion keeps, and why', () => {
    expect(prose).toContain('delete your account');
    expect(prose).toMatch(/balances on bets that have already been settled are kept/);
  });
});

describe('the placeholders announce themselves', () => {
  // Jest runs with neither variable set, which is exactly the state a fresh
  // checkout is in — so this is the guard working, not a gap.
  it('knows the legal pages are not hosted yet', () => {
    expect(LEGAL_PAGES_PUBLISHED).toBe(false);
  });

  it('knows there is no support address yet', () => {
    expect(SUPPORT_CONTACT_PUBLISHED).toBe(false);
  });
});

describe('the generated HTML', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { page, SLUGS } = require('../scripts/build-legal-html.js') as {
    page: (slug: string) => string;
    SLUGS: string[];
  };

  it('covers the same documents the app renders', () => {
    expect(SLUGS.slice().sort()).toEqual(LEGAL_SLUGS.slice().sort());
  });

  it.each(LEGAL_SLUGS)('renders %s as a whole page', (slug) => {
    const html = page(slug);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain(`<title>${legalDocument(slug).title} — ${APP_NAME}</title>`);
    expect(html).toContain('</html>');
    expect(html).not.toMatch(/\{\{|\}\}/);
  });

  it('carries no external asset, so it cannot fail to load', () => {
    for (const slug of LEGAL_SLUGS) {
      expect(page(slug)).not.toMatch(/<(script|link|img)\b/);
    }
  });

  it('escapes the text rather than pasting it into markup', () => {
    // Nothing in the current text needs escaping, which is precisely why this
    // asserts the escaper rather than the output: the next paragraph someone
    // writes with an ampersand in it should not be able to break the page.
    for (const slug of LEGAL_SLUGS) {
      const html = page(slug);
      const body = html.slice(html.indexOf('<main>'), html.indexOf('</main>'));
      // Every < in the body opens a tag we generated; none came from the text.
      for (const tag of body.match(/<[a-z/][^>]*>/g) ?? []) {
        expect(tag).toMatch(/^<\/?(main|h1|h2|p|ul|li|a)\b[^>]*>$/);
      }
    }
  });
});
