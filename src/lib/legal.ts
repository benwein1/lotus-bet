import appConfig from '../../app.json';
import legalText from '../../legal-text.json';

/**
 * Where the legal pages live, what they say, and which version people agreed
 * to.
 *
 * Guideline 1.2 requires an app carrying user-generated content to publish its
 * rules and its contact information, and 5.1.1 requires a privacy policy
 * reachable from inside the app. App Store Connect asks for both URLs as part
 * of the listing, and a reviewer follows them.
 *
 * The text itself lives in `legal-text.json` and is rendered twice: by
 * `app/legal/*` inside the app, and by `scripts/build-legal-html.js` into
 * `public/legal/*.html` for the web build. One source, two renderers, and a
 * jest test that fails when the generated HTML drifts — the same arrangement
 * as the palette, for the same reason.
 *
 * **Why the text is bundled rather than only hosted.** Until this existed the
 * sign-up checkbox linked at a domain that did not exist, so the one screen
 * where somebody agrees to the rules pointed at nothing. Bundling means the
 * agreement is real from the first account, before any hosting decision, and
 * the hosted copy becomes the listing's URL rather than the only copy.
 */

/** The app's own name, read from where it is already defined. */
export const APP_NAME = appConfig.expo.name;

/**
 * Set this to your domain and the three URLs below follow.
 *
 * Falls back to `EXPO_PUBLIC_WEB_ORIGIN`, because the generated pages ship
 * inside the web build — if that is deployed anywhere, the legal pages are
 * already there and there is nothing else to host. The final fallback is
 * deliberately an obviously-fake host rather than a plausible one: a dead link
 * that looks real is worse than one that announces itself.
 */
const ORIGIN =
  process.env.EXPO_PUBLIC_LEGAL_ORIGIN ??
  process.env.EXPO_PUBLIC_WEB_ORIGIN ??
  'https://example.invalid';

/** Paths under the origin, matching what `build-legal-html.js` writes. */
export const TERMS_URL = `${ORIGIN}/legal/terms.html`;
export const PRIVACY_URL = `${ORIGIN}/legal/privacy.html`;
export const SUPPORT_URL = `${ORIGIN}/legal/support.html`;

/**
 * Whether the hosted pages are actually somewhere.
 *
 * The in-app screens do not depend on this — they render bundled text and
 * always work. This only governs whether anything offers the *web* copy, and
 * App Store Connect needs it to be true before you submit.
 */
export const LEGAL_PAGES_PUBLISHED = !ORIGIN.includes('example.invalid');

/**
 * The address a person can actually write to.
 *
 * Guideline 1.2 asks for published contact information, and it means a real
 * one. This is the single value that has to be set before submitting; it is
 * listed in `eas.json`'s production profile so it is visible in the file you
 * have to edit anyway.
 */
export const SUPPORT_EMAIL =
  process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? 'support@example.invalid';

export const SUPPORT_CONTACT_PUBLISHED = !SUPPORT_EMAIL.includes('example.invalid');

export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
  `${APP_NAME} support`
)}`;

/**
 * The version of the terms being agreed to, recorded against the account.
 *
 * Read from the text rather than typed next to it, so the recorded version and
 * the words somebody actually read cannot drift apart. A bare "accepted: true"
 * is worth very little the first time the terms change: you cannot tell who
 * agreed to what, so you cannot tell who needs to be asked again. Bump
 * `version` in `legal-text.json` whenever the text changes materially, and the
 * accounts that predate the change are then a query rather than a guess.
 */
export const TERMS_VERSION = legalText.version;

export type LegalSection = {
  readonly heading: string;
  readonly body: readonly string[];
};

export type LegalDocument = {
  readonly slug: LegalSlug;
  readonly title: string;
  readonly summary: string;
  readonly version: string;
  readonly sections: readonly LegalSection[];
};

export const LEGAL_SLUGS = ['terms', 'privacy', 'support'] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];

/**
 * Fills in the two things the text does not hardcode.
 *
 * The app's name is a placeholder because renaming should be one edit rather
 * than a hunt through nine paragraphs, and the support address because it
 * genuinely differs per deployment.
 */
export function fillPlaceholders(text: string): string {
  return text.split('{{app}}').join(APP_NAME).split('{{support}}').join(SUPPORT_EMAIL);
}

/** The document, ready to render. */
export function legalDocument(slug: LegalSlug): LegalDocument {
  const source = legalText.documents[slug];
  return {
    slug,
    title: source.title,
    summary: fillPlaceholders(source.summary),
    version: legalText.version,
    sections: source.sections.map((section) => ({
      heading: fillPlaceholders(section.heading),
      body: section.body.map(fillPlaceholders),
    })),
  };
}
