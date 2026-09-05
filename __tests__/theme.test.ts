import { readFileSync } from 'fs';
import { join } from 'path';

import palette from '../theme-colors.json';

/**
 * The palette exists twice — as CSS custom properties for Tailwind, and as
 * plain values for the React Native APIs that take a colour string. These
 * tests are what stop the two drifting.
 */
describe('theme', () => {
  it('defines the same tokens in both schemes', () => {
    expect(Object.keys(palette.dark)).toEqual(Object.keys(palette.light));
  });

  it('has a generated global.css that matches theme-colors.json', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { css } = require('../scripts/build-theme-css.js') as { css: string };
    const onDisk = readFileSync(join(__dirname, '..', 'global.css'), 'utf8');

    // If this fails, run `npm run theme`.
    expect(onDisk).toBe(css);
  });
});
