/**
 * Renders `legal-text.json` into standalone HTML pages under `public/legal/`.
 *
 * App Store Connect asks for a privacy policy URL and a support URL, and a
 * reviewer follows both. The app itself renders the same text from the same
 * JSON (`app/legal/*`), so the hosted copy and the copy somebody agreed to on
 * the sign-up screen cannot say different things.
 *
 * Expo copies `public/` into the web export verbatim, so the pages ship with
 * whatever the web build already deploys — there is nothing else to host.
 * They are generated as part of `npm run build:web` rather than committed,
 * because the support address comes from the environment and a committed copy
 * would carry whichever machine last ran it.
 *
 *   node scripts/build-legal-html.js
 */
const fs = require('fs');
const path = require('path');

const appConfig = require('../app.json');
const legalText = require('../legal-text.json');

const APP_NAME = appConfig.expo.name;
const SUPPORT_EMAIL = process.env.EXPO_PUBLIC_SUPPORT_EMAIL || 'support@example.invalid';

const fill = (text) => text.split('{{app}}').join(APP_NAME).split('{{support}}').join(SUPPORT_EMAIL);

const escape = (text) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** The support address is the one thing on these pages anybody needs to act on. */
const linkify = (html) =>
  SUPPORT_EMAIL.includes('example.invalid')
    ? html
    : html.split(escape(SUPPORT_EMAIL)).join(
        `<a href="mailto:${escape(SUPPORT_EMAIL)}">${escape(SUPPORT_EMAIL)}</a>`
      );

function paragraph(text) {
  if (text.startsWith('•')) {
    const items = text
      .split('\n')
      .map((line) => line.replace(/^•\s*/, '').trim())
      .filter(Boolean)
      .map((item) => `      <li>${linkify(escape(item))}</li>`)
      .join('\n');
    return `    <ul>\n${items}\n    </ul>`;
  }
  return `    <p>${linkify(escape(text))}</p>`;
}

/**
 * One page, no assets.
 *
 * Everything is inline: a legal page that fails to render because a stylesheet
 * did not load is a legal page that is not published. It follows the reader's
 * colour scheme for the same reason the app does, and reads at a comfortable
 * measure on a phone, which is where a reviewer will open it.
 */
function page(slug) {
  const doc = legalText.documents[slug];
  const body = doc.sections
    .map(
      (section) =>
        `    <h2>${escape(fill(section.heading))}</h2>\n` +
        section.body.map((text) => paragraph(fill(text))).join('\n')
    )
    .join('\n');

  // Written as a sentence rather than links strung together with middle dots,
  // which is the same rule the app's own chrome follows.
  const links = Object.keys(legalText.documents)
    .filter((other) => other !== slug)
    .map((other) => `<a href="./${other}.html">${escape(legalText.documents[other].title)}</a>`);
  const others =
    links.length === 2 ? `Also here: ${links[0]} and ${links[1]}.` : `Also here: ${links.join('')}.`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(doc.title)} — ${escape(APP_NAME)}</title>
<style>
  :root { color-scheme: light dark; --ink: #000; --muted: #3C3C43; --ground: #fff; --rule: #E3E3E8; --accent: #0060DF; }
  @media (prefers-color-scheme: dark) {
    :root { --ink: #fff; --muted: #A1A1AA; --ground: #000; --rule: #2C2C2E; --accent: #0A84FF; }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0 auto; padding: 48px 20px 96px; max-width: 42rem;
    background: var(--ground); color: var(--ink);
    font: 17px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    -webkit-text-size-adjust: 100%;
  }
  h1 { font-size: 28px; line-height: 1.2; letter-spacing: -0.02em; margin: 0; }
  h2 { font-size: 20px; line-height: 1.3; letter-spacing: -0.01em; margin: 40px 0 0; }
  p, li { color: var(--muted); font-size: 15px; line-height: 1.6; }
  p { margin: 12px 0 0; }
  ul { margin: 12px 0 0; padding-left: 1.1rem; }
  li { margin-top: 6px; }
  .version { color: var(--muted); font-size: 13px; margin: 6px 0 0; }
  .summary { font-size: 16px; margin-top: 18px; }
  a { color: var(--accent); }
  footer { margin-top: 56px; padding-top: 20px; border-top: 1px solid var(--rule); font-size: 13px; }
</style>
</head>
<body>
  <main>
    <h1>${escape(doc.title)}</h1>
    <p class="version">Version ${escape(legalText.version)}</p>
    <p class="summary">${linkify(escape(fill(doc.summary)))}</p>
${body}
  </main>
  <footer>${others}</footer>
</body>
</html>
`;
}

const SLUGS = Object.keys(legalText.documents);
const outDir = path.join(__dirname, '..', 'public', 'legal');

if (require.main === module) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const slug of SLUGS) {
    const target = path.join(outDir, `${slug}.html`);
    fs.writeFileSync(target, page(slug));
    console.log(`Wrote ${target}`);
  }
  if (SUPPORT_EMAIL.includes('example.invalid')) {
    console.warn(
      'EXPO_PUBLIC_SUPPORT_EMAIL is unset, so the pages carry a placeholder address.\n' +
        'Guideline 1.2 requires real published contact information — set it before you submit.'
    );
  }
}

module.exports = { page, fill, SLUGS, APP_NAME, SUPPORT_EMAIL };
