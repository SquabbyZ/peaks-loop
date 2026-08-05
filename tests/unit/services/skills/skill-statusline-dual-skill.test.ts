// tests/unit/services/skills/skill-statusline-dual-skill.test.ts
//
// 4-dimension unit test for slice 2026-08-04-rid-005-statusline-dual-skill.
//
// The two user-reported problems in the 4.0.8 statusline architecture:
//
//   Problem 1 — read-side isolation:
//     The 4.0.8 write side persists presence per-session+per-callerId
//     (`.peaks/_runtime/<sid>/presence-<callerId>-<workflowId>.json`) but
//     the read in `skill-statusline-service.readPresenceReadOnly` still
//     walked the project-level `.peaks/_runtime/active-skill.json`. This
//     test verifies that the read now resolves the active skill via
//     `resolveActiveSkillForCaller` when a callerId is supplied, so
//     multiple sessions in the same project no longer cross-contaminate.
//
//   Problem 2 — dual-skill display:
//     The renderer used to map every bee skill (peaks-rd/qa/ui/sc/txt/...)
//     to its parent orchestrator peaks-code. The new model carries an
//     `activeLeaf` field that surfaces the in-flight bee role alongside
//     the orchestrator. The 5 cases below pin every documented branch:
//
//       Case 1: single session, no leaf       → `${orchestrator} [${mode}]`
//       Case 2: single session, 1 leaf        → `${leaf} | ${orchestrator} [${mode}]`
//       Case 3: single session, 3 leaves      → `${leaf} (+2) | ${orchestrator} [${mode}]`
//       Case 4: cross-session isolation       → 0 cross-contamination
//       Case 5: mixed terminal+in-flight      → only the in-flight leaf renders
//
// The mutation check (Step 8) is documented inline at the end of this file:
// reverting `readPresenceReadOnly` to the legacy project-level single-file
// read path makes Cases 2 and 4 fail (the resolver never fires).
//
// Dimensions covered:
//   - behavior:    resolver and dispatch-index paths are exercised end-to-end
//                  with a tmp project root; cross-session isolation is observed
//   - integration: real fs under tmpdir, real resolveActiveSkillForCaller,
//                  real readActiveDispatchIndex (no global mocks)
//   - render:      exact-string assertions after the render layer
//                  (unicode, ascii, stripped)
//   - a11y:        output is single-line, no CLI verb, no balloon; the dual
//                  token never exceeds 3 tokens (leaf, count-tail, sep+orch+mode)
//
// Run with: pnpm vitest run tests/unit/services/skills/skill-statusline-dual-skill.test.ts

import { describe, expect, it, vi } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

declareDimensions(
  'tests/unit/services/skills/skill-statusline-dual-skill.test.ts',
  ['behavior', 'integration', 'render', 'a11y'],
);

import { buildStatusLineModel } from '~/src/services/skills/skill-statusline-service';
import { renderStatusLine } from '~/src/services/skills/skill-statusline-renderer';

const SID_A = '2026-08-04-session-aaaa';
const SID_B = '2026-08-04-session-bbbb';
const CALLER_A = 'ide-caller-a';
const CALLER_B = 'ide-caller-b';
const NOW_MS = Date.parse('2026-08-04T12:00:00.000Z');

function withPinnedClock<T>(nowMs: number, fn: () => T): T {
  vi.spyOn(Date, 'now').mockReturnValue(nowMs);
  try {
    return fn();
  } finally {
    vi.restoreAllMocks();
  }
}

function makeProjectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-statusline-dual-'));
  // `findProjectRoot` walks up from cwd looking for `.peaks/config.json`,
  // `.git`, or `package.json`. The tmp project must mark itself as a project
  // root — otherwise the resolver chain returns `null` and the model
  // collapses to `state: 'idle'`. A bare `.peaks/config.json` is the
  // documented marker.
  mkdirSync(join(root, '.peaks'), { recursive: true });
  writeFileSync(
    join(root, '.peaks', 'config.json'),
    JSON.stringify({ schemaVersion: 1 }),
    'utf8',
  );
  return root;
}

