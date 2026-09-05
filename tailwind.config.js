// Colours are semantic and live behind CSS custom properties, so a single
// class name means the same thing in both schemes and only the value under it
// changes. `theme-colors.json` holds the two palettes; `global.css` is
// generated from it by scripts/build-theme-css.js.
const color = (name) => `var(--c-${name})`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  // Required. Under the default `media`, NativeWind's colour-scheme observer
  // calls `colorScheme.set()` when the stylesheet lands and that throws on the
  // web dev server. `class` is also what lets the app override the system
  // scheme from Settings.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        canvas: color('canvas'),
        sunken: color('sunken'),
        surface: color('surface'),
        surface2: color('surface2'),
        surface3: color('surface3'),
        hairline: color('hairline'),
        'hairline-strong': color('hairline-strong'),

        primary: color('text'),
        secondary: color('text-secondary'),
        tertiary: color('text-tertiary'),
        inverse: color('text-inverse'),

        accent: {
          DEFAULT: color('accent'),
          strong: color('accent-strong'),
          soft: color('accent-soft'),
          ink: color('accent-ink'),
        },

        positive: { DEFAULT: color('positive'), soft: color('positive-soft') },
        negative: { DEFAULT: color('negative'), soft: color('negative-soft') },

        sideA: { DEFAULT: color('side-a'), soft: color('side-a-soft') },
        sideB: { DEFAULT: color('side-b'), soft: color('side-b-soft') },

        chrome: color('chrome'),
        'chrome-edge': color('chrome-edge'),
        scrim: color('scrim'),
        'on-media': {
          DEFAULT: color('on-media'),
          soft: color('on-media-soft'),
          faint: color('on-media-faint'),
        },
      },

      // The system face, which on iOS is SF Pro. Apple ships optical sizing,
      // tracking tables and legibility tuning with it; a webfont would throw
      // all of that away for a novelty that stops the app feeling native.
      fontFamily: {
        sans: ['System', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },

      // Apple's type scale, with its tracking. Tracking is size-specific:
      // large text needs it tightened, small text needs it opened up. A single
      // letter-spacing value is wrong somewhere.
      fontSize: {
        '2xs': ['11px', { lineHeight: '13px', letterSpacing: '0.07px' }], // Caption 2
        xs: ['12px', { lineHeight: '16px', letterSpacing: '0px' }], // Caption 1
        sm: ['13px', { lineHeight: '18px', letterSpacing: '-0.08px' }], // Footnote
        subhead: ['15px', { lineHeight: '20px', letterSpacing: '-0.23px' }],
        callout: ['16px', { lineHeight: '21px', letterSpacing: '-0.31px' }],
        base: ['17px', { lineHeight: '22px', letterSpacing: '-0.41px' }], // Body
        lg: ['20px', { lineHeight: '25px', letterSpacing: '-0.45px' }], // Title 3
        xl: ['22px', { lineHeight: '28px', letterSpacing: '-0.26px' }], // Title 2
        '2xl': ['28px', { lineHeight: '34px', letterSpacing: '-0.4px' }], // Title 1
        '3xl': ['34px', { lineHeight: '41px', letterSpacing: '-0.6px' }], // Large Title
        '4xl': ['44px', { lineHeight: '48px', letterSpacing: '-1.1px' }],
        '5xl': ['56px', { lineHeight: '58px', letterSpacing: '-1.6px' }],
        '6xl': ['72px', { lineHeight: '72px', letterSpacing: '-2.4px' }],
      },

      // 4pt grid, with the two named steps screens actually reach for.
      spacing: {
        gutter: '20px',
        section: '28px',
      },

      // Radius says what kind of object something is: chrome and media are
      // generously rounded, controls sit in the middle, structure is square.
      borderRadius: {
        lg: '10px',
        xl: '12px',
        '2xl': '16px',
        '3xl': '22px',
        '4xl': '28px',
        '5xl': '34px',
      },
    },
  },
  plugins: [],
};
