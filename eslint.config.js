// ESLint flat config. typescript-eslint "recommended" (syntax-only, no type information: fast, ~10 s on the whole repo).
// Formatting is deliberately NOT linted: the codebase keeps its own dense style and there is no formatter (see README, "CI and lint").
// Rules set to "warn" below are the baseline at the time lint was introduced (PR "chore(ci): ESLint baseline"): CI fails on
// errors only, so new code cannot add an error, and the warnings are follow-up work. Promote a rule to "error" once its count is 0.
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['**/node_modules/', '**/dist/', 'artifacts/', 'assets/', 'test-results/', 'playwright-report/', 'coverage/', 'docs/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      // Baseline (warn): unused locals/params, mostly in tools/ drivers. A leading underscore marks an intentionally unused name.
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-unused-vars': 'off',
    },
  },
  // The browser app.
  { files: ['apps/web/src/**/*.ts'], languageOptions: { globals: { ...globals.browser } } },
  // Node code. tools/ and e2e/ drivers also pass closures to page.evaluate(), which run in the page, hence the browser globals too.
  { files: ['packages/**/*.ts', 'apps/bot/**/*.ts', 'apps/*/test/**/*.ts', 'tools/**/*.{ts,mjs,js}', 'tests/**/*.{ts,mjs,js}', '*.{ts,js,mjs}', 'apps/web/vite.config.ts'],
    languageOptions: { globals: { ...globals.node } } },
  { files: ['tools/**/*.{ts,mjs,js}', 'tests/**/*.{ts,mjs,js}', 'apps/web/e2e/**/*.ts'], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  // Playwright fixtures are destructured, so a test that needs no fixture is written `async ({}, testInfo) =>`: the documented idiom.
  { files: ['apps/web/e2e/**/*.ts'], rules: { 'no-empty-pattern': 'off' } },
  // Baseline (warn) for tools/: one-off drivers and the live playthrough harness, not shipped. The app keeps these as errors.
  { files: ['tools/**/*.{ts,mjs,js}'], rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-expressions': 'warn',
    'no-useless-assignment': 'warn',
  } },
);
