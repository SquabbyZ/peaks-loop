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
 *   - plugin:import/recommended
 *   - plugin:import/typescript
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
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended-type-checked',
    'plugin:import/recommended',
    'plugin:import/typescript'
  ],
  settings: {
    'import/resolver': {
      typescript: {
        alwaysTryTypes: true,
        project: ['./tsconfig.json', './tsconfig.build.json']
      },
      node: {
        extensions: ['.js', '.ts', '.tsx', '.jsx']
      }
    }
  },
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
    complexity: ['warn', { max: 10 }],
    'max-lines-per-function': [
      'warn',
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

    // L2 (eslint-plugin-import) — boundary hygiene.
    'import/no-duplicates': 'warn',
    'import/no-unresolved': 'off',
    'import/named': 'off',
    'import/default': 'off',
    'import/namespace': 'off'
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
