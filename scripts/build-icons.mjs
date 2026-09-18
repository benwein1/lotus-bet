/**
 * Renders every app icon from `assets/logo/lotus.svg`.
 *
 *   node scripts/build-icons.mjs
 *
 * One source, so the home-screen icon, the splash and the favicon can never
 * drift apart. Re-run it after editing the SVG and commit what it writes.
 *
 * Needs `sharp`, which is a build-time dependency only — nothing in the app
 * imports it.
 */
import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'assets/logo/lotus.svg'));
const out = join(root, 'assets/images');
mkdirSync(out, { recursive: true });

/** The ground the iOS icon sits on. iOS icons cannot be transparent. */
const ICON_BACKGROUND = '#07080B';

/** Render the mark at `size`, inset by `padding` on every side. */
async function mark(size, padding) {
  return sharp(svg)
    .resize(size - padding * 2, size - padding * 2, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .extend({
      top: padding,
      bottom: padding,
      left: padding,
      right: padding,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

/**
 * The mark on an opaque ground, with **no alpha channel at all**.
 *
 * `removeAlpha` is not tidying. App Store Connect refuses a 1024x1024 icon
 * that carries an alpha channel, and it refuses it at upload — after a full
 * build, at the point you were trying to ship. Compositing onto an opaque
 * background is not enough on its own: the result is still a 4-channel PNG
 * whose alpha happens to be 255 everywhere, which is exactly what was being
 * written here (verified: `channels: 4, hasAlpha: true`).
 *
 * `flatten` first, so anything semi-transparent in the mark resolves against
 * the ground rather than against black when the channel is dropped.
 */
async function onGround(size, padding, background) {
  const petals = await mark(size, padding);
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: petals }])
    .flatten({ background })
    .removeAlpha()
    .png()
    .toBuffer();
}

const files = [];

// The home-screen icon, and the one App Store Connect takes as the 1024x1024
// marketing icon. Apple applies its own corner radius, so this is a full-bleed
// square — rounding it here would show as a dark halo inside Apple's mask —
// and it carries no alpha channel, which the upload requires.
files.push(['icon.png', await onGround(1024, 60, ICON_BACKGROUND)]);

// The splash mark is transparent — expo-splash-screen paints the ground
// behind it, and it differs between light and dark.
files.push(['splash-icon.png', await mark(512, 8)]);

// Android's adaptive icon: the system masks the foreground to whatever shape
// the launcher uses, and only the middle ~66% is guaranteed visible, so this
// one is inset much further than the iOS icon.
files.push(['android-icon-foreground.png', await mark(1024, 280)]);
files.push([
  'android-icon-background.png',
  await sharp({
    create: { width: 1024, height: 1024, channels: 4, background: ICON_BACKGROUND },
  })
    .png()
    .toBuffer(),
]);

// The monochrome layer for themed icons: one flat silhouette, no tones.
files.push([
  'android-icon-monochrome.png',
  await sharp(
    Buffer.from(
      readFileSync(join(root, 'assets/logo/lotus.svg'), 'utf8').replace(
        /fill="#[0-9A-Fa-f]{6}"/g,
        'fill="#FFFFFF"'
      )
    )
  )
    .resize(1024 - 560, 1024 - 560, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ top: 280, bottom: 280, left: 280, right: 280, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer(),
]);

files.push(['favicon.png', await onGround(64, 8, ICON_BACKGROUND)]);

for (const [name, buffer] of files) {
  const path = join(out, name);
  const { width, height, hasAlpha } = await sharp(buffer).metadata();
  const { size } = await sharp(buffer).toFile(path);
  // Printed because it is the property App Store Connect rejects on, and the
  // only way to notice is to look.
  const alpha = hasAlpha ? 'alpha' : 'no alpha';
  console.log(
    `  ${name.padEnd(32)} ${width}x${height}  ${(size / 1024).toFixed(1)} KB  ${alpha}`
  );
}

console.log('\nWrote', files.length, 'files to assets/images');
