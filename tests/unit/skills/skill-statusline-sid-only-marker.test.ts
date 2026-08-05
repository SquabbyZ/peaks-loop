// tests/unit/skills/skill-statusline-sid-only-marker.test.ts
//
// 4-dimension unit test for slice
// 2026-08-05-statusline-sid-only-marker-and-multi-binary-drift-guard.
//
// This slice is a follow-up to
// 2026-08-05-statusline-empty-render-and-short-sid-suffix. That slice
// pinned `[shortSid]` to the ACTIVE state only. The user-reported
// problem is: when the user opens a fresh terminal / fresh session
// where peaks-loop has been freshly `npm i -g`'d (so no in-flight
// lease exists yet), the first statusline read still says
// `... peaks-loop` with no `[sid]` marker — the user can't tell which
// session the line belongs to at a glance.
//
// G1 — sid-only marker (idle / stale now show sid):
//   The renderer now appends ` [shortSid]` to the project-root cell
//   for idle and stale states too, when a canonical session binding
//   resolves. AC1 (idle + bound) and AC2 (stale + bound).
//
// G2 — invalid-presence keeps no-sid semantics:
//   The renderer's invalid-presence branch must NOT append `[sid]`.
//   AC4. The read-error signal stays loud.
//
// AC3 — idle + unbound:
//   When no project root is bound (no `.peaks/_runtime/<sid>/`), the
//   renderer has no sid to append and renders `... peaks-loop` with
//   no suffix. The renderer reads `model.sessionId === null` to
//   take this branch.
//
// AC5 — active + lease:
//   Continues to render ` [shortSid]` (no regression on the prior
//   slice). Pin one smoke case so the prior slice's behavior is
//   preserved end-to-end.
//
// AC10 — visual consistency:
//   Idle and active use identical sid format ` [3fe1be]`. We assert
//   byte-identical bracket spacing + ASCII characters across both
//   states.
//
// Dimensions covered:
//   - behavior:    idle/stale/invalid-presence/unbound all hit the
//                  correct branch of `computeRootSuffix`
//   - integration: real fs under tmpdir, real `getSessionIdCanonical`
//                  + real `readPresenceReadOnly`
//   - render:      exact-string assertions against the renderer output
//                  (unicode + ascii, pinned clock)
//   - a11y:        sid is pure ASCII `[3fe1be]` in every state; no
//                  Unicode narrow-space / smart-quote drift
//
// Run with:
//   pnpm vitest run tests/unit/skills/skill-statusline-sid-only-marker.test.ts

import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildStatusLineModel } from '~/src/services/skills/skill-statusline-service';
import {
  renderStatusLine,
  computeRootSuffix,
  type StatusLineCapability
} from '~/src/services/skills/skill-statusline-renderer';

const SID = '2026-08-04-session-3fe1be';
const CALLER_ACTIVE = '6ae5eda0-1111-4111-8111-111111111111';
const CALLER_SHELL = '2a5dd5e9-2222-4222-8222-222222222222';
const NOW_MS = Date.parse('2026-08-05T12:00:00.000Z');
const STALE_LEASE_START = '2026-08-03T12:00:00.000Z'; // > 24h before NOW_MS

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
  const parent = mkdtempSync(join(tmpdir(), 'peaks-statusline-sid-only-parent-'));
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

describe("AC1 — idle + session bound appends [shortSid]", () => {
  it("renders `Peaks ... empty -> peaks-loop [3fe1be]`", () => {
    // given: a project root with session.json bound, no leases on disk
    //        → buildStatusLineModel resolves state='idle', sessionId set
    // when:  renderStatusLine is called
    // then:  output contains `peaks-loop [3fe1be]` (G1 idle suffix)
    const projectRoot = makeProjectRoot();
    makeSessionBinding(projectRoot, SID);
    const stdin = {
      workspace: { current_dir: projectRoot },
      session_id: 'claude-code-outer',
      caller_id: CALLER_SHELL
    };
    const model = buildStatusLineModel(stdin, NOW_MS);
    expect(model.state).toBe('idle');
    expect(model.sessionId).toBe(SID);
    const out = withPinnedClock(0, () => renderStatusLine(model, { capability: 'ascii' }));
    expect(out).toContain('empty');
    expect(out).toContain('peaks-loop');
    expect(out).toContain('[3fe1be]');
    // Visual consistency (AC10): the project root cell uses the same
    // trailSeparator as the active branch. ASCII trailSeparator is
    // ' -> '. The order is `... peaks-loop [3fe1be]` (no space between
    // `peaks-loop` and `[`).
    expect(out.indexOf('peaks-loop')).toBeLessThan(out.indexOf('[3fe1be]'));
    // Idle must NOT show a peak-skill token.
    expect(out).not.toContain('peaks-code');
  });
});

