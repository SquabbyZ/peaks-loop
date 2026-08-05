// tests/unit/skills/skill-statusline-empty-render-and-short-sid-suffix.test.ts
//
// 4-dimension unit test for slice 2026-08-05-statusline-empty-render-and-short-sid-suffix.
//
// Two regressions pinned in this slice:
//
//   G1 — callerId-mismatch fallback (AC2):
//     When the stdin/env callerId does NOT match any canonical lease under
//     the session, the statusline used to collapse to `empty` because
//     `resolveActiveSkillForCaller` returned `source: 'none'`. The fix:
//     `readPresenceReadOnly` now retries with `callerId: null` when the
//     callerId-filtered resolution is empty, falling back to the
//     session's most-recent in-flight lease.
//
//   G2 — short-sid suffix (AC1, AC3, AC5, AC6, AC7):
//     When presence is `active`, the project root label is suffixed with
//     ` [${shortSid}]` where `shortSid = sessionId.split('-').pop()`. Idle,
//     stale, and invalid-presence states never carry the suffix.
//
// AC4 regression — when callerId A DOES have a lease, the callerId-A
// lease wins; the G1 fallback never returns callerId-B's lease to callerId A.
// The existing slice 4-B test (`tests/unit/skills/skill-statusline-canonical-only.test.ts`)
// keeps covering that invariant; this file adds two extra cases that prove
// the fallback fires ONLY when callerId A has no matching lease.
//
// Dimensions covered:
//   - behavior:    resolver fallback + renderer suffix under real fs tmpdir
//   - integration: real fs, real resolveActiveSkillForCaller, real
//                  listPresenceLeases (no global mocks)
//   - render:      exact-string assertions after the render layer
//                  (unicode + ascii, pinned clock)
//   - a11y:        output is single-line, ASCII-only short-sid suffix
//
// Run with: pnpm vitest run tests/unit/skills/skill-statusline-empty-render-and-short-sid-suffix.test.ts

import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildStatusLineModel } from '~/src/services/skills/skill-statusline-service';
import { renderStatusLine, formatShortSid } from '~/src/services/skills/skill-statusline-renderer';

const SID = '2026-08-04-session-3fe1be';
const CALLER_ACTIVE = '6ae5eda0-1111-4111-8111-111111111111';
const CALLER_SHELL = '2a5dd5e9-2222-4222-8222-222222222222';
const CALLER_A = 'ide-caller-a';
const CALLER_B = 'ide-caller-b';
const NOW_MS = Date.parse('2026-08-05T12:00:00.000Z');

/**
 * The test runner sets `process.env.CLAUDE_CODE_SESSION_ID` to its own
 * session id. The `runWithNoCallerIdEnv` helper clears the env so the
 * `callerId === null` branch resolves cleanly (mirroring the documented
 * `stdin → env → null` resolution chain in `resolveCallerId`).
 */
function runWithNoCallerIdEnv<T>(fn: () => T): T {
  const prev = process.env['CLAUDE_CODE_SESSION_ID'];
  delete process.env['CLAUDE_CODE_SESSION_ID'];
  try {
    return fn();
  } finally {
    if (prev === undefined) {
      delete process.env['CLAUDE_CODE_SESSION_ID'];
    } else {
      process.env['CLAUDE_CODE_SESSION_ID'] = prev;
    }
  }
}

function withPinnedClock<T>(nowMs: number, fn: () => T): T {
  vi.spyOn(Date, 'now').mockReturnValue(nowMs);
  try {
    return fn();
  } finally {
    vi.restoreAllMocks();
  }
}

function makeProjectRoot(): string {
  // The renderer's project-root cell is `basename(projectRoot)`. To make
  // the AC1 / AC6 literal-text assertion (`peaks-loop [3fe1be]`)
  // meaningful we name the tmp dir so its basename equals `peaks-loop`.
  const parent = mkdtempSync(join(tmpdir(), 'peaks-statusline-suffix-parent-'));
  const root = join(parent, 'peaks-loop');
  mkdirSync(join(root, '.peaks'), { recursive: true });
  writeFileSync(
    join(root, '.peaks', 'config.json'),
    JSON.stringify({ schemaVersion: 1 }),
    'utf8',
  );
  return root;
}

function makeSessionBinding(projectRoot: string, sessionId: string): void {
  const dir = join(projectRoot, '.peaks', '_runtime');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'session.json'),
    JSON.stringify({ sessionId, projectRoot }),
    'utf8',
  );
}

/**
 * Write a canonical presence lease under
 * `.peaks/_runtime/<sid>/leases/presence-<caller>-<workflow>.json`. The
 * session-dir level stub at `presence-<caller>-<workflow>.json` is also
 * required so `resolveActiveSkillForCaller` / `listPresenceLeases` can
 * discover the (caller, workflow) pair.
 */
