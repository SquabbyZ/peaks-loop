/**
 * S3 dogfood — peaks-solo dispatcher end-to-end on the canonical
 * 4.0.0-beta.5 use case ("获取当天的 GitHub 排名前 10 的代码仓的信息").
 *
 * Slice: S3 of 4.0.0-beta.5 (peaks-solo dispatcher release).
 * Spec: docs/superpowers/specs/2026-07-08-peaks-solo-dispatcher-design.md §1.1, §3.5
 * Plan: docs/superpowers/plans/2026-07-08-peaks-solo-dispatcher/s3-dogfood.md
 * Decision memo: .peaks/memory/user-decision-2026-07-08-revive-peaks-solo-as-dispatcher.md
 *
 * Verifies the dispatcher + `peaks skill search` CLI primitive (S0) +
 * peaks-solo SKILL.md (S1) + surface wiring (S2) compose into a working
 * dogfood flow on a query that has no peak-* skill match.
 *
 * Runs the CLI as a child process (mirrors
 * `tests/integration/skill-search-cli.test.ts` and
 * `tests/integration/asset-crystallize-cli.test.ts` patterns).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..');
const TSX_BIN = resolve(REPO_ROOT, 'node_modules', '.pnpm', 'tsx@4.22.0', 'node_modules', 'tsx', 'dist', 'cli.mjs');
const CLI_ENTRY = resolve(REPO_ROOT, 'src', 'cli', 'index.ts');

function cli(args: string[]): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execFileSync(process.execPath, [TSX_BIN, CLI_ENTRY, ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout: string | Buffer; stderr: string | Buffer; status: number };
    return {
      stdout: typeof e.stdout === 'string' ? e.stdout : e.stdout?.toString() ?? '',
      stderr: typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString() ?? '',
      code: e.status ?? 1,
    };
  }
}

type SkillSearchResult = {
  name: string;
  description: string;
  triggers: string[];
  tags: string[];
  domain: string;
  matchScore: number;
};

function parseSearch(stdout: string): SkillSearchResult[] {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return [];
  return JSON.parse(trimmed) as SkillSearchResult[];
}

/**
 * "Meaningful" match threshold for peaks skill search v1.
 *
 * The S0 substring-scoring model (see src/services/skill/skill-search-service.ts
 * §scoreQuery) clamps to [0, 1] and is sensitive to description length.
 * For a positive-case query ("code" → peaks-code) the top score is
 * ~0.28; for noise hits ("github" → peaks-sc with one accidental
 * substring hit on a long description) the top score is ~0.012. A
 * 0.05 threshold cleanly separates "real match" from "noise match",
 * which is the dispatcher's actual triage signal: peaks-solo's SKILL.md
 * §3 routes a query to the leaf when the top match is meaningful,
 * otherwise it falls back to self-planning.
 */
const MEANINGFUL_MATCH_SCORE = 0.05;