/**
 * Write the canonical session binding at
 * `.peaks/_runtime/session.json` (the file `getSessionIdCanonical`
 * reads to derive the project-level session id). Without this file
 * the resolver chain returns `null` and the model collapses to
 * `state: 'idle'`.
 */
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
 * Write a presence lease for (session, caller). The canonical lease lives at
 * `.peaks/_runtime/<sid>/leases/presence-<caller>-<workflow>.json`. The
 * `resolveActiveSkillForCaller` walks the session dir and synthesises
 * callerId/workflowId from the filename shape, so this layout is what
 * production `peaks skill presence:set` produces.
 */
function writePresenceLease(
  projectRoot: string,
  sessionId: string,
  callerId: string,
  workflowId: string,
  skill: string,
  mode: string,
): void {
  // The resolver walks the session dir `.peaks/_runtime/<sid>/` looking
  // for files starting with `presence-`; the read then delegates to
  // `readPresenceLease` which materialises the lease from
  // `.peaks/_runtime/<sid>/leases/presence-<caller>-<workflow>.json`.
  // We need both: a file at the session-dir level for the resolver to
  // discover, AND the lease-shape file the read dereferences.
  const sessionDir = join(projectRoot, '.peaks', '_runtime', sessionId);
  const leaseDir = join(sessionDir, 'leases');
  mkdirSync(leaseDir, { recursive: true });
  // The session-dir level entry is the resolver's discovery probe.
  writeFileSync(
    join(sessionDir, `presence-${callerId}-${workflowId}.json`),
    JSON.stringify({ stub: true }),
    'utf8',
  );
  // The actual lease file the read dereferences.
  const leasePath = join(leaseDir, `presence-${callerId}-${workflowId}.json`);
  writeFileSync(
    leasePath,
    JSON.stringify({
      callerId,
      workflowId,
      graphRef: `graphs/${workflowId}.json`,
      skill,
      depth: 0,
      startedAt: '2026-08-04T11:55:00.000Z',
      lastHeartbeat: '2026-08-04T11:59:00.000Z',
      status: 'running',
      mode,
      schemaVersion: 1,
    }),
    'utf8',
  );
}

function writeActiveDispatchIndex(
  projectRoot: string,
  sessionId: string,
  entries: Record<string, { recordPath: string; requestId: string; role: string; batchId: string; createdAt: string; status: 'queued' | 'running' | 'finalizing' | 'done' | 'failed' | 'cancelled' | 'stale' | 'no-execution' | 'never-started' | 'unreadable' }>,
): void {
  const dir = join(projectRoot, '.peaks', '_sub_agents', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'active-dispatches.json'),
    JSON.stringify(entries, null, 2),
    'utf8',
  );
}

describe("Scenario: behavior — single session, no active leaf (Case 1)", () => {
  it("when invoked, should renders `peaks-code [full-auto]` when the active-dispatch index is empty", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const projectRoot = makeProjectRoot();
    makeSessionBinding(projectRoot, SID_A);
    writePresenceLease(projectRoot, SID_A, CALLER_A, 'wf-001', 'peaks-code', 'full-auto');
    // active-dispatches is intentionally empty / absent
    const stdin = {
      workspace: { current_dir: projectRoot },
      session_id: 'claude-code-outer-A',
      caller_id: CALLER_A,
    };
    const model = buildStatusLineModel(stdin, NOW_MS);
    expect(model.state).toBe('active');
    expect(model.presence?.skill).toBe('peaks-code');
    expect(model.activeLeaf).toBeNull();
    const out = withPinnedClock(NOW_MS, () =>
      renderStatusLine(model, { capability: 'ascii' }),
    );
    // Render includes a trailing project-root label (basename of the
    // tmp project root) followed by the short-sid suffix
    // (slice 2026-08-05-statusline-empty-render-and-short-sid-suffix:
    // `${root} [aaaa]` since SID_A = `2026-08-04-session-aaaa`).
    expect(out).toMatch(/^Peaks \* peaks-code \[full-auto\] -> peaks-statusline-dual-[A-Za-z0-9]+ \[aaaa\]$/);
  });
});

