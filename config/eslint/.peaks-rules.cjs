/**
 * peaks-loop ESLint rules bundle (npm-package exports)
 *
 * rid-2026-08-05-jsts-lint-bundle — LLM auto-fix loop trigger.
 *
 * This file is a JSON-shape glue config. It does NOT define custom
 * rules. It composes upstream packages only:
 *
 *   - eslint:recommended
 *   - plugin:@typescript-eslint/recommended-type-checked
 *
 * Note: plugin:import/* extends were removed during the 4.0.16 lint
 * dogfood because (a) npm 10.9.4 + npx silently fails the fourth
 * `--package` flag on Windows and (b) eslint-plugin-import@2.32.0
 * peer-rejects eslint 10. Duplicate-import warnings are re-expressed
 * through `@typescript-eslint/no-duplicate-imports` below.
 *
 * Framework-specific rules (eslint-plugin-react, eslint-plugin-vue,
 * eslint-plugin-svelte, eslint-plugin-nestjs, etc.) are LAYER 3 and
 * loaded dynamically by `peaks code lint` via `npx --package <pkg>
 * -- eslint`. They are NOT installed in this package's devDependencies
 * (sediment §二 G-lint-1 turn-5 red line).
 *
 * --fix / --write / prettier are FORBIDDEN at the peaks code lint
 * wrapper entry; the wrapper is a read-only verifier, not a formatter
 * (sediment §二 G-lint-2). The thresholds below are intentionally
 * permissive (warn, not error) so peaks-loop 4.0.10 baseline can adopt
 * the bundle without auto-failing.
 */
'use strict';

/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: false,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: ['./tsconfig.json', './tsconfig.build.json'],
    tsconfigRootDir: __dirname + '/..'
  },
  env: {
    node: true,
    es2022: true
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended-type-checked'
  ],
  settings: {},
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'coverage/',
    'output-styles/',
    'skills/',
    'agents/',
    'bin/',
    'scratch/',
    'examples/'
  ],
  rules: {
    // L1 (eslint built-in) — always on, no plugin package required.
    // PRD-002b slice: max-lines + max-lines-per-function promoted warn → error.
    // D5 no-touch-stockcode invariant:存量违规通过 .peaks/lint/baseline.json 豁免
    // (see src/services/lint/eslint-runner.ts baselineFile option).
    'max-lines': [
      'error',
      { max: 400, skipBlankLines: true, skipComments: true }
    ],
    complexity: ['warn', { max: 10 }],
    'max-lines-per-function': [
      'error',
      { max: 50, skipComments: true, skipBlankLines: true }
    ],
    'max-params': ['warn', { max: 4 }],
    'no-magic-numbers': [
      'warn',
      { ignore: [0, 1, -1, 100, 1000] }
    ],
    'no-explicit-any': 'warn',
    'prefer-const': 'warn',
    'no-var': 'error',
    eqeqeq: ['warn', 'always', { null: 'ignore' }],

    // L2 (@typescript-eslint) — type-aware; requires the
    // recommended-type-checked base. configured via the extends above.
    '@typescript-eslint/consistent-type-imports': [
      'warn',
      { prefer: 'type-imports' }
    ],
    '@typescript-eslint/no-non-null-assertion': 'warn',
    '@typescript-eslint/no-implicit-any': 'warn',
    // G-lint-1 §二 enum → as const: warn-only (escape hatch preserved).
    '@typescript-eslint/no-restricted-syntax': [
      'warn',
      {
        selector: 'TSEnumDeclaration',
        message: 'Use "as const" union instead of TS enum.'
      }
    ],

    // L2 (typescript-eslint only) — boundary hygiene that previously
    // lived under eslint-plugin-import.
    '@typescript-eslint/no-duplicate-imports': 'warn'
  },
  overrides: [
    {
      files: ['*.test.ts', '*.test.tsx', 'tests/**/*.ts', 'tests/**/*.tsx'],
      rules: {
        'no-magic-numbers': 'off',
        complexity: 'off',
        'max-lines-per-function': 'off',
        '@typescript-eslint/no-explicit-any': 'off'
      }
    }
  ]
};
