// The palette lives in theme-colors.json so that Tailwind and the handful of
// places that need a raw hex value (navigator options, animated styles that
// bypass the className pipeline) can never drift apart.
const colors = require('./theme-colors.json');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors,
      fontSize: {
        '2xs': ['10px', '13px'],
      },
    },
  },
  plugins: [],
};
