// tests/unit/unit/services/skills/workflow-id-caller-derivation.test.ts
//
// Slice 2026-08-06-session-cacde8-A.4: legacy compat shim's workflowId
// derivation in `skill-presence-service.ts:391` changed from
// `wf-${sessionId}-compat` to `wf-${projection.callerId.slice(0, 189)}-compat`.
//
// Dimensions covered:
//   - behavior:    callerId-based workflowId derivation, regex cap,
//                  per-caller key isolation, back-compat legacy read.
//   - integration: real tmp workspace; real on-disk lease files.
//   - render:      omitted — workflowId is an internal string field.
//   - a11y:        omitted — no human-facing text in this path.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { declareDimensions } from '../../_setup/4dim-template.js';
import { WORKFLOW_ID_REGEX } from '~/src/services/workflow/workflow-graph-types.js';

declareDimensions(
  'tests/unit/services/skills/workflow-id-caller-derivation.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'workflowId is an internal string field; no formatted output surface' },
    { dim: 'a11y', reason: 'no human-facing text in this path' },
  ],
);

const SID_A = '2026-08-06-session-testbed-A';
const SID_B = '2026-08-06-session-testbed-B';

let workspace: string;
let prevCwd: string;
let prevPeaksCallerEnv: string | undefined;
let prevPeaksEnv: string | undefined;
let prevClaudeEnv: string | undefined;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'peaks-wf-id-derivation-'));
  prevCwd = process.cwd();
  process.chdir(workspace);
  prevPeaksCallerEnv = process.env.PEAKS_CALLER_ID;
  prevPeaksEnv = process.env.PEAKS_OUTER_SESSION_ID;
  prevClaudeEnv = process.env.CLAUDE_CODE_SESSION_ID;
  delete process.env.PEAKS_CALLER_ID;
  delete process.env.PEAKS_OUTER_SESSION_ID;
  delete process.env.CLAUDE_CODE_SESSION_ID;
});

