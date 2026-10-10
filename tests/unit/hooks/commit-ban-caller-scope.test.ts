// tests/unit/hooks/commit-ban-caller-scope.test.ts
//
// The defect this pins is NOT that the callerId filter is broken — it works,
// and `active-skill-resolver.test.ts` guards it. The defect is that the hook
// call site never passes a callerId, so "who is driving" is answered with
// whichever lease `readdirSync` yields first, which may belong to another
// caller in the same peaks session.
//
// Where the ban actually runs: `evaluateCodeBan` has exactly one call site,
// `hook-handle.ts:133`, reachable only through `peaks hook handle`
// (trae / cursor / codex per HOOK_COMMAND_BY_IDE). So this test drives that
// entry — a test of the resolver alone could not observe this defect.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { setPresenceLease } from '~/src/services/skills/presence-lease-service';

const ROOT = resolve(__dirname, '..', '..', '..');
const SESSION = '2026-10-10-session-s0test';

const tmpRoots: string[] = [];

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-caller-scope-'));
  tmpRoots.push(root);
  const runtime = join(root, '.peaks', '_runtime');
  mkdirSync(runtime, { recursive: true });
  writeFileSync(
    join(runtime, 'session.json'),
    JSON.stringify({ sessionId: SESSION, createdAt: new Date().toISOString(), projectRoot: root })
  );
  return root;
}

function writeLease(root: string, callerId: string, skill: string): void {
  setPresenceLease({
    projectRoot: root,
    sessionId: SESSION,
    callerId,
    workflowId: callerId,
    graphRef: `graphs/${callerId}.json`,
    skill
  });
}

/** A `git commit` payload from caller-b — the caller the question is about. */
const COMMIT_PAYLOAD = JSON.stringify({
  tool_name: 'Bash',
  tool_input: { command: 'git commit -m "fix: something"' },
  session_id: 'caller-b'
});

function runHookHandle(root: string, stdin: string): { status: number | null; stdout: string } {
  const run = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      join(ROOT, 'src', 'cli', 'index.ts'),
      'hook',
      'handle',
      '--project',
      root,
      '--json'
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root, PEAKS_HOOK_STDIN: stdin }
    }
  );
  return { status: run.status, stdout: run.stdout ?? '' };
}

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

describe('commit ban — caller scoping', () => {
  it('does not ban a commit for a caller that has no peaks lease of its own', () => {
    const root = makeProject();
    // Another caller in the SAME peaks session is running peaks-code.
    writeLease(root, 'caller-a', 'peaks-code');

    const { status, stdout } = runHookHandle(root, COMMIT_PAYLOAD);

    // The commit is asked about caller-b, which has no peaks skill. Resolving
    // caller-a's lease instead would ban it.
    expect(status).not.toBe(2);
    expect(stdout).not.toContain('Code Commit Ban');
  });

  // Task 4. With no identity in the payload the resolver cannot be asked at
  // all — asking without a callerId returns whichever lease comes first,
  // which is the guessing this slice removes. The ambiguous case is decided
  // by `evaluateCodeBan` instead.
  it('bans an unattributable commit while a peaks lease is present', () => {
    const root = makeProject();
    writeLease(root, 'caller-a', 'peaks-code');

    // No `session_id` / `caller_id` — the shape `parseTraeShapeStdin` yields,
    // and the adapters where this ban actually runs.
    const { stdout } = runHookHandle(
      root,
      JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git commit -m "fix: x"' } })
    );

    expect(stdout).toContain('could not be identified');
  });

  it('allows an unattributable commit when no peaks lease exists', () => {
    // Review Focus #1: an ordinary session must not be blocked just because
    // the gate is installed.
    const root = makeProject();

    const { stdout } = runHookHandle(
      root,
      JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git commit -m "fix: x"' } })
    );

    expect(stdout).not.toContain('Code Commit Ban');
  });
});
