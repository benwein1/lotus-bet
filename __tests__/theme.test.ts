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

  /**
   * Contrast, measured rather than eyeballed.
   *
   * Light mode was failing fifteen of these when they were first written —
   * the accent, both directions and the tertiary label all sat between 2.5:1
   * and 4.4:1 on white, which is the whole of the "light mode reads flatter"
   * complaint stated numerically. A screenshot will not tell you that; this
   * will, and it will say so again if a colour is ever nudged back.
   *
   * 4.5:1 is WCAG AA for body text. 3:1 is the large-text and
   * UI-boundary threshold, used only where the token is only ever rendered
   * large.
   */
  describe('contrast', () => {
    const channel = (value: number): number => {
      const s = value / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };

    function luminance(color: string): number {
      const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
      const rgb = hex
        ? [0, 2, 4].map((i) => parseInt(hex[1]!.slice(i, i + 2), 16))
        : /rgba?\(([^)]+)\)/
            .exec(color)![1]!
            .split(',')
            .slice(0, 3)
            .map(Number);

      const [r, g, b] = rgb.map(channel) as [number, number, number];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    function ratio(a: string, b: string): number {
      const la = luminance(a);
      const lb = luminance(b);
      const [hi, lo] = la > lb ? [la, lb] : [lb, la];
      return (hi + 0.05) / (lo + 0.05);
    }

    type Token = keyof typeof palette.light;
    const pairs: [string, Token, Token, number][] = [
      ['body on canvas', 'text', 'canvas', 4.5],
      ['body on surface', 'text', 'surface', 4.5],
      ['secondary on canvas', 'textSecondary', 'canvas', 4.5],
      ['secondary on surface', 'textSecondary', 'surface', 4.5],
      ['secondary on sunken', 'textSecondary', 'sunken', 4.5],
      ['tertiary on canvas', 'textTertiary', 'canvas', 4.5],
      ['tertiary on surface', 'textTertiary', 'surface', 4.5],
      ['accent on canvas', 'accent', 'canvas', 4.5],
      ['accent on surface', 'accent', 'surface', 4.5],
      ['accent on its own tint', 'accent', 'accentSoft', 4.5],
      ['a white label on the accent', 'accentInk', 'accent', 4.5],
      ['positive on canvas', 'positive', 'canvas', 4.5],
      ['positive on its own tint', 'positive', 'positiveSoft', 4.5],
      ['negative on canvas', 'negative', 'canvas', 4.5],
      ['negative on its own tint', 'negative', 'negativeSoft', 4.5],
      ['side A on its own tint', 'sideA', 'sideASoft', 4.5],
      ['a label on a side A fill', 'sideAInk', 'sideA', 4.5],
      ['side B on its own tint', 'sideB', 'sideBSoft', 4.5],
      ['a label on a side B fill', 'sideBInk', 'sideB', 4.5],
      // Percentages either side of the odds bar are 20px+ bold.
      ['side A on canvas, large', 'sideA', 'canvas', 3],
      ['side B on canvas, large', 'sideB', 'canvas', 3],
    ];

    for (const scheme of ['light', 'dark'] as const) {
      for (const [what, fg, bg, min] of pairs) {
        it(`${scheme}: ${what} clears ${min}:1`, () => {
          expect(ratio(palette[scheme][fg], palette[scheme][bg])).toBeGreaterThanOrEqual(min);
        });
      }
    }
  });
});
