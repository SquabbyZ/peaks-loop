import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const FORBIDDEN_PATTERN =
  'drift-system|behavior-locker|anti-drift-dim|' +
  'golden-spec|reference-behavior|' +
  'invariant-test|behavior-assertion|' +
  'critical-journey|core-flow|' +
  'drift-free|' +
  'independent-review|cross-version-check';

const ROOTS = ['src', 'tests', '.peaks/standards'];
const SELF_PATH = 'tests/unit/standards/capability-glossary.test.ts';

describe("Scenario: capability-glossary", () => {
  it("when invoked, should does not use any forbidden alias anywhere under the project (excluding test self)", () => {
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
      [
        'grep',
        '-nI',
        '-E',
        FORBIDDEN_PATTERN,
        '--',
        ...ROOTS,
        `:!${SELF_PATH}`,
      ],
      { encoding: 'utf8' },
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
      `git grep exited with unexpected status ${result.status} (signal=${result.signal ?? 'none'}): ${stderr}`,
    );
  });
});