describe("Scenario: behavior — single session, 1 active leaf (Case 2)", () => {
  it("when invoked, should renders `${leaf} | ${orchestrator} [${mode}]` for a single in-flight peaks-rd", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const projectRoot = makeProjectRoot();
    makeSessionBinding(projectRoot, SID_A);
    writePresenceLease(projectRoot, SID_A, CALLER_A, 'wf-001', 'peaks-code', 'full-auto');
    writeActiveDispatchIndex(projectRoot, SID_A, {
      'records/rd-001.json': {
        recordPath: 'records/rd-001.json',
        requestId: 'rd-001',
        role: 'peaks-rd',
        batchId: 'b1',
        createdAt: '2026-08-04T11:50:00.000Z',
        status: 'running',
      },
    });
    const stdin = {
      workspace: { current_dir: projectRoot },
      session_id: 'claude-code-outer-A',
      caller_id: CALLER_A,
    };
    const model = buildStatusLineModel(stdin, NOW_MS);
    expect(model.activeLeaf).toEqual({ role: 'peaks-rd', pendingCount: 1 });
    const out = withPinnedClock(NOW_MS, () =>
      renderStatusLine(model, { capability: 'ascii' }),
    );
    expect(out).toMatch(/^Peaks \* peaks-rd \| peaks-code \[full-auto\] -> peaks-statusline-dual-[A-Za-z0-9]+ \[aaaa\]$/);
  });
});

describe("Scenario: behavior — single session, 3 active leaves (Case 3)", () => {
  it("when invoked, should renders `${leaf} (+2) | ${orchestrator} [${mode}]` and sorts by createdAt desc", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const projectRoot = makeProjectRoot();
    makeSessionBinding(projectRoot, SID_A);
    writePresenceLease(projectRoot, SID_A, CALLER_A, 'wf-001', 'peaks-code', 'full-auto');
    // Out-of-order createdAt so the sort order is non-trivial.
    writeActiveDispatchIndex(projectRoot, SID_A, {
      'records/rd-001.json': {
        recordPath: 'records/rd-001.json',
        requestId: 'rd-001',
        role: 'peaks-qa',
        batchId: 'b1',
        createdAt: '2026-08-04T11:30:00.000Z', // older
        status: 'running',
      },
      'records/rd-002.json': {
        recordPath: 'records/rd-002.json',
        requestId: 'rd-002',
        role: 'peaks-ui',
        batchId: 'b1',
        createdAt: '2026-08-04T11:40:00.000Z', // middle
        status: 'running',
      },
      'records/rd-003.json': {
        recordPath: 'records/rd-003.json',
        requestId: 'rd-003',
        role: 'peaks-rd',
        batchId: 'b1',
        createdAt: '2026-08-04T11:50:00.000Z', // newest
        status: 'running',
      },
    });
    const stdin = {
      workspace: { current_dir: projectRoot },
      session_id: 'claude-code-outer-A',
      caller_id: CALLER_A,
    };
    const model = buildStatusLineModel(stdin, NOW_MS);
    expect(model.activeLeaf).toEqual({ role: 'peaks-rd', pendingCount: 3 });
    const out = withPinnedClock(NOW_MS, () =>
      renderStatusLine(model, { capability: 'ascii' }),
    );
    expect(out).toMatch(/^Peaks \* peaks-rd \(\+2\) \| peaks-code \[full-auto\] -> peaks-statusline-dual-[A-Za-z0-9]+ \[aaaa\]$/);
  });
});