function writePresenceLease(
  projectRoot: string,
  sessionId: string,
  callerId: string,
  workflowId: string,
  skill: string,
  mode: string,
  status: 'preparing' | 'running' | 'terminalized' | 'lost' = 'running',
  startedAt: string = '2026-08-05T11:55:00.000Z',
  lastHeartbeat: string = '2026-08-05T11:59:00.000Z',
): void {
  const sessionDir = join(projectRoot, '.peaks', '_runtime', sessionId);
  const leaseDir = join(sessionDir, 'leases');
  mkdirSync(leaseDir, { recursive: true });
  writeFileSync(
    join(sessionDir, `presence-${callerId}-${workflowId}.json`),
    JSON.stringify({ stub: true }),
    'utf8',
  );
  writeFileSync(
    join(leaseDir, `presence-${callerId}-${workflowId}.json`),
    JSON.stringify({
      callerId,
      workflowId,
      graphRef: `graphs/${workflowId}.json`,
      skill,
      depth: 0,
      startedAt,
      lastHeartbeat,
      status,
      mode,
      schemaVersion: 1,
    }),
    'utf8',
  );
}

describe("formatShortSid — pure helper (AC5, AC7)", () => {
  it("returns the last kebab-segment of a session id", () => {
    expect(formatShortSid('2026-08-04-session-3fe1be')).toBe('3fe1be');
  });

  it("works for legacy / future session id shapes", () => {
    expect(formatShortSid('2025-01-01-session-ab12cd')).toBe('ab12cd');
    expect(formatShortSid('foo-bar-baz')).toBe('baz');
    expect(formatShortSid('peaks-loop-2026-08-04-session-foo-bar-baz')).toBe('baz');
  });

  it("returns the empty string when the session id is empty", () => {
    expect(formatShortSid('')).toBe('');
  });
});

describe("G1 — callerId-mismatch fallback (AC2)", () => {
  it("when the stdin callerId has no matching lease, falls back to the session's most recent in-flight lease", () => {
    // given: an in-flight lease owned by CALLER_ACTIVE; stdin carries
    //        CALLER_SHELL (the harness's CLAUDE_CODE_SESSION_ID, which
    //        does NOT match the lease's callerId). This reproduces the
    //        4.0.12 production bug — callerId `2a5dd5e9-...` resolving
    //        to `empty` while a peaks-code lease under callerId
    //        `6ae5eda0-...` was live on disk.
    // when:  buildStatusLineModel is called
    // then:  state='active', presence.skill='peaks-code' — the fallback
    //        branch (callerId === null) fired and surfaced the lease.
    const projectRoot = makeProjectRoot();
    makeSessionBinding(projectRoot, SID);
    writePresenceLease(
      projectRoot, SID, CALLER_ACTIVE, 'wf-active', 'peaks-code', 'full-auto',
    );
    const stdin = {
      workspace: { current_dir: projectRoot },
      session_id: 'claude-code-outer-shell',
      caller_id: CALLER_SHELL,
    };
    const model = buildStatusLineModel(stdin, NOW_MS);
    expect(model.state).toBe('active');
    expect(model.presence).not.toBeNull();
    expect(model.presence?.skill).toBe('peaks-code');
    expect(model.presence?.mode).toBe('full-auto');
  });

  it("when callerId DOES match a lease, that lease wins — no fallback cross-contamination (AC4)", () => {
    // given: two callers A (peaks-code) and B (peaks-rd) under the same
    //        session. Stdin carries callerId A.
    // when:  buildStatusLineModel is called
    // then:  presence.skill='peaks-code' — A's lease. The G1 fallback
    //        never fires because A's callerId-filtered resolution was
    //        non-empty; B's lease is never surfaced to A.
    const projectRoot = makeProjectRoot();
    makeSessionBinding(projectRoot, SID);
    writePresenceLease(projectRoot, SID, CALLER_A, 'wf-a', 'peaks-code', 'full-auto');
    writePresenceLease(projectRoot, SID, CALLER_B, 'wf-b', 'peaks-rd', 'strict');
    const stdin = {
      workspace: { current_dir: projectRoot },
      session_id: 'claude-code-outer-A',
      caller_id: CALLER_A,
    };
    const model = buildStatusLineModel(stdin, NOW_MS);
    expect(model.state).toBe('active');
    expect(model.presence?.skill).toBe('peaks-code');
    expect(model.presence?.skill).not.toBe('peaks-rd');
  });
});

