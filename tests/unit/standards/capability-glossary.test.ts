import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

const FORBIDDEN_PATTERN =
  'drift-system|behavior-locker|anti-drift-dim|' +
  'golden-spec|reference-behavior|' +
  'invariant-test|behavior-assertion|' +
  'critical-journey|core-flow|' +
  'drift-free|' +
  'independent-review|cross-version-check';

const ROOTS = ['src', 'tests', '.peaks/standards'];
const SELF_PATH = 'tests/unit/standards/capability-glossary.test.ts';

describe('Scenario: capability-glossary', () => {
  it(
    'when invoked, should does not use any forbidden alias anywhere under the project (excluding test self)',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: the test setup
      // when:  the function under test is invoked
      // then:  the result matches the expectation
      // Use pathspec exclusion `:!<path>` so the test file (which contains the literal
      // aliases as a string constant) is NOT scanned by `git grep`. This is the
      // cleanest form — we still scan every other repo surface.
      //
      // We use spawnSync so we can distinguish:
      //   - exit code 0  → matches found, stdout is the matches → FAIL
      //   - exit code 1  → no matches found                        → PASS
      //   - exit code >=2 → git error (bad rev, missing path, …)  → FAIL with stderr surfaced
      // Previously a broad try/catch swallowed the throw on exit 1, but the same catch
      // would also have hidden a real git failure or a real matches-found result.
      const result = spawnSync(
        'git',
        ['grep', '-nI', '-E', FORBIDDEN_PATTERN, '--', ...ROOTS, `:!${SELF_PATH}`],
        { encoding: 'utf8', windowsHide: true }
      );

      if (result.error) {
        // Spawn-level failure (ENOENT for `git`, etc.) — propagate.
        throw result.error;
      }

      const stdout = result.stdout ?? '';
      const stderr = result.stderr ?? '';

      if (result.status === 1) {
        // No matches found — this is the success case.
        expect(stdout).toBe('');
        return;
      }

      if (result.status === 0) {
        // Matches found — FAIL with the offending lines.
        expect(stdout, `Forbidden aliases found in repo:\n${stdout}`).toBe('');
        return;
      }

      // Any other exit status (git error): surface stderr so we don't fake-green.
      throw new Error(
        `git grep exited with unexpected status ${result.status} (signal=${result.signal ?? 'none'}): ${stderr}`
      );
    }
  );

  it(
    'when a forbidden alias IS in the input, the same invocation reports it (the self-check)',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // The negative arm for the "weakened, not deleted" shape.
      //
      // The assertion above can only ever say "no matches found" — which is
      // exactly what a pattern that matches nothing also says. Measured
      // 2026-09-18 (slice rid-c2-mutation-control-audit): replacing
      // FORBIDDEN_PATTERN with a never-matching literal kept this file's sole
      // `it` green. A check that cannot notice its own pattern going dead is the
      // same defect as the commented-out `.gitignore` rule that
      // `top-level-change-id-guard.test.ts` ships an anti-control for.
      //
      // The control drives `FORBIDDEN_PATTERN` through `git grep` — the same
      // pattern and the same tool as the live check, so it covers the pattern
      // AND the invocation. It does not restate the live check: that one reads
      // the repository, this one reads a fixture whose verdict is known.
      const dir = mkdtempSync(join(tmpdir(), 'peaks-glossary-control-'));
      try {
        writeFileSync(join(dir, 'offending.ts'), 'const x = 1; // drift-system\n', 'utf8');
        writeFileSync(join(dir, 'clean.ts'), 'const x = 1; // an ordinary comment\n', 'utf8');

        // `cwd` is the fixture dir and the paths are relative to it: `git grep`
        // refuses a path outside the repository even with `--no-index`
        // (measured: exit 128, "is outside repository at 'D:/peaks-loop'").
        // Running from the fixture dir means there is no repository to be
        // outside of.
        const run = (paths: readonly string[]): { status: number | null; stdout: string } => {
          const result = spawnSync(
            'git',
            ['grep', '--no-index', '-nI', '-E', FORBIDDEN_PATTERN, '--', ...paths],
            { cwd: dir, encoding: 'utf8', windowsHide: true }
          );
          return { status: result.status, stdout: result.stdout ?? '' };
        };

        const caught = run(['offending.ts']);
        expect(caught.status, 'a forbidden alias in the input must be FOUND (exit 0)').toBe(0);
        expect(caught.stdout).toContain('drift-system');

        const spared = run(['clean.ts']);
        expect(spared.status, 'a clean input must be SPARED (exit 1)').toBe(1);
        expect(spared.stdout).toBe('');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );
});
