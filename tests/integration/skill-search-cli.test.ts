/**
 * peaks skill search — integration tests.
 *
 * Slice S0 (4.0.0-beta.5 — peaks-solo dispatcher CLI primitive).
 * Spec: docs/superpowers/specs/2026-07-08-peaks-solo-dispatcher-design.md §3.2
 * Plan: docs/superpowers/plans/2026-07-08-peaks-solo-dispatcher/s0-skill-search-cli.md
 *
 * In-process CLI invocation (see tests/integration/_cli-helper.ts);
 * replaces the previous `execFileSync(TSX, ...)` spawn which became
 * the dominant cost under vitest single-fork full-suite execution
 * on Windows (`Test timed out in 120000ms` for the I-1 path despite
 * per-test runs completing in <2s).
 *
 * Asserts the locked contract from the plan §"API Contract" table:
 *   - Exit 0 + JSON array on success (even on no-match)
 *   - Exit 1 + Zod message on invalid args
 *   - Exit 0 with non-empty result on --query "code"
 *   - HC-10: peaks-code / peaks-content / peaks-doctor still work
 */
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { runCli } from './_cli-helper.js';

const REPO_ROOT = resolve(__dirname, '..', '..');

function cli(args: string[]) {
  return runCli(args, REPO_ROOT);
}

describe('peaks skill search — CLI integration (S0)', () => {
  test('I-1: CLI exits 0 with JSON array; result contains peaks-code', async () => {
    const result = await cli(['skill', 'search', '--query', 'code']);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    const parsed = JSON.parse(result.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    const names = parsed.map((r: { name: string }) => r.name);
    expect(names).toContain('peaks-code');
  });

  test('I-2: CLI exits 0 with empty array on no-match', async () => {
    const result = await cli(['skill', 'search', '--query', 'xxxxxxxxxxxxx']);
    expect(result.code).toBe(0);
    // stdout may have a trailing newline; trim before parsing.
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed).toEqual([]);
  });

  test('I-3: CLI exits 1 on invalid args (no filter)', async () => {
    const result = await cli(['skill', 'search']);
    expect(result.code).toBe(1);
    // The Zod error message must be on stderr (plan §"API Contract"
    // exit code 1 path: "invalid args (Zod validation fail)").
    expect(result.stderr).toMatch(/At least one of/);
  });

  test('I-4: CLI exits 0 with --tag filter; output is a JSON array (may be empty when no skill has tags)', async () => {
    const result = await cli(['skill', 'search', '--tag', 'orchestrator']);
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    // When a tag matches no skill (current SKILL.md frontmatter does
    // not carry metadata.tags), the array is empty; that is still
    // a valid v1 contract.
    if (parsed.length > 0) {
      for (const r of parsed as Array<{ tags: string[] }>) {
        expect(r.tags).toContain('orchestrator');
      }
    }
  });

  test('I-5 (Slice 2 AC2.4): peaks skill list excludes visibility:internal skills by default', async () => {
    const list = await cli(['skill', 'list']);
    expect(list.code).toBe(0);
    expect(list.stdout).toContain('peaks-code');
    expect(list.stdout).toContain('peaks-content');
    // Row-level check: peaks-doctor must NOT appear as its own list row.
    // A naive substring check would also match the peaks-solo description
    // body (which lists peaks-doctor as a dispatch leaf) — anchor on the
    // `  peaks-doctor ` row prefix (two-space indent + name + space).
    expect(list.stdout).not.toMatch(/^ {2}peaks-doctor\s/m);
  });

  test('I-6 (Slice 2 AC2.5): peaks skill list --include-internal includes visibility:internal skills', async () => {
    const list = await cli(['skill', 'list', '--include-internal']);
    expect(list.code).toBe(0);
    expect(list.stdout).toContain('peaks-code');
    expect(list.stdout).toContain('peaks-doctor');
  });

  test('I-7 (Slice 2 AC2.6): peaks skill search hides visibility:internal unless --include-internal', async () => {
    const hidden = await cli(['skill', 'search', '--query', 'doctor']);
    expect(hidden.code).toBe(0);
    const hiddenNames = JSON.parse(hidden.stdout).map((r: { name: string }) => r.name);
    expect(hiddenNames).not.toContain('peaks-doctor');

    const included = await cli(['skill', 'search', '--query', 'doctor', '--include-internal']);
    expect(included.code).toBe(0);
    const includedNames = JSON.parse(included.stdout).map((r: { name: string }) => r.name);
    expect(includedNames).toContain('peaks-doctor');
  });

  test('I-8 (HC-10 + Slice 2 AC2.8): peaks skill runbook + presence still work', async () => {
    const runbook = await cli(['skill', 'runbook', 'peaks-code']);
    expect(runbook.code).toBe(0);
    const presence = await cli(['skill', 'presence']);
    expect(presence.code).toBe(0);
  });
});
