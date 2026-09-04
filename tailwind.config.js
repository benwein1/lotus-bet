// The palette lives in theme-colors.json so that Tailwind and the handful of
// places that need a raw hex value (navigator options, animated styles that
// bypass the className pipeline) can never drift apart.
const colors = require('./theme-colors.json');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  // The app commits to a single dark palette and uses no `dark:` variants, so
  // this changes nothing visually. It is required on web: NativeWind's
  // colour-scheme observer calls `colorScheme.set()` when the stylesheet lands,
  // and that call throws outright under the default `darkMode: 'media'`.
  darkMode: 'class',
  theme: {
    extend: {
      colors,

      // Space Grotesk carries every heading, number and label; body copy stays
      // on the system face, which reads better at small sizes and feels native.
      // `display` is loaded in app/_layout.tsx.
      fontFamily: {
        display: ['SpaceGrotesk_600SemiBold'],
        'display-medium': ['SpaceGrotesk_500Medium'],
        'display-bold': ['SpaceGrotesk_700Bold'],
      },

      // A real type scale. Sizes are deliberately few — six steps cover the
      // whole app, which is what keeps screens looking like one product.
      fontSize: {
        '2xs': ['11px', { lineHeight: '14px', letterSpacing: '0.6px' }],
        xs: ['12px', { lineHeight: '16px' }],
        sm: ['14px', { lineHeight: '20px' }],
        base: ['16px', { lineHeight: '23px' }],
        lg: ['18px', { lineHeight: '25px' }],
        xl: ['21px', { lineHeight: '27px' }],
        '2xl': ['26px', { lineHeight: '32px' }],
        '3xl': ['32px', { lineHeight: '37px' }],
        '4xl': ['40px', { lineHeight: '44px' }],
        '5xl': ['52px', { lineHeight: '56px' }],
      },

      // 4pt grid. Named steps stop screens drifting into ad-hoc margins.
      spacing: {
        gutter: '20px',
        section: '28px',
      },

      borderRadius: {
        xl: '14px',
        '2xl': '18px',
        '3xl': '24px',
        '4xl': '32px',
      },
    },
  },
  plugins: [],
};
