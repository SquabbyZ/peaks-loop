import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  evaluateWorktreeAuth,
  type WorktreeAuthCheckInput,
} from '~/src/services/hooks/worktree-authorization-gate';
import {
  createDispatchProvenanceToken,
  writeDispatchProvenance,
} from '~/src/services/worktree/dispatch-provenance';
import { finalizeLease, serializeLease } from '~/src/services/worktree/worktree-lease';
import { withTmpWorkspacePerTest } from '../_setup/tmp-workspace.js';

const SID = '2026-08-01-provenance';
const RID = 'rid-host-governance';
const LEASE_ID = '0123456789abcdef';

function baseInput(projectRoot: string): WorktreeAuthCheckInput {
  return {
    projectRoot,
    sessionId: SID,
    toolName: 'Agent',
    command: null,
    isolation: 'worktree',
    requestId: RID,
    leaseId: LEASE_ID,
    containerLeaseId: null,
    dispatchProvenanceToken: null,
  };
}

describe("Scenario: host Agent worktree provenance gate", () => {
  withTmpWorkspacePerTest();

  it("when invoked, should denies host isolation without Peaks provenance even when a lease id is supplied", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const decision = evaluateWorktreeAuth(baseInput(process.cwd()));
    expect(decision.allow).toBe(false);
    if (!decision.allow) expect(decision.code).toBe('HOST_AGENT_ISOLATION_UNMANAGED');
  });

  it("when invoked, should allows worktree isolation only when provenance matches an active canonical lease", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const root = process.cwd();
    const runtime = join(root, '.peaks', '_runtime', SID);
    mkdirSync(join(runtime, 'worktree-leases'), { recursive: true });
    const lease = finalizeLease({
      leaseId: LEASE_ID,
      rid: RID,
      role: 'rd',
      path: join(runtime, 'worktrees', LEASE_ID),
      branch: 'peaks/rid-host-governance',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      purpose: 'test provenance',
    });
    writeFileSync(join(runtime, 'worktree-leases', `${LEASE_ID}.json`), serializeLease(lease), 'utf8');
    const token = createDispatchProvenanceToken({ sessionId: SID, requestId: RID, leaseId: LEASE_ID });
    writeDispatchProvenance({
      projectRoot: root,
      record: {
        schemaVersion: 1,
        token,
        sessionId: SID,
        requestId: RID,
        leaseId: LEASE_ID,
        isolation: 'worktree',
        issuedAt: new Date().toISOString(),
      },
    });

    const decision = evaluateWorktreeAuth({ ...baseInput(root), dispatchProvenanceToken: token });
    expect(decision.allow).toBe(true);
    if (decision.allow) expect(decision.viaLease?.leaseId).toBe(LEASE_ID);
  });
});