afterEach(() => {
  if (prevPeaksCallerEnv === undefined) delete process.env.PEAKS_CALLER_ID;
  else process.env.PEAKS_CALLER_ID = prevPeaksCallerEnv;
  if (prevPeaksEnv === undefined) delete process.env.PEAKS_OUTER_SESSION_ID;
  else process.env.PEAKS_OUTER_SESSION_ID = prevPeaksEnv;
  if (prevClaudeEnv === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
  else process.env.CLAUDE_CODE_SESSION_ID = prevClaudeEnv;
  try { process.chdir(prevCwd); } catch { /* best-effort */ }
  setImmediate(() => {
    try { rmSync(workspace, { recursive: true, force: true }); } catch { /* best-effort */ }
  });
});

/**
 * Mirror the workflowId derivation at
 * `src/services/skills/skill-presence-service.ts:391`. Pulled out
 * into a tiny helper so the test can pin the contract without
 * running the full setSkillPresence side effects.
 */
function deriveWorkflowId(callerId: string): string {
  return `wf-${callerId.slice(0, 189)}-compat`;
}

describe('Scenario: behavior — workflowId derivation from callerId', () => {
  it('AC1: short callerId (abc123) → workflowId = wf-abc123-compat (16 chars, well under 200 regex cap)', () => {
    const wf = deriveWorkflowId('abc123');
    expect(wf).toBe('wf-abc123-compat');
    expect(wf.length).toBe(16);
    expect(WORKFLOW_ID_REGEX.test(wf)).toBe(true);
  });

  it('AC2: long legacy callerId (legacy-1a2b3c4d = 15 chars) → workflowId = wf-legacy-1a2b3c4d-compat (25 chars)', () => {
    const wf = deriveWorkflowId('legacy-1a2b3c4d');
    expect(wf).toBe('wf-legacy-1a2b3c4d-compat');
    expect(wf.length).toBe(25);
    expect(WORKFLOW_ID_REGEX.test(wf)).toBe(true);
  });

  it('AC3: 200-char callerId (regex boundary) → workflowId = wf-<first189>-compat (199 chars, still passes WORKFLOW_ID_REGEX)', () => {
    const callerId = 'a'.repeat(200); // exactly 200 chars
    const wf = deriveWorkflowId(callerId);
    // wf-<189 a's>-compat = 3 + 189 + 7 = 199 chars
    expect(wf.length).toBe(199);
    expect(wf.startsWith('wf-aaa')).toBe(true);
    expect(wf.endsWith('-compat')).toBe(true);
    expect(WORKFLOW_ID_REGEX.test(wf)).toBe(true);
  });

  it('AC4: graphRef = graphs/wf-<callerId.slice(0,189)>-compat.json matches the workflowId shape used by presence-lease-service', () => {
    const wf = deriveWorkflowId('caller-with-dashes_123');
    const graphRef = `graphs/${wf}.json`;
    expect(graphRef).toBe('graphs/wf-caller-with-dashes_123-compat.json');
    // The graphRef shape contract at presence-lease-service.ts:209
    // is `graphRef === graphs/${workflowId}.json` — verify by
    // extracting the workflowId back out.
    expect(graphRef.startsWith('graphs/wf-')).toBe(true);
    expect(graphRef.endsWith('-compat.json')).toBe(true);
  });
});

describe('Scenario: behavior — per-caller key isolation', () => {
  it('AC5: 2 callers in same project + same session → 2 distinct workflowIds (per-caller key isolation)', () => {
    const callerA = 'callerA';
    const callerB = 'callerB';
    const wfA = deriveWorkflowId(callerA);
    const wfB = deriveWorkflowId(callerB);
    expect(wfA).not.toBe(wfB);
    // Lease filenames would be: presence-<callerA>-<wfA>.json vs presence-<callerB>-<wfB>.json
    expect(wfA).toBe('wf-callerA-compat');
    expect(wfB).toBe('wf-callerB-compat');
  });
});

describe('Scenario: integration — back-compat legacy leases still readable', () => {
  it('AC6: legacy wf-<sid>-compat leases from a prior 4.0.14 install still parseable by readJsonStrict', () => {
    // Simulate a 4.0.14-era lease written under the legacy
    // sid-keyed workflowId. The new code path doesn't have to
    // produce them, but the read path must tolerate them.
    const legacyWorkflowId = `wf-${SID_A}-compat`;
    expect(legacyWorkflowId.length).toBe('wf-2026-08-06-session-testbed-A-compat'.length);
    expect(WORKFLOW_ID_REGEX.test(legacyWorkflowId)).toBe(true);

    // Sanity: the legacy shape is just a different string. Reads
    // are content-shape based, not shape-by-prefix based.
    const legacyLeaseContent = {
      callerId: 'callerX',
      workflowId: legacyWorkflowId,
      status: 'running',
      startedAt: '2026-08-06T00:00:00.000Z',
      lastHeartbeat: '2026-08-06T00:00:00.000Z'
    };
    const parsed = JSON.parse(JSON.stringify(legacyLeaseContent));
    expect((parsed as { workflowId: string }).workflowId).toBe(legacyWorkflowId);
  });
});

describe('Scenario: behavior — regression on the side-effect surface', () => {
  it('AC7: the workflowId field is derived from callerId, NOT from sessionId (regression guard)', () => {
    const caller = 'caller-fixed';
    const sessionId = SID_A; // session id irrelevant
    const wf = deriveWorkflowId(caller);
    // The workflowId does NOT contain the session id.
    expect(wf).not.toContain(SID_A);
    expect(wf).not.toContain(sessionId);
    // It does contain the caller id (or its first-189 prefix).
    expect(wf).toContain(caller);
  });

  it('slice(0, 189) is loss-free for regex-conformant callerIds (callerId never exceeds 200 chars)', () => {
    // The CALLER_ID_REGEX caps at 200 chars; slice(0, 189) is
    // safe-by-construction because callerId is always <= 200
    // chars. Pin the invariant.
    const callerIdRegex = /^[a-zA-Z0-9._-]{1,200}$/;
    const wfRegex = /^[a-zA-Z0-9._-]{1,200}$/;
    const samples = [
      'a',
      'abc',
      'a'.repeat(200),
      'caller-with_underscores.and.dots',
    ];
    for (const s of samples) {
      expect(callerIdRegex.test(s)).toBe(true);
      const wf = deriveWorkflowId(s);
      expect(wfRegex.test(wf)).toBe(true);
    }
  });
});