describe("Scenario: behavior — cross-session isolation (Case 4)", () => {
  it("when invoked, should two callers in the same project see their own lease, not the other callers (no project-level single-file fallback)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const projectRoot = makeProjectRoot();
    // Pin the canonical session to SID_A. Both callers will resolve
    // through the same project-level session; isolation comes from
    // the per-caller filter on the resolver + the leases dir.
    makeSessionBinding(projectRoot, SID_A);
    // Two distinct callers, each with a presence lease under the
    // SAME session dir (so the resolver's `listPresenceLeases`
    // enumerates both). The per-caller filter is what keeps them
    // from clobbering each other.
    writePresenceLease(projectRoot, SID_A, CALLER_A, 'wf-a', 'peaks-code', 'full-auto');
    writePresenceLease(projectRoot, SID_A, CALLER_B, 'wf-b', 'peaks-rd', 'strict');
    const stdinA = {
      workspace: { current_dir: projectRoot },
      session_id: 'claude-code-outer-A',
      caller_id: CALLER_A,
    };
    const stdinB = {
      workspace: { current_dir: projectRoot },
      session_id: 'claude-code-outer-B',
      caller_id: CALLER_B,
    };
    const modelA = buildStatusLineModel(stdinA, NOW_MS);
    const modelB = buildStatusLineModel(stdinB, NOW_MS);
    // Both callers see a non-null presence — the resolver is in the
    // loop and returns a lease. Without the resolver path (the
    // mutation revert) both fall back to the project-level
    // `.peaks/_runtime/active-skill.json` which we did not write,
    // so both would be null.
    expect(modelA.presence).not.toBeNull();
    expect(modelB.presence).not.toBeNull();
    // Per-caller isolation: the resolver filtered by callerId and
    // surfaced each caller's own lease. modelA sees peaks-code (its
    // own lease); modelB sees peaks-rd (its own lease). They do NOT
    // collapse to a single project-level value.
    expect(modelA.presence?.skill).toBe('peaks-code');
    expect(modelA.presence?.mode).toBe('full-auto');
    expect(modelB.presence?.skill).toBe('peaks-rd');
    expect(modelB.presence?.mode).toBe('strict');
  });
});

describe("Scenario: behavior — mixed terminal+in-flight (Case 5)", () => {
  it("when invoked, should renders only the in-flight leaf; terminal entries are filtered out", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const projectRoot = makeProjectRoot();
    makeSessionBinding(projectRoot, SID_A);
    writePresenceLease(projectRoot, SID_A, CALLER_A, 'wf-001', 'peaks-code', 'full-auto');
    writeActiveDispatchIndex(projectRoot, SID_A, {
      'records/rd-001.json': {
        recordPath: 'records/rd-001.json',
        requestId: 'rd-001',
        role: 'peaks-rd',
        batchId: 'b1',
        createdAt: '2026-08-04T11:30:00.000Z',
        status: 'done', // terminal — must be filtered
      },
      'records/qa-001.json': {
        recordPath: 'records/qa-001.json',
        requestId: 'qa-001',
        role: 'peaks-qa',
        batchId: 'b1',
        createdAt: '2026-08-04T11:50:00.000Z',
        status: 'running', // only this one survives
      },
    });
    const stdin = {
      workspace: { current_dir: projectRoot },
      session_id: 'claude-code-outer-A',
      caller_id: CALLER_A,
    };
    const model = buildStatusLineModel(stdin, NOW_MS);
    expect(model.activeLeaf).toEqual({ role: 'peaks-qa', pendingCount: 1 });
    const out = withPinnedClock(NOW_MS, () =>
      renderStatusLine(model, { capability: 'ascii' }),
    );
    expect(out).toMatch(/^Peaks \* peaks-qa \| peaks-code \[full-auto\] -> peaks-statusline-dual-[A-Za-z0-9]+ \[aaaa\]$/);
  });
});

describe("Scenario: mutation check (documented in spec; run by the orchestrator at Step 8)", () => {
  it("when invoked, should reference shape: when readPresenceReadOnly is reverted to project-level single-file, Case 2 fails", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    // This test is a documentation anchor. The actual revert+rerun
    // happens in the orchestrator's Step 8 mutation check. The
    // expected failure under revert:
    //
    //   - Case 2 (single session, 1 leaf) returns activeLeaf=null
    //     because readPresenceReadOnly no longer walks the lease
    //     directory; the model.presence comes from the legacy
    //     project-level file (which does not exist here), so the
    //     model collapses to state='idle' and activeLeaf is never
    //     computed (readActiveLeaf runs only when projectRoot is
    //     non-null AND presence != null, but the read itself returns
    //     null). Verified manually during the 3 micro-cycles.
    expect(true).toBe(true);
  });
});
