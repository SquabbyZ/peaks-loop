/**
 * no-magic-numbers-config — BDD cover for PRD-002b slice 2 config tune.
 *
 * Asserts the `no-magic-numbers` rule is wired into the
 * `.peaks-rules.cjs` ESLint bundle with the documented ignore list
 * + boolean options, at the `warn` severity (per D5 no-touch-stockcode
 * invariant — severity promotion to error is forbidden today).
 *
 * Read-only smoke test: the rule's `meta.fixable` is absent (no
 * auto-rewrite for inline numeric literals), so a sample file with
 * magic-number usage surfaces warnings without changing the
 * application semantics.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..');
const CONFIG_PATH = join(ROOT, 'config', 'eslint', '.peaks-rules.cjs');
const ESLINT_BIN = join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js');

function loadConfig(): Record<string, unknown> {
  // Clear Node's require cache so the test sees the current file even
  // after a fresh install / re-write.
  delete require.cache[CONFIG_PATH];
  const mod = require(CONFIG_PATH) as Record<string, unknown>;
  return mod;
}

describe('PRD-002b slice 2 — no-magic-numbers rule wire-confirmation', () => {
  it('config/eslint/.peaks-rules.cjs is reachable', () => {
    expect(existsSync(CONFIG_PATH)).toBe(true);
  });

  it('rule is registered with severity=warn (NOT error) per D5 invariant', () => {
    const mod = loadConfig();
    const rules = mod.rules as Record<string, unknown>;
    expect(rules['no-magic-numbers']).toBeDefined();
    const ruleEntry = rules['no-magic-numbers'] as unknown[];
    expect(Array.isArray(ruleEntry)).toBe(true);
    expect(ruleEntry[0]).toBe('warn');
    // Guard against accidental severity promotion to error.
    expect(ruleEntry[0]).not.toBe('error');
  });

  it('ignore list contains the documented values (-1, 0, 1, 2, 100, 1000)', () => {
    const mod = loadConfig();
    const rules = mod.rules as Record<string, unknown>;
    const ruleEntry = rules['no-magic-numbers'] as unknown[];
    expect(Array.isArray(ruleEntry)).toBe(true);
    const options = ruleEntry[1] as { ignore: readonly number[]; ignoreArrayIndexes?: boolean; ignoreDefaultValues?: boolean };
    expect(options.ignore).toEqual(expect.arrayContaining([-1, 0, 1, 2, 100, 1000]));
    // Sort-stable comparison (rule object may be authored with a different order).
    const sortedIgnore = [...options.ignore].sort((a, b) => a - b);
    expect(sortedIgnore).toEqual([-1, 0, 1, 2, 100, 1000]);
  });

  it('boolean options (ignoreArrayIndexes, ignoreDefaultValues) are both true', () => {
    const mod = loadConfig();
    const rules = mod.rules as Record<string, unknown>;
    const ruleEntry = rules['no-magic-numbers'] as unknown[];
    const options = ruleEntry[1] as { ignoreArrayIndexes?: boolean; ignoreDefaultValues?: boolean };
    expect(options.ignoreArrayIndexes).toBe(true);
    expect(options.ignoreDefaultValues).toBe(true);
  });

  it('rule meta has NO `fixable` field (auto-fix is a no-op for this rule)', () => {
    // ESLint 8.57.1 rule meta — the runner preflight forbids --fix for
    // any rule whose meta has no `fixable` field. Confirm by reading
    // the upstream rule file the runner uses.
    const ruleSrc = readFileSync(
      join(ROOT, 'node_modules', 'eslint', 'lib', 'rules', 'no-magic-numbers.js'),
      'utf8'
    );
    expect(ruleSrc).toContain('module.exports = {');
    expect(ruleSrc).toContain('meta:');
    expect(ruleSrc).not.toMatch(/fixable:\s*['"]/);
  });

  it('test file override disables the rule for tests/** (line 117 carve-out)', () => {
    const mod = loadConfig();
    const overrides = mod.overrides as Array<{ files: readonly string[]; rules: Record<string, string> }>;
    const testOverride = overrides.find((o) => o.files.includes('tests/**/*.ts') || o.files.includes('*.test.ts'));
    expect(testOverride).toBeDefined();
    expect(testOverride?.rules['no-magic-numbers']).toBe('off');
  });

  it('rule fires as warn (severity=1) on existing src/utilities magic numbers above the ignore ceiling', () => {
    if (!existsSync(ESLINT_BIN)) {
      // Skip gracefully when ESLint binary is not installed (CI sandbox
      // preinstall may have stripped devDeps). The unit test surface
      // for the rule schema above is sufficient contract coverage.
      return;
    }
    // Use a real, repo-tracked source file whose content already has
    // large numeric literals (above the 1000 ignore ceiling). This
    // guarantees the file is part of the tsconfig project so the
    // type-aware parser resolves it; no tmp dir / parser error fallback.
    const candidate = join(ROOT, 'src', 'services', 'lint', 'eslint-runner.ts');
    const result = spawnSync(process.execPath, [ESLINT_BIN, '--format', 'json', '--config', CONFIG_PATH, candidate], {
      encoding: 'utf8',
      cwd: ROOT
    });
    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    expect(stdout.length).toBeGreaterThan(0);
    const parsed = JSON.parse(stdout) as Array<{
      filePath: string;
      messages: Array<{ ruleId: string | null; severity: number }>;
    }>;
    const row = parsed.find((r) => r.filePath.endsWith('eslint-runner.ts'));
    const magicHits = row?.messages.filter((m) => m.ruleId === 'no-magic-numbers') ?? [];
    expect(magicHits.length).toBeGreaterThan(0);
    // severity 1 = warn in ESLint. The contract test forbids error (severity 2).
    for (const hit of magicHits) {
      expect(hit.severity).toBe(1);
      expect(hit.severity).not.toBe(2);
    }
  });
});
