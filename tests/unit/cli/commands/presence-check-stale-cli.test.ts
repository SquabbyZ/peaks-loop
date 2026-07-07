/**
 * v2.15.0 slice 002 — CLI-level repair tests for QA blockers #1 + #2.
 *
 * #1 — `peaks skill presence:check-stale` always reported
 *      `stale: true` because the action handler passed
 *      `currentOuter: options.currentOuter` (which is `undefined`
 *      when commander omits the flag, but the key IS in opts). The
 *      service-layer guard `'currentOuter' in opts` then picked the
 *      explicit-undefined value, bypassing the env-var fallback.
 *      Fix: build a sparse opts object so the env-var resolution
 *      fires. Verify: matching env var → `stale: false`, NOT
 *      matching → `stale: true`, omitted flag → env-fallback path.
 *
 * #2 — `peaks code should-pause` lacked a CLI seam for the
 *      commit-boundary hard-floor. The service-layer accepts
 *      `commitBoundaryAction: true` but the CLI never wired it
 *      through. Fix: `--commit-boundary-action <id>` flag,
 *      validated against `COMMIT_BOUNDARY_ACTIONS`. Verify: each
 *      action id forces a hard-floor pause regardless of mode.
 *
 * Five cases (3 for #1 + 2 for #2; the PRD's "≥5 cases" AC-4 floor
 * plus regression for the CLI smoke).
 */

import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCommand, parseJsonOutput } from '../../cli-program-test-utils.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-check-stale-cli-'));
  // CLI defaults cwd to project root when --project is omitted, but
  // we always pass --project explicitly to keep the test hermetic.
});

afterEach(() => {
  try {
    process.chdir(tmpdir());
  } catch {
    // best effort
  }
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
});

/**
 * Helper: write a presence JSON to the project root with the given
 * outer session id. We bypass `setSkillPresence` because that
 * helper reads from process.env at test time, which makes the test
 * non-hermetic.
 */
function writePresence(root: string, outerSessionId: string): void {
  const path = join(root, '.peaks', '_runtime', 'active-skill.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({
    skill: 'peaks-code',
    mode: 'full-auto',
    gate: 'startup',
    sessionId: '2026-06-28-session-test',
    outerSessionId,
    setAt: '2026-06-28T10:00:00.000Z',
    lastHeartbeat: '2026-06-28T10:00:00.000Z'
  }, null, 2), 'utf8');
}

describe('peaks skill presence:check-stale — CLI repair (QA blocker #1)', () => {
  it('1. matching CLAUDE_CODE_SESSION_ID → stale: false, currentOuterSessionId echoed', async () => {
    writePresence(root, 'outer-MATCH');
    const { stdout } = await runCommand(
      ['skill', 'presence:check-stale', '--project', root, '--json'],
      { CLAUDE_CODE_SESSION_ID: 'outer-MATCH' }
    );
    const parsed = parseJsonOutput<{
      stale: boolean;
      reason: string | null;
      currentOuterSessionId: string;
      recordedOuterSessionId: string;
    }>(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.stale).toBe(false);
    expect(parsed.data.reason).toBeNull();
    expect(parsed.data.currentOuterSessionId).toBe('outer-MATCH');
    expect(parsed.data.recordedOuterSessionId).toBe('outer-MATCH');
  });

  it('2. non-matching CLAUDE_CODE_SESSION_ID → stale: true, both ids echoed', async () => {
    writePresence(root, 'outer-OLD');
    const { stdout } = await runCommand(
      ['skill', 'presence:check-stale', '--project', root, '--json'],
      { CLAUDE_CODE_SESSION_ID: 'outer-NEW' }
    );
    const parsed = parseJsonOutput<{
      stale: boolean;
      reason: string | null;
      currentOuterSessionId: string;
      recordedOuterSessionId: string;
    }>(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.stale).toBe(true);
    expect(parsed.data.reason).toBe('outer-session-mismatch');
    expect(parsed.data.currentOuterSessionId).toBe('outer-NEW');
    expect(parsed.data.recordedOuterSessionId).toBe('outer-OLD');
  });

  it('3. --current-outer flag overrides env-var resolution (test seam still works)', async () => {
    writePresence(root, 'outer-RECORDED');
    // Env says NEW, but the flag forces the CLI to use OVERRIDE.
    const { stdout } = await runCommand(
      ['skill', 'presence:check-stale', '--project', root, '--current-outer', 'outer-OVERRIDE', '--json'],
      { CLAUDE_CODE_SESSION_ID: 'outer-NEW' }
    );
    const parsed = parseJsonOutput<{
      stale: boolean;
      currentOuterSessionId: string;
      recordedOuterSessionId: string;
    }>(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.stale).toBe(true);
    expect(parsed.data.currentOuterSessionId).toBe('outer-OVERRIDE');
    expect(parsed.data.recordedOuterSessionId).toBe('outer-RECORDED');
  });
});

