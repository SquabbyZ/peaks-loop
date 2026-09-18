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
 * through ESLint built-in `no-duplicate-imports` below (PRD-002b 2026-08-07).
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
    // 2026-09-19 rid-s1-lint-config-coverage: the root tsconfig.json includes
    // only src/** and tests/**, so every file under scripts/** and
    // packages/** belonged to NO project and eslint failed 71 of them with
    // "The file was not found in any of the provided project(s)" BEFORE
    // parsing them. That is not a lint result — it is a hole, and it also
    // masked real syntax errors (a .mjs with a broken string literal was found
    // by prettier only, because eslint never reached the parser). The
    // ESLint-only project below covers those directories without changing what
    // `tsc -p tsconfig.json` sees.
    project: [
      './tsconfig.json',
      './tsconfig.build.json',
      './config/eslint/tsconfig.lint.json'
    ],
    // 2026-08-06 lint-dogfood cycle-3 follow-up: the runner now uses
    // `node node_modules/eslint/bin/eslint.js` from the repo root, so
    // tsconfigRootDir must be the repo root (one level above config/).
    tsconfigRootDir: __dirname + '/../..'
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
  // 2026-09-19 rid-s1-lint-config-coverage: every pattern here used to be a
  // bare trailing-slash name. ESLint reads those the way .gitignore does — a
  // trailing slash with no inner slash matches a directory of that name at ANY
  // depth — so `'skills/'` also swallowed `src/services/skills/`, `src/skills/`
  // and two test directories: 33 tracked files, production source among them,
  // silently reported as "0 findings" without ever being parsed. A LEADING
  // slash anchors a pattern to the config's base path (the repo root), which
  // is what these were always meant to mean: the repo-root prose / artifact /
  // tooling directories.
  //
  // A leading slash alone is not enough for generated output, though: a
  // per-package `dist/`, `coverage/` or `node_modules/` must still stay out of
  // a directory walk, so those three are kept at any depth explicitly.
  // `**/node_modules/` in particular must be spelled out, not left to
  // eslint's own default ignore of `/**/node_modules/*`: a config that sets
  // `ignorePatterns` REPLACES that default rather than adding to it.
  ignorePatterns: [
    '/dist/',
    '/coverage/',
    '/output-styles/',
    '/skills/',
    '/agents/',
    '/bin/',
    '/scratch/',
    '/examples/',
    '**/dist/',
    '**/coverage/',
    '**/node_modules/'
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
    // PRD-002b slice 2 — config tune for no-magic-numbers (commit A).
    // --fix is a no-op: node_modules/eslint/lib/rules/no-magic-numbers.js
    // has no `fixable` field on its meta (verified 2026-08-07). Severity
    // stays `warn` per D5 no-touch-stockcode invariant.
    // eslint 8.57.1 schema (verified): accept only `ignore`, `ignoreArrayIndexes`,
    // `ignoreDefaultValues`, `detectObjects`, `enforceConst`,
    // `ignoreClassFieldInitialValues`. The newer options (`ignoreEnums`,
    // `ignoreNumericLiterals`, `ignoreReadonlyClassProperties`) are eslint 9.x
    // only — schema rejects them with `additionalProperties: false`.
    'no-magic-numbers': [
      'warn',
      {
        ignore: [-1, 0, 1, 2, 100, 1000],
        ignoreArrayIndexes: true,
        ignoreDefaultValues: true
      }
    ],
    // PRD-002b slice 5 pilot — switch phantom ruleId `no-explicit-any`
    // (bare built-in name, fires "Definition for rule ... was not found"
    // against plugin:@typescript-eslint/recommended-type-checked) to the
    // canonical `@typescript-eslint/no-explicit-any`. Drops ~667 phantom
    // entries from `peaks lint check` output and exposes only real
    // explicit `any` annotations. Severity stays `warn` (D5).
    '@typescript-eslint/no-explicit-any': 'warn',
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
    // 2026-09-19 rid-s1-lint-config-coverage: `@typescript-eslint/no-implicit-any`
    // was REMOVED here, not renamed. It does not exist in
    // @typescript-eslint/eslint-plugin@8.66.0 (134 rules; verified against the
    // shipped plugin's rule index) — typescript-eslint dropped it in v6 — and
    // eslint answered every parsed file with 2 severity-2
    // "Definition for rule ... was not found" messages, 2390 across the repo.
    // Besides inflating the count, that made "a NEW file must be lint- and
    // commit-able" unsatisfiable, since no new file could avoid those two.
    // Its intent is already covered twice over, so nothing needs to replace it:
    //   - tsc: this repo builds with `strict: true` (root tsconfig.json), which
    //     turns on noImplicitAny at the compiler level;
    //   - eslint: `plugin:@typescript-eslint/recommended-type-checked` above
    //     already enables the implicit-any surface (`no-unsafe-assignment`,
    //     `-argument`, `-call`, `-member-access`, `-return`, …) plus
    //     `no-explicit-any`, which is re-declared as `warn` just above.
    // G-lint-1 §二 enum → as const: warn-only (escape hatch preserved).
    // NOTE: this must stay the CORE `no-restricted-syntax`. The selector below
    // is an ESLint-core selector, and core is where the rule lives —
    // `@typescript-eslint/no-restricted-syntax` does not exist in
    // @typescript-eslint/eslint-plugin@8.66.0 and produced the same phantom
    // "Definition for rule ... was not found" on every file.
    'no-restricted-syntax': [
      'warn',
      {
        selector: 'TSEnumDeclaration',
        message: 'Use "as const" union instead of TS enum.'
      }
    ],

    // L2 (boundary hygiene that previously lived under eslint-plugin-import).
    // Use ESLint built-in `no-duplicate-imports` — `@typescript-eslint/no-duplicate-imports`
    // does NOT exist in @typescript-eslint/eslint-plugin@8.66.0 (broken ruleId, all 820
    // phantom entries were `Definition for rule ... was not found`). PRD-002b 2026-08-07.
    'no-duplicate-imports': 'warn'
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