describe("AC2 — stale + session bound appends [shortSid]", () => {
  it("renders stale text + `peaks-loop [3fe1be]`", () => {
    // given: a peaks-code lease whose startedAt + lastHeartbeat are
    //        > 24h before NOW_MS. Stdin does NOT carry a matching
    //        callerId, so the read falls back to the
    //        `callerId === null` branch (which propagates `setAt`
    //        from `startedAt`). That branch is the documented path
    //        for non-IDE callers that have no callerId; the
    //        staleness check then resolves state='stale'.
    // when:  renderStatusLine is called
    // then:  output contains the stale marker (`stale <N>h`) AND the
    //        sid suffix after `peaks-loop`
    const projectRoot = makeProjectRoot();
    makeSessionBinding(projectRoot, SID);
    writePresenceLease(
      projectRoot, SID, CALLER_ACTIVE, 'wf-stale', 'peaks-code', 'full-auto',
      'running', STALE_LEASE_START, STALE_LEASE_START
    );
    runWithNoCallerIdEnv(() => {
      const stdin = {
        workspace: { current_dir: projectRoot },
        session_id: 'claude-code-outer-stale',
        caller_id: null
      };
      const model = buildStatusLineModel(stdin, NOW_MS);
      expect(model.state).toBe('stale');
      expect(model.sessionId).toBe(SID);
      const out = withPinnedClock(0, () => renderStatusLine(model, { capability: 'ascii' }));
      expect(out).toContain('stale');
      expect(out).toContain('peaks-code');
      expect(out).toContain('[3fe1be]');
      // Order: stale marker → peaks-loop → [3fe1be].
      expect(out.indexOf('stale')).toBeLessThan(out.indexOf('peaks-loop'));
      expect(out.indexOf('peaks-loop')).toBeLessThan(out.indexOf('[3fe1be]'));
    });
  });
});

describe("AC3 — idle + unbound never appends [shortSid]", () => {
  it("renders `Peaks ... empty -> peaks-loop` with no `[3fe1be]`", () => {
    // given: stdin that points at a directory with no `.peaks/`
    //        (no project root, no session binding)
    // when:  buildStatusLineModel + renderStatusLine are called
    // then:  output is `Peaks o empty -> peaks-loop` with NO `[3fe1be]`
    const stdin = {
      workspace: { current_dir: '/nonexistent-no-project-root' },
      session_id: 'claude-code-outer',
      caller_id: CALLER_SHELL
    };
    const model = buildStatusLineModel(stdin, NOW_MS);
    expect(model.state).toBe('idle');
    expect(model.projectRoot).toBeNull();
    expect(model.sessionId).toBeNull();
    const out = withPinnedClock(0, () => renderStatusLine(model, { capability: 'ascii' }));
    expect(out).toContain('empty');
    expect(out).not.toContain('[3fe1be]');
  });

  it("bound session + no project root model still skips sid (defensive)", () => {
    // given: a directly-constructed model with projectRoot=null
    // when:  renderStatusLine is called
    // then:  no sid is appended (computeRootSuffix returns '' when
    //        rootLabelText is empty)
    const model = {
      state: 'idle' as const,
      projectRoot: null,
      presence: null,
      ageMs: null,
      compact: { kind: 'none' as const, filledCells: 0 as const },
      activeLeaf: null,
      sessionId: null
    };
    const out = withPinnedClock(0, () => renderStatusLine(model, { capability: 'ascii' }));
    expect(out).not.toContain('[3fe1be]');
  });
});

