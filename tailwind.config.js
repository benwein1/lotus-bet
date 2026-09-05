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

      // Extreme scale contrast is what separates a designed page from a laid-out
      // one: money and screen titles are enormous, body copy stays crisp and
      // small. Display sizes carry negative tracking — large type set at default
      // tracking always reads loose.
      fontSize: {
        '2xs': ['11px', { lineHeight: '14px', letterSpacing: '0.4px' }],
        xs: ['12px', { lineHeight: '17px' }],
        sm: ['14px', { lineHeight: '21px' }],
        base: ['16px', { lineHeight: '24px' }],
        lg: ['18px', { lineHeight: '26px' }],
        xl: ['22px', { lineHeight: '28px', letterSpacing: '-0.2px' }],
        '2xl': ['28px', { lineHeight: '33px', letterSpacing: '-0.5px' }],
        '3xl': ['36px', { lineHeight: '40px', letterSpacing: '-0.8px' }],
        '4xl': ['46px', { lineHeight: '48px', letterSpacing: '-1.2px' }],
        '5xl': ['60px', { lineHeight: '60px', letterSpacing: '-1.8px' }],
        '6xl': ['76px', { lineHeight: '72px', letterSpacing: '-2.4px' }],
        '7xl': ['96px', { lineHeight: '88px', letterSpacing: '-3.2px' }],
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
