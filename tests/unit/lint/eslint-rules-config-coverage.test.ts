// Guards for `config/eslint/.peaks-rules.cjs` — slice rid-s1-lint-config-coverage.
//
// Three defects in that file survived a fully green suite (305 files / 3405
// cases), because every one of them made a rule or a file *quieter* rather than
// noisier:
//
//   1. two ruleIds that @typescript-eslint/eslint-plugin@8.66.0 does not define
//      (`@typescript-eslint/no-implicit-any`, and the CORE rule
//      `no-restricted-syntax` written with a plugin prefix). eslint answers
//      every parsed file with 2 severity-2 "Definition for rule ... was not
//      found" messages — 2390 repo-wide — which also made "a NEW file must be
//      clean" unsatisfiable, since no new file could avoid them.
//   2. `parserOptions.project` covered neither scripts/** nor packages/**; 71
//      files matched no project and eslint failed them BEFORE parsing them,
//      which additionally MASKED a real syntax error (a .mjs with an unclosed
//      string literal).
//   3. `ignorePatterns: ['skills/', ...]` — a bare trailing-slash name is read
//      the .gitignore way and matched a same-named directory at ANY depth, so
//      `src/services/skills/`, `src/skills/` and two test directories — 33
//      tracked files, production source among them — were reported as
//      "0 findings" without ever being parsed.
//
// Each guard below runs TWO ARMS, and the second arm is the one that matters:
// asserting the current config is fine proves nothing unless the same check is
// also shown to report a violation. Every arm therefore runs through the same
// code path, with the real config as the control and a deliberately regressed
// input as the injected case. A guard that can only go red has not been shown
// to be able to SEE.
//
// eslint is driven as a SUBPROCESS, deliberately. It is not a devDependency of
// this package (the lint toolchain is loaded on demand — see
// `src/services/lint/eslint-runner.ts`), so it ships no resolvable types, and
// more importantly the CLI is the path `.husky/peaks-gate-baseline.mjs` and
// `.husky/peaks-gate.mjs` take. Asserting through the same entry point the gate
// uses is the only way this file can speak for the gate.
//
// Run with: pnpm vitest run tests/unit/lint/eslint-rules-config-coverage.test.ts

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/lint/eslint-rules-config-coverage.test.ts',
  ['behavior', 'integration'],
  [
    {
      dim: 'render',
      reason:
        'nothing here asserts a rendered surface; the config is parsed as data and the claims are about eslint behaviour'
    },
    {
      dim: 'a11y',
      reason:
        'no human-facing text surface; the observable is whether a path is ignored and whether a parse succeeds'
    }
  ]
);

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');

const CONFIG_REL = 'config/eslint/.peaks-rules.cjs';
const LINT_TSCONFIG_REL = 'config/eslint/tsconfig.lint.json';
const ESLINT_BIN = 'node_modules/eslint/bin/eslint.js';
const PLUGIN_PREFIX = '@typescript-eslint/';

/**
 * "This file belongs to no project" — the exact regex
 * `.husky/peaks-gate-baseline.mjs` and `.husky/peaks-gate.mjs` key on. The CLI
 * is used deliberately below because it is the only path that emits this shape:
 * `inferSingleRun` is true for a CLI invocation, so the parser synthesizes
 * `programs` from `project` and reports "The file was not found in any of the
 * provided project(s)". Through the Node API the same condition reports
 * "… none of those TSConfigs include this file" instead, which the gate's
 * regex would NOT match — one more reason to assert through the CLI.
 */
const COVERAGE_GAP_RE = /was not found in any of the provided project/;
const IGNORED_RE = /matching ignore pattern/;

const CODE_EXT = /\.(ts|tsx|mts|cts|mjs|cjs|js)$/;
const SCOPE_DIRS = ['src', 'tests', 'packages', 'scripts'];

/**
 * A real code file that deliberately sits OUTSIDE the lint tsconfig's include
 * list. It is the positive control for the coverage arms: if linting it does
 * not produce a project-coverage error, the check cannot see a gap at all.
 */
const KNOWN_UNCOVERED_FILE = 'stryker.vitest.config.mjs';

// ── the real config, loaded (never a copy pasted into this file) ──────────

type LintConfig = {
  parserOptions?: { project?: unknown };
  rules?: Record<string, unknown>;
  overrides?: Array<{ rules?: Record<string, unknown> }>;
};

function loadConfig(): LintConfig {
  const abs = join(REPO_ROOT, CONFIG_REL);
  delete require.cache[require.resolve(abs)];
  return require(abs) as LintConfig;
}

/** The plugin's OWN rule table — the answer key, never a hardcoded list. */
function pluginRuleNames(): Set<string> {
  const plugin = require(`${PLUGIN_PREFIX.slice(0, -1)}/eslint-plugin`) as {
    rules?: Record<string, unknown>;
  };
  return new Set(Object.keys(plugin.rules ?? {}));
}

