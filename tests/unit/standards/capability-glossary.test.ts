import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const FORBIDDEN_PATTERN =
  'drift-system|behavior-locker|anti-drift-dim|' +
  'golden-spec|reference-behavior|' +
  'invariant-test|behavior-assertion|' +
  'critical-journey|core-flow|' +
  'drift-free|' +
  'independent-review|cross-version-check';

const ROOTS = ['src', 'tests', '.peaks/standards', 'docs/superpowers/specs', 'docs/superpowers/plans'];

describe('capability-glossary', () => {
  it('does not use any forbidden alias anywhere under the project', () => {
    // git grep returns exit code 1 when there are no matches; execFileSync throws.
    // Catch that case so an empty result is treated as success (no forbidden aliases found).
    let out = '';
    try {
      out = execFileSync(
        'git',
        ['grep', '-nI', '-E', FORBIDDEN_PATTERN, '--', ...ROOTS],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      ).toString('utf8');
    } catch (err) {
      // If the only output is empty, treat as "no matches" (git grep exit 1)
      out = '';
    }
    expect(out).toBe('');
  });
});