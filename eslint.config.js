// Flat config. `npm run lint` -> `expo lint`, which finds this and runs it
// rather than trying to download a config, which is what it did before and
// what made the script fail in a clean checkout (APP_STORE.md §5).
//
// The Expo preset does the ordinary work. What is worth having here is the
// second block: the four traps CLAUDE.md records as *already having bitten
// once*, turned into rules so the next person hits an error instead of the
// bug. A comment in a document is a hope; a lint rule is a check.
const expo = require('eslint-config-expo/flat');

module.exports = [
  ...expo,
  {
    ignores: [
      'dist/**',
      '.expo/**',
      'node_modules/**',
      // Generated from theme-colors.json by scripts/build-theme-css.js.
      'global.css',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-native-reanimated',
              importNames: ['default'],
              message:
                "Import Animated from '@/components/animated' instead. NativeWind " +
                'silently drops className on components it has not been taught ' +
                'about, and that module is where the cssInterop registration ' +
                'happens. No error, the styles just never arrive — CLAUDE.md §4.',
            },
          ],
        },
      ],

      'no-restricted-properties': [
        'error',
        {
          object: 'Alert',
          property: 'alert',
          message:
            "Use `confirm` from '@/lib/confirm' instead. Alert.alert is literally " +
            '`static alert() {}` on react-native-web, so every confirmation in ' +
            'the app was a dead control on the one platform the design loop ' +
            'runs on — CLAUDE.md §4.',
        },
      ],

      'no-restricted-syntax': [
        'error',
        {
          // `theme-colors.json` holds two complete palettes and every colour
          // class resolves to a `var(--c-*)`, so one class name is already
          // correct in both schemes. There is not a single `dark:` variant in
          // the app and there should never need to be one.
          selector:
            "JSXAttribute[name.name='className'] > Literal[value=/(^|\\s)dark:/]",
          message:
            'No `dark:` variants. The semantic colour tokens already resolve ' +
            'per scheme — add the value to theme-colors.json instead, and run ' +
            '`npm run theme`. CLAUDE.md §4.',
        },
        {
          // Tailwind needs literal class names; an interpolated one compiles
          // to nothing at all, silently.
          selector:
            "JSXAttribute[name.name='className'] > JSXExpressionContainer > TemplateLiteral > TemplateElement[value.raw=/(bg|text|border)-$/]",
          message:
            'No dynamic class names. `bg-${tone}` compiles to nothing — spell ' +
            'both branches out as literals. CLAUDE.md §4.',
        },
      ],
    },
  },
  {
    // The canonical payout implementation is Deno-shaped on purpose: no
    // bundler, no `@/` alias, no React Native, and no imports at all. That is
    // what keeps it dependency-free, and it is the code whose output becomes
    // the ledger — CLAUDE.md §5.
    files: ['supabase/functions/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
      'import/no-unresolved': 'off',
    },
  },
];