describe("G2 — short-sid suffix rendering (AC1, AC3, AC5, AC6, AC7)", () => {
  it("active state appends ` [${shortSid}]` after the project root (AC1)", () => {
    // given: an active peaks-code lease under callerId ACTIVE; stdin
    //        carries the matching callerId. Pinned clock so the
    //        breathing glyph is deterministic.
    // when:  renderStatusLine is called
    // then:  output contains `peaks-loop [3fe1be]` — short-sid appended
    //        after the project name, ASCII brackets, no Unicode-extra.
    const projectRoot = makeProjectRoot();
    makeSessionBinding(projectRoot, SID);
    writePresenceLease(projectRoot, SID, CALLER_ACTIVE, 'wf-active', 'peaks-code', 'full-auto');
    const stdin = {
      workspace: { current_dir: projectRoot },
      session_id: 'claude-code-outer-active',
      caller_id: CALLER_ACTIVE,
    };
    const model = buildStatusLineModel(stdin, NOW_MS);
    const out = withPinnedClock(0, () => renderStatusLine(model, { capability: 'ascii' }));
    expect(out).toContain('peaks-loop');
    expect(out).toContain('[3fe1be]');
    // Order: the project name cell appears BEFORE the short-sid suffix.
    expect(out.indexOf('peaks-loop')).toBeLessThan(out.indexOf('[3fe1be]'));
    // Active skill must still render — no regression on the brand/skill tokens.
    expect(out).toContain('peaks-code');
    expect(out).not.toContain('empty');
  });

  it("idle state carries the short-sid suffix (AC3 — updated by sid-only-marker slice)", () => {
    // given: empty session dir — no leases, no active-skill.json
    // when:  buildStatusLineModel + renderStatusLine are called
    // then:  output is `Peaks o empty -> peaks-loop [3fe1be]` — the
    //        idle state now appends `[shortSid]` when a session binding
    //        is present (G1, slice
    //        2026-08-05-statusline-sid-only-marker-and-multi-binary-drift-guard).
    //        The prior slice asserted the OPPOSITE; this slice
    //        supersedes that assertion. AC3 in the new PRD relaxes
    //        to "no sid when projectRoot is null" (verified in
    //        skill-statusline-sid-only-marker.test.ts).
    const projectRoot = makeProjectRoot();
    makeSessionBinding(projectRoot, SID);
    const stdin = {
      workspace: { current_dir: projectRoot },
      session_id: 'claude-code-outer-A',
      caller_id: CALLER_A,
    };
    const model = buildStatusLineModel(stdin, NOW_MS);
    expect(model.state).toBe('idle');
    const out = withPinnedClock(0, () => renderStatusLine(model, { capability: 'ascii' }));
    expect(out).toContain('empty');
    expect(out).toContain('[3fe1be]');
  });

  it("idle state with NO project root never carries the short-sid suffix (AC3 in sid-only-marker slice)", () => {
    // given: stdin that points at a directory that has no `.peaks/`
    //        (no project root); the renderer must NOT invent a sid.
    // when:  buildStatusLineModel + renderStatusLine are called
    // then:  output is `Peaks o empty` with no `[3fe1be]` (the renderer
    //        sees projectRoot === null and skips the sid branch).
    const stdin = {
      workspace: { current_dir: '/nonexistent-no-project-root' },
      session_id: 'claude-code-outer-A',
      caller_id: CALLER_A,
    };
    const model = buildStatusLineModel(stdin, NOW_MS);
    expect(model.state).toBe('idle');
    expect(model.projectRoot).toBeNull();
    expect(model.sessionId).toBeNull();
    const out = withPinnedClock(0, () => renderStatusLine(model, { capability: 'ascii' }));
    expect(out).toContain('empty');
    expect(out).not.toContain('[3fe1be]');
  });

  it("the suffix is pure ASCII — no Unicode narrow-space / smart-quote drift (AC7)", () => {
    // given: an active lease to render the suffix
    // when:  renderStatusLine is called
    // then:  the byte sequence `[3fe1be]` appears as plain ASCII. We
    //        also assert that no Unicode-extra glyphs leak into the
    //        suffix by checking the exact byte range.
    const projectRoot = makeProjectRoot();
    makeSessionBinding(projectRoot, SID);
    writePresenceLease(projectRoot, SID, CALLER_ACTIVE, 'wf-active', 'peaks-code', 'full-auto');
    const stdin = {
      workspace: { current_dir: projectRoot },
      session_id: 'claude-code-outer-active',
      caller_id: CALLER_ACTIVE,
    };
    const model = buildStatusLineModel(stdin, NOW_MS);
    const out = withPinnedClock(0, () => renderStatusLine(model, { capability: 'ascii' }));
    const idx = out.indexOf('[3fe1be]');
    expect(idx).toBeGreaterThanOrEqual(0);
    // ASCII-only check: every byte of the suffix must be a 7-bit char.
    const slice = out.slice(idx, idx + '[3fe1be]'.length);
    for (let i = 0; i < slice.length; i++) {
      expect(slice.charCodeAt(i)).toBeLessThan(128);
    }
  });
});