function referencedPluginRuleIds(config: LintConfig): string[] {
  const ids = new Set<string>();
  const collect = (rules: Record<string, unknown> | undefined): void => {
    for (const id of Object.keys(rules ?? {})) {
      if (id.startsWith(PLUGIN_PREFIX)) ids.add(id);
    }
  };
  collect(config.rules);
  for (const override of config.overrides ?? []) collect(override.rules);
  return [...ids].sort();
}

/** Every `@typescript-eslint/*` ruleId this config names that the plugin lacks. */
function unknownPluginRuleIds(config: LintConfig): string[] {
  const known = pluginRuleNames();
  return referencedPluginRuleIds(config).filter((id) => !known.has(id.slice(PLUGIN_PREFIX.length)));
}

function withRule(config: LintConfig, ruleId: string): LintConfig {
  return { ...config, rules: { ...config.rules, [ruleId]: 'warn' } };
}

// ── the real eslint CLI, driven the way the husky gate drives it ──────────

type CliMessage = { ruleId: string | null; severity: number; fatal?: boolean; message: string };
type CliResult = { filePath: string; messages: CliMessage[] };

function eslintCli(files: readonly string[]): CliResult[] {
  let raw = '';
  try {
    raw = execFileSync(
      'node',
      [ESLINT_BIN, '--config', CONFIG_REL, '--format', 'json', ...files],
      // windowsHide is repo convention on every child_process call site; the
      // guard for it lives at tests/unit/spawn-windows-hide-guard.test.ts.
      { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, windowsHide: true }
    );
  } catch (err) {
    // eslint exits 1 whenever findings exist; the JSON report is still on stdout.
    raw = (err as { stdout?: string }).stdout ?? '';
  }
  return JSON.parse(raw) as CliResult[];
}

/**
 * `isPathIgnored` has no CLI equivalent, so this is the one place the Node API
 * is used. eslint is untyped here (see the header), so the instance is described
 * structurally rather than cast to `any`.
 */
type EslintIgnoreProbe = { isPathIgnored(filePath: string): Promise<boolean> };
type EslintCtor = new (options: {
  cwd: string;
  overrideConfigFile: string;
  overrideConfig?: unknown;
}) => EslintIgnoreProbe;

function ignoreProbe(overrideConfig?: unknown): EslintIgnoreProbe {
  const { ESLint } = require('eslint') as { ESLint: EslintCtor };
  return new ESLint({
    cwd: REPO_ROOT,
    overrideConfigFile: CONFIG_REL,
    ...(overrideConfig === undefined ? {} : { overrideConfig })
  });
}

async function ignoredMap(
  paths: readonly string[],
  injected?: unknown
): Promise<Map<string, boolean>> {
  const eslint = ignoreProbe(injected);
  const out = new Map<string, boolean>();
  for (const p of paths) out.set(p, await eslint.isPathIgnored(p));
  return out;
}

function trackedInScopeFiles(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8', windowsHide: true })
    .trim()
    .split('\n')
    .filter((f) => CODE_EXT.test(f) && SCOPE_DIRS.some((d) => f.startsWith(`${d}/`)));
}

// ── dimension: behavior ───────────────────────────────────────────────────

describe('(behavior) the config names no @typescript-eslint ruleId the plugin lacks', () => {
  it('the shipped config references zero undefined plugin ruleIds', () => {
    expect(unknownPluginRuleIds(loadConfig())).toEqual([]);
  });

  // ARM 2 of 2 — "the check can SEE". These cases are what separate a working
  // guard from one that passes because it never looked at anything.
  it('CONTROL: the scan really reads the config and the plugin rule table', () => {
    const pluginRules = pluginRuleNames();
    // The answer key is the shipped plugin's table, not an empty object.
    expect(pluginRules.size).toBeGreaterThan(100);
    expect(pluginRules.has('no-explicit-any')).toBe(true);

    const referenced = referencedPluginRuleIds(loadConfig());
    // The scan found the plugin-prefixed rules the config really declares...
    expect(referenced.length).toBeGreaterThanOrEqual(3);
    expect(referenced).toContain('@typescript-eslint/no-explicit-any');
    // ...and it does not silently treat a core ruleId as plugin-prefixed.
    expect(referenced).not.toContain('no-restricted-syntax');
  });

  // Containment, not equality: the claim is "the injected id is reported", and
  // it must hold even if the real config has other problems at the same time.
  // "Reports everything" is excluded by the two exact assertions around these.
  it('INJECTION ARM: re-adding @typescript-eslint/no-implicit-any is reported', () => {
    expect(
      unknownPluginRuleIds(withRule(loadConfig(), '@typescript-eslint/no-implicit-any'))
    ).toContain('@typescript-eslint/no-implicit-any');
  });

  it('INJECTION ARM: the plugin-prefixed core rule is reported as unknown', () => {
    expect(
      unknownPluginRuleIds(withRule(loadConfig(), '@typescript-eslint/no-restricted-syntax'))
    ).toContain('@typescript-eslint/no-restricted-syntax');
  });

  it('the core ruleId the config keeps is NOT reported as unknown', () => {
    expect(Object.keys(loadConfig().rules ?? {})).toContain('no-restricted-syntax');
    expect(unknownPluginRuleIds(loadConfig())).not.toContain('no-restricted-syntax');
  });
});