describe('peaks code should-pause --commit-boundary-action — CLI repair (QA blocker #2)', () => {
  it('4. --commit-boundary-action git-push + full-auto → hard-floor pause (gateKind=hard-floor)', async () => {
    const { stdout } = await runCommand([
      'code', 'should-pause',
      '--commit-boundary-action', 'git-push',
      '--mode', 'full-auto',
      '--step', 'phase-10-txt-memory-extract',
      '--project', root,
      '--json'
    ], {});
    const parsed = parseJsonOutput<{
      shouldPause: boolean;
      gateKind: string;
      hardFloorCategory?: string;
      commitBoundaryAction?: string;
    }>(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.shouldPause).toBe(true);
    expect(parsed.data.gateKind).toBe('hard-floor');
    expect(parsed.data.hardFloorCategory).toBe('commit-boundary-side-effect');
    expect(parsed.data.commitBoundaryAction).toBe('git-push');
  });

  it('5. --commit-boundary-action npm-publish + assisted → still hard-floor pause (override wins over mode)', async () => {
    const { stdout } = await runCommand([
      'code', 'should-pause',
      '--commit-boundary-action', 'npm-publish',
      '--mode', 'assisted',
      '--step', 'phase-10-txt-memory-extract',
      '--project', root,
      '--json'
    ], {});
    const parsed = parseJsonOutput<{
      shouldPause: boolean;
      gateKind: string;
      commitBoundaryAction?: string;
    }>(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.shouldPause).toBe(true);
    expect(parsed.data.gateKind).toBe('hard-floor');
    expect(parsed.data.commitBoundaryAction).toBe('npm-publish');
  });

  it('6. unknown --commit-boundary-action id → INVALID_COMMIT_BOUNDARY_ACTION', async () => {
    const { stdout, exitCode } = await runCommand([
      'code', 'should-pause',
      '--commit-boundary-action', 'rm-rf-everything',
      '--mode', 'full-auto',
      '--step', 'phase-10-txt-memory-extract',
      '--project', root,
      '--json'
    ], {});
    const parsed = parseJsonOutput(stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('INVALID_COMMIT_BOUNDARY_ACTION');
    expect(exitCode).toBe(1);
  });

  it('7. no --commit-boundary-action flag + full-auto + non-Step-1 step → auto-proceed (regression)', async () => {
    // Sanity check that adding the new flag did not regress the
    // existing auto-proceed path.
    const { stdout } = await runCommand([
      'code', 'should-pause',
      '--mode', 'full-auto',
      '--step', 'phase-2-prd-confirm',
      '--project', root,
      '--json'
    ], {});
    const parsed = parseJsonOutput<{
      shouldPause: boolean;
      gateKind: string;
    }>(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.shouldPause).toBe(false);
    expect(parsed.data.gateKind).toBe('mode-driven');
  });
});