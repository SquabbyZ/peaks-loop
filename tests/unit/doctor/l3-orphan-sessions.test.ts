// tests/unit/doctor/l3-orphan-sessions.test.ts
//
// The orphan-session check must flag BOGUS session dirs and only those.
//
// The defect this file is the control for: the check's exclude-list was a local
// `new Set(['change'])` that had drifted, so `callers/` — a designed location
// written by `session/caller-binding-service.ts` — was reported as an orphan
// and `peaks doctor` exited 1 on a clean workspace, permanently:
//
//   ×  4 orphan session(s) under .peaks/_runtime/ fail isValidSessionId:
//      callers, cli, unknown-sid, x
//
// Fixing that by loosening the check would have been the wrong repair: the
// check exists to catch `x`, `unknown-sid`, `cli` — real bogus dirs produced by
// test fixtures passing a bad `--session-id`. So there are two directions here
// and both must hold:
//
//   tolerance: every REGISTERED system dir under `.peaks/_runtime/` is silent.
//   sharpness: an unregistered, non-session-shaped dir is still a finding.
//
// The tolerance cases are driven off the registry itself rather than a
// hand-copied list, so adding a registry entry cannot leave this file
// asserting the old behaviour.
//
// Omitting the `render` dimension: the check returns a `DoctorCheck` record
// rather than rendering anything, and the one string it does own — the
// operator-facing message — is asserted under `a11y`, where it belongs.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { check } from '~/src/services/doctor/doctor-service/checks/l3-orphan-sessions';
import type { DoctorCheck, DoctorContext } from '~/src/services/doctor/doctor-service/types';
import { isValidSessionId } from '~/src/services/workspace/sid-naming-guard';
import { RUNTIME_SYSTEM_ENTRIES } from '~/src/services/workspace/runtime-layout';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/doctor/l3-orphan-sessions.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason:
        'the check returns a DoctorCheck record and renders nothing; its message is covered by a11y'
    }
  ]
);

const CHECK_ID = 'L3:l3-orphan-sessions';

let root: string;
let runtimeDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-doctor-orphan-'));
  runtimeDir = join(root, '.peaks', '_runtime');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The real validator, not a stub: the check's whole job is that distinction. */
function makeContext(): DoctorContext {
  return {
    options: {},
    registry: { skills: [], failures: [] },
    skills: [],
    schemaRoot: '',
    presence: null,
    workspaceInitialized: false,
    statusLineInstalled: false,
    platform: process.platform,
    resolvedL3Root: root,
    projectRootResolver: () => root,
    isValidSessionId,
    accumulatedChecks: []
  };
}

/** `DoctorCheckPlugin.run` may return a promise; this check is synchronous. */
function runCheck(): readonly DoctorCheck[] {
  const result = check.run(makeContext());

  return Array.isArray(result) ? result : [];
}

function run(): DoctorCheck {
  const checks = runCheck();
  const found = checks.find((entry) => entry.id === CHECK_ID);
  if (found === undefined) {
    throw new Error(`missing check ${CHECK_ID}; got ${checks.map((c) => c.id).join(', ')}`);
  }
  return found;
}

function makeDirs(names: readonly string[]): void {
  mkdirSync(runtimeDir, { recursive: true });
  for (const name of names) mkdirSync(join(runtimeDir, name), { recursive: true });
}

// ── integration: real trees on disk ──────────────────────────────────

