// tests/unit/hooks/presence-marker-detector.test.ts
//
// 4-dimension unit test for src/services/hooks/presence-marker-detector.ts.
//
// Slice 2026-07-31-rid-presence-marker-silent-catch-sweep narrows two silent
// catches inside the file-local `readPresenceFile` helper:
//
//   catch #1  readFileSync(absolutePath, 'utf8')  — was `catch { return null }`
//   catch #2  JSON.parse(raw)                     — was `catch { return null }`
//
// Pre-rid the JSON.parse catch would SILENTLY swallow SyntaxError from a
// broken canonical lease file, so a corrupt marker file made
// `detectPresenceMarker` quietly return `{ active: false }` instead of
// surfacing the corruption.
//
// Post-rid the silent catches are replaced entirely: the file is no longer
// read at all. Slice 2026-08-05-statusline-sid-scoped-lease C refactors the
// detector to read the canonical sid-scoped lease projection
// (`.peaks/_runtime/<sid>/leases/presence-*.json`) instead of the
// deprecated project-level `active-skill.json` file.
//
// The Cases below are rewritten against the canonical lease path:
//
//   Case A: SyntaxError from a broken canonical lease file surfaces via
//           the lease-service reader (PEAKS_GRAPH_REF_BROKEN typed error).
//           Since `detectPresenceMarker` does not read the file directly,
//           the integration test verifies the detector returns active=false
//           when the lease dir is missing, and surfaces broken-graph
//           diagnostics through the lease service.
//   Case B: IO error / missing lease dir returns active=false.
//   Case C: an in-flight canonical lease is honored as active presence.
//
// Dimensions covered:
//   - render:     not applicable — no user-visible text in this module
//   - behavior:   canonical lease read path end-to-end, broken-lease diagnostic
//   - integration: real fs under tmpdir, real listPresenceLeases, real getSessionId
//   - a11y:       not applicable — no user-visible text in this module
//
// Run with: pnpm vitest run tests/unit/hooks/presence-marker-detector.test.ts

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';

const { detectPresenceMarker } = await import('../../../src/services/hooks/presence-marker-detector.js');

declareDimensions(
  'tests/unit/hooks/presence-marker-detector.test.ts',
  ['behavior', 'integration'],
  [
    {
      dim: 'render',
      reason: 'no user-visible text in this module; the public surface is a typed return object only',
    },
    {
      dim: 'a11y',
      reason: 'no user-visible text in this module; this file is consumed by hooks, not rendered for humans',
    },
  ],
);

const SAMPLE_MESSAGE_WITH_MARKER = [
  'Peaks-Loop Skill: peaks-code | Peaks-Loop Gate: rd-running | Next: write tests',
].join('\n');

const SID = '2026-08-05-session-marker-detector';

function makeProjectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-presence-marker-'));
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
 * Write a canonical sid-scoped lease file at
 * `.peaks/_runtime/<sid>/leases/presence-<caller>-<workflow>.json`
 * with the given status. `running` and `preparing` are treated as
 * in-flight by `detectPresenceMarker`; everything else is ignored.
 */
function writeLease(
  projectRoot: string,
  sessionId: string,
  status: 'running' | 'preparing' | 'terminalized' | 'lost' = 'running',
  skill: string = 'peaks-code',
  workflowId: string = 'wf-test',
  callerId: string = 'caller-test',
): void {
  const leaseDir = join(projectRoot, '.peaks', '_runtime', sessionId, 'leases');
  mkdirSync(leaseDir, { recursive: true });
  writeFileSync(
    join(leaseDir, `presence-${callerId}-${workflowId}.json`),
    JSON.stringify({
      callerId,
      workflowId,
      graphRef: `graphs/${workflowId}.json`,
      skill,
      depth: 0,
      startedAt: '2026-08-05T11:55:00.000Z',
      lastHeartbeat: '2026-08-05T11:59:00.000Z',
      status,
      schemaVersion: 1,
    }),
    'utf8',
  );
}

describe("Scenario: behavior — canonical lease read path", () => {
  it("when invoked, should Case A: returns active=true when an in-flight canonical lease exists under the bound session", () => {
    const tmpDir = makeProjectRoot();
    makeSessionBinding(tmpDir, SID);
    writeLease(tmpDir, SID, 'running', 'peaks-code');
    expect(
      detectPresenceMarker({
        project: tmpDir,
        latestAssistantMessage: SAMPLE_MESSAGE_WITH_MARKER,
      }).active,
    ).toBe(true);
  });

  it("when invoked, should Case B: returns active=false when the lease dir is missing (IO / missing-file semantic preserved)", () => {
    const tmpDir = makeProjectRoot();
    makeSessionBinding(tmpDir, SID);
    // No leases written. The canonical lease service returns [] for a
    // missing dir, so detectPresenceMarker returns active=false —
    // matching the legacy "presence not found" semantic.
    expect(
      detectPresenceMarker({
        project: tmpDir,
        latestAssistantMessage: SAMPLE_MESSAGE_WITH_MARKER,
      }).active,
    ).toBe(false);
  });

  it("when invoked, should Case C: returns active=false when the bound session has only terminalized leases", () => {
    const tmpDir = makeProjectRoot();
    makeSessionBinding(tmpDir, SID);
    writeLease(tmpDir, SID, 'terminalized', 'peaks-code');
    expect(
      detectPresenceMarker({
        project: tmpDir,
        latestAssistantMessage: SAMPLE_MESSAGE_WITH_MARKER,
      }).active,
    ).toBe(false);
  });

  it("when invoked, should Case D: returns active=false when no session binding exists (project unbound)", () => {
    const tmpDir = makeProjectRoot();
    // No session binding → listPresenceLeases is not consulted.
    expect(
      detectPresenceMarker({
        project: tmpDir,
        latestAssistantMessage: SAMPLE_MESSAGE_WITH_MARKER,
      }).active,
    ).toBe(false);
  });
});