describe('peaks-solo dispatcher flow — dogfood: 获取 GitHub top 10', () => {
  test('T-1: peaks-solo is registered in the skill pool', () => {
    const result = cli(['skill', 'list']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('peaks-solo');
  });

  test('T-2: peaks-solo SKILL.md frontmatter has Dispatcher role + NOT clause for all 5 leaves', () => {
    const skillPath = resolve(REPO_ROOT, 'skills/peaks-solo/SKILL.md');
    expect(existsSync(skillPath)).toBe(true);
    const skill = readFileSync(skillPath, 'utf8');
    // Dispatcher role is declared in the description block.
    expect(skill).toMatch(/description:[\s\S]*?Dispatcher/);
    // NOT clause must list all 5 leaf skills (per locked plan §API Contract).
    expect(skill).toContain('NOT for');
    expect(skill).toContain('/peaks-code');
    expect(skill).toContain('/peaks-content');
    expect(skill).toContain('/peaks-doctor');
    expect(skill).toContain('/peaks-issue-fix-orchestrator');
    expect(skill).toContain('/peaks-sop');
  });

  test('T-3: peaks skill search for "github" returns no MEANINGFUL match (zero-candidate path → self-plan)', () => {
    // Dogfood scenario: "GitHub top 10" has no peak-* skill that
    // meaningfully handles it. The dispatcher's SKILL.md §3 routes a
    // zero-meaningful-match to self-planning fallback. We assert the
    // dispatcher signal: top matchScore below threshold = noise.
    const result = cli(['skill', 'search', '--query', 'github']);
    expect(result.code).toBe(0);
    const parsed = parseSearch(result.stdout);
    expect(parsed.length).toBeGreaterThan(0); // S0 returns substring hits, not literal zero
    // No peak-* skill has a meaningful score for "github".
    const meaningful = parsed.filter((s) => s.matchScore >= MEANINGFUL_MATCH_SCORE);
    expect(meaningful.length).toBe(0);
    // Top score is noise level (well below 0.05).
    expect(parsed[0]!.matchScore).toBeLessThan(MEANINGFUL_MATCH_SCORE);
  });

  test('T-4: peaks skill search for "code" returns peaks-code (positive case, threshold crossed)', () => {
    const result = cli(['skill', 'search', '--query', 'code']);
    expect(result.code).toBe(0);
    const parsed = parseSearch(result.stdout);
    const names = parsed.map((s) => s.name);
    expect(names).toContain('peaks-code');
    // Positive case: top score is meaningfully above threshold.
    expect(parsed[0]!.matchScore).toBeGreaterThanOrEqual(MEANINGFUL_MATCH_SCORE);
    expect(parsed[0]!.name).toBe('peaks-code');
  });

  test('T-5: peaks-solo SKILL.md references ≥ 1 fallback tool (deep-search / WebSearch / Bash / Edit)', () => {
    const skillPath = resolve(REPO_ROOT, 'skills/peaks-solo/SKILL.md');
    const skill = readFileSync(skillPath, 'utf8');
    expect(/deep-search|WebSearch|Bash|Edit/.test(skill)).toBe(true);
  });

  test('T-6: sediment-prompt-template.md has 4 options (a)/(b)/(c)/(d) + default is NOT (d)', () => {
    const tplPath = resolve(REPO_ROOT, 'skills/peaks-solo/references/sediment-prompt-template.md');
    expect(existsSync(tplPath)).toBe(true);
    const tpl = readFileSync(tplPath, 'utf8');
    // 4-option template: (a) lesson / (b) loop engineering / (c) change scope / (d) don't sediment.
    expect(tpl).toMatch(/\(a\)/);
    expect(tpl).toMatch(/\(b\)/);
    expect(tpl).toMatch(/\(c\)/);
    expect(tpl).toMatch(/\(d\)/);
    // HC-9: default must NOT be (d) — sediment is encouraged.
    // The template explicitly states "默认推荐 = (a)".
    expect(tpl).toMatch(/默认推荐\s*=\s*\(a\)/);
    expect(tpl).not.toMatch(/默认推荐\s*=\s*\(d\)/);
  });

  test('T-7: S0+S1+S2 regression scope is green (no regressions introduced)', () => {
    // Run the locked regression scope of S0 (skill-search) + S1
    // (peaks-solo) + S2 (surface) per S3 brief §Workflow step 12.
    // The full `pnpm vitest run` is the main-session final gate
    // (HC-6); S3's T-7 asserts the focused scope is green, which
    // is sufficient for HC-4 (no fake green) since the scope
    // covers every test file the S0/S1/S2 slices authored.
    //
    // We invoke vitest via `process.execPath` + absolute path to
    // vitest's `dist/cli.js` rather than via the `node_modules/.bin`
    // shim, because the shim is a `.cmd` wrapper that is not
    // resolvable by `execFileSync` without a shell on Windows.
    // We also pass `--exclude tests/integration/dispatcher-flow.test.ts`
    // so the recursive run does not re-enter this file.
    const require = createRequire(import.meta.url);
    const vitestCli = dirname(require.resolve('vitest', { paths: [REPO_ROOT] })) +
      '/dist/cli.js';
    const scope = [
      'tests/unit/skill-search.test.ts',
      'tests/unit/peaks-solo.test.ts',
      'tests/unit/skill-registry.test.ts',
      'tests/unit/skill-browser-workflow.test.ts'
    ];
    const result = execFileSync(
      process.execPath,
      [
        vitestCli,
        'run',
        '--reporter=dot',
        '--exclude',
        'tests/integration/dispatcher-flow.test.ts',
        ...scope,
      ],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 64 * 1024 * 1024,
      }
    );
    // Strip ANSI escape codes so the summary assertions are
    // robust against the terminal-color codes vitest emits when
    // its stdout is a TTY (and even when it is not).
    const plain = result.replace(/\x1b\[[0-9;]*m/g, '');
    // Final assertion: a fully-green run prints a "Tests  N passed"
    // summary line with N > 0.
    expect(plain).toMatch(/Tests\s+\d+\s+passed/);
    // No failing markers.
    expect(plain).not.toMatch(/\d+\s+failed/);
  });
});