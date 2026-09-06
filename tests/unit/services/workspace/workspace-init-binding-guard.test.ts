// tests/unit/services/workspace/workspace-init-binding-guard.test.ts
//
// rid=2026-09-06-cli-drift — Bug 2: sub-agent session-rebind.
//
// A sub-agent re-running `peaks workspace init` can resolve the project root
// via a spelling that differs from the stored binding form (relative `"."`,
// symlink, separator/case variance on Windows). The old `initWorkspace` read
// the existing binding with the strict `getSessionId`, which returned null on
// those spellings and sent init down the "no prior binding → adopt" path —
// silently clobbering `.peaks/_runtime/session.json` with a phantom session
// and orphaning the parent.
//
// The fix reads the binding via `getSessionIdCanonical` so a live parent
// binding is detected and the differing-id branch refuses (or requires
// --allow-session-rebind) instead of silently overwriting.
//
// Dimensions covered:
//   - behavior:    binding preserved / overwritten across the guard branches
//   - integration: real on-disk binding + session dir in a tmp workspace
//   - render:      OMITTED — no formatted output surface in the service
//   - a11y:        OMITTED — no human-facing text in the service; the CLI
//                  surfaces the ConflictingSessionError remediation

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';
import {
  initWorkspace,
  ConflictingSessionError,
} from '../../../../src/services/workspace/workspace-service.js';

declareDimensions(
  'tests/unit/services/workspace/workspace-init-binding-guard.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'no formatted output surface in the service' },
    { dim: 'a11y', reason: 'no human-facing text in the service; the CLI surfaces the ConflictingSessionError remediation' },
  ],
);

const PARENT_SESSION = '2026-09-07-session-aaaa11';
const PHANTOM_SESSION = '2026-09-07-session-bbbb22';

/**
 * Simulate a live parent binding whose stored `projectRoot` is the relative
 * form `"."` (the canonical "written from inside the project dir" case).
 * The parent session dir is non-empty (it carries its `session.json` meta with
 * a recorded `outerSessionId`), so a differing re-init must refuse rather than
 * clobber the binding.
 */
function writeLiveParentBinding(projectRoot: string): void {
  const runtimeDir = join(projectRoot, '.peaks', '_runtime');
  mkdirSync(runtimeDir, { recursive: true });
  // Project-level binding with the relative stored form.
  writeFileSync(
    join(runtimeDir, 'session.json'),
    JSON.stringify({ sessionId: PARENT_SESSION, createdAt: '2026-09-07T00:00:00.000Z', projectRoot: '.' }, null, 2),
    'utf8',
  );
  // Live parent session dir (non-empty meta + recorded outer-session id).
  const parentDir = join(runtimeDir, PARENT_SESSION);
  mkdirSync(parentDir, { recursive: true });
  writeFileSync(
    join(parentDir, 'session.json'),
    JSON.stringify({
      sessionId: PARENT_SESSION,
      projectRoot: '.',
      createdAt: '2026-09-07T00:00:00.000Z',
      lastActivity: '2026-09-07T00:00:00.000Z',
      outerSessionId: 'outer-parent-session',
    }, null, 2),
    'utf8',
  );
}

function readBoundSessionId(projectRoot: string): string | null {
  const bindingPath = join(projectRoot, '.peaks', '_runtime', 'session.json');
  if (!existsSync(bindingPath)) return null;
  const data = JSON.parse(readFileSync(bindingPath, 'utf8')) as { sessionId?: string };
  return typeof data.sessionId === 'string' ? data.sessionId : null;
}

describe('Scenario: behavior — differing re-init refuses to clobber a live parent binding', () => {
  const ws = withTmpWorkspacePerTest('peaks-rebind-guard-');

  it('when a differing id is requested without --allow-session-rebind, should throw ConflictingSessionError and preserve the binding', async () => {
    writeLiveParentBinding(ws().path);

    await expect(
      initWorkspace({
        projectRoot: ws().path,
        sessionId: PHANTOM_SESSION,
        allowSessionRebind: false,
      }),
    ).rejects.toBeInstanceOf(ConflictingSessionError);

    expect(readBoundSessionId(ws().path)).toBe(PARENT_SESSION);
  });

  it('when --allow-session-rebind is passed, should overwrite the binding to the requested id', async () => {
    writeLiveParentBinding(ws().path);

    const report = await initWorkspace({
      projectRoot: ws().path,
      sessionId: PHANTOM_SESSION,
      allowSessionRebind: true,
    });

    expect(report.bound).toBe(true);
    expect(report.previousSessionId).toBe(PARENT_SESSION);
    expect(readBoundSessionId(ws().path)).toBe(PHANTOM_SESSION);
  });

  it('when the same id is requested, should be idempotent (bound, no throw, no overwrite)', async () => {
    writeLiveParentBinding(ws().path);

    const report = await initWorkspace({
      projectRoot: ws().path,
      sessionId: PARENT_SESSION,
      allowSessionRebind: false,
    });

    expect(report.bound).toBe(true);
    expect(report.previousSessionId).toBeNull();
    expect(readBoundSessionId(ws().path)).toBe(PARENT_SESSION);
  });
});