describe('Scenario: integration — real .peaks/_runtime/ trees on disk', () => {
  it('passes when .peaks/_runtime/ does not exist', () => {
    const result = run();
    expect(result.ok).toBe(true);
    expect(result.message).toContain('nothing to check');
  });

  it('is silent for every registered system dir (tolerance)', () => {
    const dirs = RUNTIME_SYSTEM_ENTRIES.filter((entry) => entry.kind === 'dir').map(
      (entry) => entry.name
    );
    // Guard against the registry shrinking to nothing and the test passing vacuously.
    expect(dirs.length).toBeGreaterThanOrEqual(8);
    makeDirs(dirs);

    const result = run();
    expect(result.ok).toBe(true);
    // System dirs are filtered out BEFORE the valid/invalid split, so the
    // reported session count is 0 — the point is only that ok stayed true and
    // no name was reported as an orphan.
    expect(result.message).toContain('All 0 session(s)');
    for (const name of dirs) expect(result.message).not.toContain(name);
  });

  it('is silent for real session ids, whatever the registry says', () => {
    const sessionIds = ['2026-09-16-session-5bcf09', '2026-07-25-session-6da9d9'];
    for (const sid of sessionIds) expect(isValidSessionId(sid)).toBe(true);
    makeDirs(sessionIds);

    const result = run();
    expect(result.ok).toBe(true);
    expect(result.message).toContain(`All ${sessionIds.length} session(s)`);
  });

  it('ignores flat files — only directories are session dirs', () => {
    // `.peaks/_runtime/` also holds `session.json`, `active-skill.json` and
    // `classify-audit.jsonl`. They are not directories and must never be
    // reported, including when they sit next to a bogus DIRECTORY (which is
    // the only thing that should be reported).
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(join(runtimeDir, 'session.json'), '{}');
    writeFileSync(join(runtimeDir, 'active-skill.json'), '{}');
    writeFileSync(join(runtimeDir, 'classify-audit.jsonl'), '\n');
    mkdirSync(join(runtimeDir, 'x'), { recursive: true });

    const result = run();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('1 orphan session(s)');
    expect(result.message).toContain('x');
    expect(result.message).not.toContain('session.json');
    expect(result.message).not.toContain('classify-audit.jsonl');
  });
});

// ── behavior: the verdict ────────────────────────────────────────────

describe('Scenario: behavior — the verdict', () => {
  it('flags a bogus session dir — the sharpness control', () => {
    // `x` and `unknown-sid` are the names this repository actually accumulated
    // from test fixtures and from the pre-2026-09-15 `workflow init` fallback.
    makeDirs(['x', 'unknown-sid']);

    const result = run();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('2 orphan session(s)');
  });

  it('flags the bogus dirs even when legitimate ones sit beside them', () => {
    // The regression shape: a mixed tree must not go silent wholesale just
    // because the tolerance list grew.
    makeDirs(['callers', 'change', 'benchmarks', 'cli', 'x']);

    const result = run();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('2 orphan session(s)');
    expect(result.message).toContain('cli, x');
  });
});

// ── a11y: the operator-facing message ────────────────────────────────

describe('Scenario: a11y — the operator-facing message', () => {
  it('names the offending dirs and nothing else', () => {
    makeDirs(['callers', 'change', 'benchmarks', 'cli', 'x']);

    const result = run();
    expect(result.message).toContain('cli, x');
    expect(result.message).not.toContain('callers');
    expect(result.message).not.toContain('benchmarks');
  });

  it('names at most 5 offenders and elides the rest', () => {
    makeDirs(['a', 'b', 'c', 'd', 'e', 'f', 'g']);

    const result = run();
    expect(result.message).toContain('7 orphan session(s)');
    // `slice(0, 5).join(', ')` then the ellipsis suffix.
    expect(result.message).toContain('a, b, c, d, e...');
    // `f` and `g` are past the cut. Match them as list entries, not as
    // substrings — the sentence itself contains `fail` and `archive`.
    expect(result.message).not.toMatch(/\b[fg],/);
  });

  it('tells the operator the command that clears the finding', () => {
    makeDirs(['x']);

    const result = run();
    expect(result.message).toContain('peaks workspace clean --project <repo>');
  });

  it('reads as plain ASCII with no control characters', () => {
    makeDirs(['x']);

    const result = run();
    // Built from escapes so this source file itself stays free of raw control
    // bytes — which is the very thing being asserted about the message.
    const controlChars = new RegExp('[\u0000-\u0008\u000b\u000c\u000e-\u001f]');
    expect(controlChars.test(result.message)).toBe(false);
  });

  it('tells the operator the command that clears the finding', () => {
    makeDirs(['x']);

    const result = run();
    expect(result.message).toContain('peaks workspace clean --project <repo>');
  });
});