// ── dimension: integration ────────────────────────────────────────────────

describe('(integration) ignorePatterns swallow no tracked source file', () => {
  it('no git-tracked code file under src|tests|packages|scripts is ignored', async () => {
    const files = trackedInScopeFiles();
    expect(files.length).toBeGreaterThan(1000);

    const ignored = await ignoredMap(files);
    const swallowed = files.filter((f) => ignored.get(f) === true);
    // Asserted as an empty list rather than a length so a failure names the
    // directories that collided.
    expect(swallowed).toEqual([]);
  });

  it('the repo-root prose / artifact directories are still excluded', async () => {
    const probes = [
      'skills/bee/peaks-prd/SKILL.md',
      'agents/karpathy-reviewer.md',
      'bin/peaks.js',
      'output-styles/peaks-skill-swarm.md',
      'examples/video-demo/package.json',
      'dist/cli/index.js',
      'packages/peaks-loop-mut/node_modules/some-dep/index.js'
    ];
    const ignored = await ignoredMap(probes);
    for (const path of probes) expect([path, ignored.get(path)]).toEqual([path, true]);
  });

  // ARM 2 of 2 — replay the pre-fix pattern set through the real ignore
  // machinery. If this does not reproduce the swallow, the arm above is only
  // asserting that an empty check was empty.
  it('INJECTION ARM: the pre-fix unanchored patterns DO swallow those directories', async () => {
    const swallowedUnderOldConfig = [
      'src/services/skills/skill-registry.ts',
      'src/skills/peaks-maker/index.ts',
      'tests/unit/skills/presence-lease-service.test.ts',
      'tests/unit/services/skills/skill-statusline-renderer.test.ts'
    ];
    const ignored = await ignoredMap(swallowedUnderOldConfig, {
      ignorePatterns: ['node_modules/', 'dist/', 'skills/', 'agents/', 'bin/']
    });
    for (const path of swallowedUnderOldConfig)
      expect([path, ignored.get(path)]).toEqual([path, true]);
  });
});

describe('(integration) parserOptions.project covers scripts/ and packages/', () => {
  it('eslint lints a scripts/ and a packages/*/src/ sample with no coverage gap', () => {
    const samples = ['scripts/watch.mjs', 'packages/peaks-loop-mut/src/index.ts'];
    const results = eslintCli(samples);
    expect(results.length).toBe(samples.length);

    for (const result of results) {
      // A file eslint skipped is not a clean file — the same fail-closed rule
      // the husky gate applies. Both failure modes here are silent-by-default:
      // an uncovered file yields a fatal parse error, an ignored one yields a
      // warning, and either way "0 lint findings" would be a lie.
      expect([
        result.filePath,
        result.messages.filter((m) => COVERAGE_GAP_RE.test(m.message)).length
      ]).toEqual([result.filePath, 0]);
      expect([
        result.filePath,
        result.messages.filter((m) => IGNORED_RE.test(m.message)).length
      ]).toEqual([result.filePath, 0]);
    }
  });

  it('the ESLint-only tsconfig contains every tracked in-scope file', () => {
    // Wiring first: a perfect tsconfig that nothing points at covers nothing,
    // and without this assertion dropping the project entry is only caught by
    // the much slower CLI arm above.
    expect(loadConfig().parserOptions?.project).toContain(`./${LINT_TSCONFIG_REL}`);

    const abs = join(REPO_ROOT, LINT_TSCONFIG_REL);
    // Wrapped, not passed detached: `ts.sys.readFile` is a method, and handing
    // it over unbound trips @typescript-eslint/unbound-method (the tsconfig
    // hold this file lives in is scanned by the same rules as src/).
    const raw = ts.readConfigFile(abs, (filePath) => ts.sys.readFile(filePath));
    expect(raw.error).toBeUndefined();

    const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, dirname(abs));
    expect(parsed.errors.map((e) => e.messageText)).toEqual([]);

    // TypeScript's extension-priority pass drops a .mjs when a same-named
    // .d.mts exists, so this arm also covers the manually-listed files in
    // tsconfig.lint.json — a newly shadowed pair fails here.
    const separators = /\\/g;
    const norm = (p: string): string => p.replace(separators, '/').toLowerCase();
    const inProgram = new Set(parsed.fileNames.map(norm));
    const missing = trackedInScopeFiles().filter((f) => !inProgram.has(norm(join(REPO_ROOT, f))));
    expect(missing).toEqual([]);
  });

  // ARM 2 of 2 — a real gap must still be reported as one, or the arms above
  // are asserting that an always-empty check is empty.
  it('CONTROL: a file genuinely outside the project is still reported as a gap', () => {
    const [result] = eslintCli([KNOWN_UNCOVERED_FILE]);
    expect(result).toBeDefined();
    const gaps = (result?.messages ?? []).filter((m) => COVERAGE_GAP_RE.test(m.message));
    expect(gaps.length).toBeGreaterThan(0);
  });
});
