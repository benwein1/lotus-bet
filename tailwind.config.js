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

        /**
         * The secondary brand colour, Spring Mint.
         *
         * Deliberately named `brand` rather than anything money-shaped, because
         * it sits 8 degrees of hue from `positive` and the app already spends
         * green twice: `positive` is money owed to you and `sideA` is the side
         * in favour. Both are learned, and neither may drift.
         *
         * The rule that keeps the three apart is not distance, it is job.
         * **Brand green never carries a number and never carries a side.** It
         * marks status and selection — the live dot, the "open" badge, a
         * selected chip, the mark itself — and every one of those is next to a
         * word that says what it means ("Live", "$40" is not one of them). A
         * live dot can therefore sit on the same card as a green side button
         * without either being misread, which is exactly what the feed does.
         *
         * What would break it: colouring an amount, a bet side, an odds bar
         * slice or a balance row with it. Those are `positive` and `sideA`.
         */
        brand: {
          DEFAULT: color('brand'),
          strong: color('brand-strong'),
          soft: color('brand-soft'),
          ink: color('brand-ink'),
        },

        positive: { DEFAULT: color('positive'), soft: color('positive-soft') },
        negative: { DEFAULT: color('negative'), soft: color('negative-soft') },

        // The two sides of a bet read as the two directions money can go:
        // green for, red against. `media` is the on-a-photo variant, which is
        // the same value in both schemes because a scrim is dark either way.
        sideA: {
          DEFAULT: color('side-a'),
          soft: color('side-a-soft'),
          ink: color('side-a-ink'),
          media: color('side-a-on-media'),
        },
        sideB: {
          DEFAULT: color('side-b'),
          soft: color('side-b-soft'),
          ink: color('side-b-ink'),
          media: color('side-b-on-media'),
        },

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
