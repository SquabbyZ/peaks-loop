/**
 * Regression guard (rid-034 U9): no `next = 'peaks session auto-compact …'`
 * LLM-pointer field remains in `src/cli/commands/code-runtime-commands.ts`.
 *
 * The v2.13.0 zero-pause contract retired `peaks session auto-compact-hook`
 * and `peaks session auto-compact --execute`. The replacement is the
 * `peaks compact auto` family (`peaks compact auto --execute` /
 * `peaks compact auto --json`).
 *
 * The dangerous LLM-pointer `next` field surfaces in
 * `peaks code context-now` JSON envelopes; if the field references a
 * retired command, the LLM will issue a stale call and stall the
 * zero-pause contract.
 *
 * This guard uses `git grep -nE` so it respects `.gitignore` and matches
 * the same way the audit red-lines enforcer walks the tree.
 */
import { execSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';

const CODE_RUNTIME_COMMANDS = 'src/cli/commands/code-runtime-commands.ts';

describe('code-runtime-commands.ts — retired LLM-pointer `next` field ban', () => {
  test('no `next = "peaks session auto-compact …"` remains in code-runtime-commands.ts', () => {
    let stdout = '';
    try {
      stdout = execSync(
        'git',
        ['grep', '-nE', '--', "next\\s*=\\s*['\"]peaks session auto-compact", CODE_RUNTIME_COMMANDS],
        { encoding: 'utf8', shell: 'bash' }
      );
    } catch (error: unknown) {
      // git grep exits 1 when there are no matches; that's the PASS case.
      expect((error as { status?: number }).status).toBe(1);
      return;
    }
    throw new Error(
      `code-runtime-commands.ts still references retired CLI in \`next\` field: ${stdout}`
    );
  });

  test('replacement `peaks compact auto --execute` IS present in code-runtime-commands.ts', () => {
    let stdout = '';
    try {
      stdout = execSync(
        'git grep -nF -- "peaks compact auto --execute" ' + CODE_RUNTIME_COMMANDS,
        { encoding: 'utf8', shell: 'bash' }
      );
    } catch (error: unknown) {
      // Should NOT exit 1 — the replacement string must be present.
      throw new Error(
        `code-runtime-commands.ts does not reference the v2.13.0 replacement string 'peaks compact auto --execute': ` +
          `git grep exit=${(error as { status?: number }).status}; stdout='${stdout}'`
      );
    }
    expect(stdout.length).toBeGreaterThan(0);
  });
});