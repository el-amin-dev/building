import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import reactHooks from 'eslint-plugin-react-hooks';
import { reactRefresh } from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores([
    'dist/',
    'coverage/',
    'playwright-report/',
    'test-results/',
    'blob-report/',
    'playwright/.cache/',
  ]),
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    rules: {
      'no-console': 'error',
      'no-warning-comments': ['error', { terms: ['todo', 'fixme', 'xxx', 'hack'] }],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite()],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['*.{js,ts}', 'tooling/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // `scripts/` holds command-line tools whose product IS their stdout:
    // `verify.mjs` prints the 12-check report a human reads and `build.mjs`
    // prints what it rewrote. `no-console` earns its keep by keeping stray
    // debug output out of the shipped browser bundle, and nothing under
    // `scripts/` is ever bundled — so it is off for these files only. Every
    // other rule, including the unused-variable and warning-comment rules,
    // still applies.
    files: ['scripts/**/*.mjs'],
    rules: {
      'no-console': 'off',
    },
  },
  eslintConfigPrettier,
]);