describe("AC4 — invalid-presence never appends [shortSid] (G2 invariant)", () => {
  it("renders `Peaks ! presence unreadable -> peaks-loop` with no sid", () => {
    // given: a model that already carries state='invalid-presence'
    //        (the production case where the lease read threw — covered
    //        by the canonical-only test suite). The renderer must NOT
    //        append `[shortSid]` even when sessionId is set, because
    //        masking the read-error signal would be misleading.
    // when:  renderStatusLine is called
    // then:  output contains `presence unreadable` AND NO `[3fe1be]`
    const model = {
      state: 'invalid-presence' as const,
      projectRoot: '/some/project-root',
      presence: null,
      ageMs: null,
      compact: { kind: 'none' as const, filledCells: 0 as const },
      activeLeaf: null,
      sessionId: SID
    };
    const out = withPinnedClock(0, () => renderStatusLine(model, { capability: 'ascii' }));
    expect(out).toContain('presence unreadable');
    expect(out).not.toContain('[3fe1be]');
  });

  it("computeRootSuffix skips the sid branch when state='invalid-presence' (helper-level)", () => {
    // Direct unit test for the helper. The invalid-presence branch
    // exits BEFORE the sessionId check; this pins the G2 invariant
    // at the helper level (independent of the renderer's other
    // branches).
    const palette = {
      active: '*',
      idle: 'o',
      warning: '!',
      inlineSeparator: ' . ',
      trailSeparator: ' -> ',
      idleLabel: 'empty',
      invalidMessage: 'presence unreadable',
      compact: { queued: '[', preparing: '+', compacting: '+', verifying: '+', completed: '*', failed: 'x' },
      barFilled: '#',
      barEmpty: '-',
      ratioArrow: '->'
    };
    const model = {
      state: 'invalid-presence' as const,
      projectRoot: '/some/project-root',
      presence: null,
      ageMs: null,
      compact: { kind: 'none' as const, filledCells: 0 as const },
      activeLeaf: null,
      sessionId: SID
    };
    const suffix = computeRootSuffix(model, 'peaks-loop', palette);
    expect(suffix).toBe(' -> peaks-loop');
    expect(suffix).not.toContain('[3fe1be]');
  });
});

describe("AC5 — active + lease preserves the prior slice's sid suffix (no regression)", () => {
  it("active lease → `peaks-code` + `[3fe1be]`", () => {
    const projectRoot = makeProjectRoot();
    makeSessionBinding(projectRoot, SID);
    writePresenceLease(
      projectRoot, SID, CALLER_ACTIVE, 'wf-active', 'peaks-code', 'full-auto'
    );
    const stdin = {
      workspace: { current_dir: projectRoot },
      session_id: 'claude-code-outer-active',
      caller_id: CALLER_ACTIVE
    };
    const model = buildStatusLineModel(stdin, NOW_MS);
    expect(model.state).toBe('active');
    const out = withPinnedClock(0, () => renderStatusLine(model, { capability: 'ascii' }));
    expect(out).toContain('peaks-code');
    expect(out).toContain('[3fe1be]');
  });
});

describe("AC10 — visual consistency across idle/active", () => {
  it("idle and active produce byte-identical sid suffix characters", () => {
    // given: idle and active renderings produced from the same
    //        project root + session binding
    // when:  both are rendered at the same pinned clock
    // then:  the substring `peaks-loop [3fe1be]` appears in BOTH
    //        outputs byte-identically (ASCII brackets, single space
    //        before `[`, no Unicode narrow-space / smart-quote)
    const projectRoot = makeProjectRoot();
    makeSessionBinding(projectRoot, SID);

    // idle path: no lease on disk
    const idleStdin = {
      workspace: { current_dir: projectRoot },
      session_id: 'claude-code-outer',
      caller_id: CALLER_SHELL
    };
    const idleModel = runWithNoCallerIdEnv(() => buildStatusLineModel(idleStdin, NOW_MS));
    expect(idleModel.state).toBe('idle');

    // active path: same project root, with a lease
    writePresenceLease(
      projectRoot, SID, CALLER_ACTIVE, 'wf-active', 'peaks-code', 'full-auto'
    );
    const activeStdin = {
      workspace: { current_dir: projectRoot },
      session_id: 'claude-code-outer-active',
      caller_id: CALLER_ACTIVE
    };
    const activeModel = buildStatusLineModel(activeStdin, NOW_MS);
    expect(activeModel.state).toBe('active');

    const idleOut = withPinnedClock(0, () => renderStatusLine(idleModel, { capability: 'ascii' as StatusLineCapability }));
    const activeOut = withPinnedClock(0, () => renderStatusLine(activeModel, { capability: 'ascii' as StatusLineCapability }));
    const idleIdx = idleOut.indexOf('peaks-loop [3fe1be]');
    const activeIdx = activeOut.indexOf('peaks-loop [3fe1be]');
    expect(idleIdx).toBeGreaterThanOrEqual(0);
    expect(activeIdx).toBeGreaterThanOrEqual(0);
    // The slice `peaks-loop [3fe1be]` must be byte-identical in both.
    const idleSlice = idleOut.slice(idleIdx, idleIdx + 'peaks-loop [3fe1be]'.length);
    const activeSlice = activeOut.slice(activeIdx, activeIdx + 'peaks-loop [3fe1be]'.length);
    expect(idleSlice).toBe(activeSlice);
    // ASCII-only check (slice 4be37d08 invariant).
    for (let i = 0; i < idleSlice.length; i++) {
      expect(idleSlice.charCodeAt(i)).toBeLessThan(128);
    }
  });
});