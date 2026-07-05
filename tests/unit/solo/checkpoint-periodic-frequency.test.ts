/**
 * Slice 2026-06-24-efficiency-4p-bundle / G1 (P0.1)
 *
 * Locks the periodic checkpoint cadence at 20 tool calls. Pinned:
 *
 *   (a) SKILL.md "Step N: Periodic checkpoint" prose says "20 tool calls"
 *       and does NOT contain the legacy `~20` approximation.
 *   (b) `references/periodic-checkpoint.md` trigger table hard-codes
 *       `20` in the periodic row, and the "Skill recommendations"
 *       block likewise hard-codes `20`. No `~20` substring in either.
 *   (c) The CLI surface for `peaks session checkpoint` does NOT
 *       expose a `--periodic-every <n>` override flag — the cadence
 *       is owned by the SKILL.md, not the CLI.
 *   (d) The two docs (SKILL.md + periodic-checkpoint.md) agree on the
 *       number (no drift between the prose and the table).
 *
 * Coverage target: textual contract lock; ≥ 4 cases.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, '..', '..', '..');
const SKILL_PATH = join(REPO_ROOT, 'skills', 'peaks-code', 'SKILL.md');
const PERIODIC_REF_PATH = join(
  REPO_ROOT,
  'skills',
  'peaks-code',
  'references',
  'periodic-checkpoint.md'
);
const CHECKPOINT_CLI_PATH = join(
  REPO_ROOT,
  'src',
  'cli',
  'commands',
  'session-checkpoint-command.ts'
);

describe('AC-1.1 SKILL.md locks periodic checkpoint at 20 tool calls', () => {
  test('SKILL.md "Step N" prose contains "20 tool calls" and does NOT contain "~20 tool calls"', () => {
    const body = readFileSync(SKILL_PATH, 'utf8');
    // Locate the "Step N" section by anchor.
    const stepNMatch = body.match(/### Peaks-Loop Step N:[\s\S]*?(?=\n### |\n## |$)/);
    expect(stepNMatch).not.toBeNull();
    const stepN = stepNMatch![0];
    // The hard-coded cadence (no `~` approximation).
    expect(stepN).toContain('20 tool calls');
    expect(stepN).not.toContain('~20 tool calls');
  });
});

describe('AC-1.2 references/periodic-checkpoint.md locks the periodic trigger at 20', () => {
  test('trigger table hard-codes 20 (no "~20" approximation anywhere)', () => {
    const body = readFileSync(PERIODIC_REF_PATH, 'utf8');
    // Trigger table row for `periodic` must mention 20 and must NOT
    // contain the legacy `~20` tilde approximation.
    expect(body).toContain('Every 20 tool calls');
    expect(body).not.toMatch(/~20\s+tool\s+calls/);
    // Skill recommendations block likewise.
    expect(body).toMatch(/Every 20 tool calls[\s\S]*?--reason periodic/);
  });

  test('frequency lock callout is present (no override flag)', () => {
    const body = readFileSync(PERIODIC_REF_PATH, 'utf8');
    // The slice-2026-06-24-efficiency-4p-bundle lock callout must
    // exist and explicitly say there is no override flag.
    expect(body).toContain('hard-coded');
    expect(body).toContain('--periodic-every');
    expect(body).toContain('do NOT override');
  });
});

describe('AC-1.3 CLI does not expose a --periodic-every <n> override flag', () => {
  test('session-checkpoint-command.ts registers no --periodic-every option', () => {
    const cliBody = readFileSync(CHECKPOINT_CLI_PATH, 'utf8');
    // The CLI source must not register a `periodic-every` / `every`
    // override. The cadence is owned by the skill, not the CLI.
    expect(cliBody).not.toMatch(/periodic-every|--periodicEvery|periodicEvery/);
    // Sanity: the CLI does accept --reason (this is the documented
    // surface; we do NOT want a regression that drops it).
    expect(cliBody).toContain('--reason');
  });

  test('CLI --help does not surface --periodic-every', () => {
    // Source-level fallback: no help-text mention of the override.
    const cliBody = readFileSync(CHECKPOINT_CLI_PATH, 'utf8');
    expect(cliBody).not.toMatch(/--periodic-every/);

    // If a compiled CLI is available, the runtime help text must also
    // not mention it. We probe dist/cli/program.js when present and
    // fall back to the source assertion above when the build is not
    // available (CI runs `pnpm build` separately).
    const distProgram = join(REPO_ROOT, 'dist', 'cli', 'program.js');
    let helpBody = '';
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      helpBody = execFileSync('node', [distProgram, 'session', 'checkpoint', '--help'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: 'pipe',
      }) as string;
    } catch {
      helpBody = '';
    }
    if (helpBody.length > 0) {
      expect(helpBody).not.toMatch(/--periodic-every/);
    }
  });
});

describe('AC-1.3 (d) SKILL.md and periodic-checkpoint.md agree on the cadence', () => {
  test('both files cite "20 tool calls" and neither contains "~20"', () => {
    const skillBody = readFileSync(SKILL_PATH, 'utf8');
    const refBody = readFileSync(PERIODIC_REF_PATH, 'utf8');
    expect(skillBody).toContain('20 tool calls');
    expect(refBody).toContain('20 tool calls');
    expect(skillBody).not.toMatch(/~20\s+tool\s+calls/);
    expect(refBody).not.toMatch(/~20\s+tool\s+calls/);
  });
});