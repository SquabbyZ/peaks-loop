/**
 * Unit tests for `src/services/workflow/workflow-skip-service.ts`
 * (slice 2026-06-13-peaks-workflow-skip).
 *
 * Coverage:
 *   - canSkipSlice: 6 cases
 *       (1) reason empty → reject
 *       (2) gates empty → reject
 *       (3) rule 1 deny: type=bugfix
 *       (4) rule 1 allow: type=docs
 *       (5) rule 2 same-skip idempotent
 *       (6) rule 2 different-skip conflict
 *       (7) rule 3 deny: script caller without --i-have-reviewed
 *       (8) rule 3 allow: script caller with --i-have-reviewed
 *       (9) rule 3 allow: human caller without --i-have-reviewed
 *   - applySkip: 4 cases
 *       (A) writes marker on success
 *       (B) refuses on rule 1 deny
 *       (C) refuses on rule 3 deny
 *       (D) idempotent re-skip returns applied:false
 *       (E) dry-run does not write
 *   - parseGatesList: 3 cases
 *       - single gate
 *       - comma-separated
 *       - whitespace handling
 *   - detectCallerKind: 3 cases
 *       - undefined → human
 *       - 'ci' → script
 *       - 'llm-call' → llm
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applySkip,
  canSkipSlice,
  detectCallerKind,
  parseGatesList
} from '../../../../src/services/workflow/workflow-skip-service.js';
import {
  readSkipState,
  writeSkipState
} from '../../../../src/services/workflow/workflow-state-store.js';

const SESSION_ID = '2026-06-13-session-test01';
const RD_RID = '2026-06-13-test-rd-001';

function makeRepo(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-skip-test-'));
}

function makeRdRequest(repo: string, rid: string, type: string, content: string = `# RD Request ${rid}\n\n- type: ${type}\n- state: spec-locked\n`): void {
  // Place under .peaks/_runtime/<sid>/rd/requests/<rid>.md so
  // showRequestArtifact can find it.
  const dir = join(repo, '.peaks', '_runtime', SESSION_ID, 'rd', 'requests');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${rid}.md`);
  writeFileSync(path, content, 'utf8');
}

describe('workflow-skip-service — parseGatesList', () => {
  it('splits comma-separated gates and trims whitespace', () => {
    expect(parseGatesList('QA,slice-check, code-review')).toEqual(['QA', 'slice-check', 'code-review']);
  });

  it('returns a single-element array for one gate', () => {
    expect(parseGatesList('QA')).toEqual(['QA']);
  });

  it('drops empty segments (trailing comma, double comma)', () => {
    expect(parseGatesList('QA,,code-review,')).toEqual(['QA', 'code-review']);
  });
});

describe('workflow-skip-service — detectCallerKind', () => {
  it('returns "human" when env is undefined', () => {
    expect(detectCallerKind(undefined)).toBe('human');
  });

  it('returns "script" for known script env ids', () => {
    expect(detectCallerKind('ci')).toBe('script');
    expect(detectCallerKind('postinstall')).toBe('script');
    expect(detectCallerKind('cron')).toBe('script');
  });

  it('returns "llm" for non-script env ids', () => {
    expect(detectCallerKind('claude-code-lm')).toBe('llm');
  });
});

describe('workflow-skip-service — canSkipSlice (slice 2026-06-13-peaks-workflow-skip)', () => {
  let repo: string;
  beforeEach(() => {
    repo = makeRepo();
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('rejects when --reason is empty', async () => {
    const verdict = await canSkipSlice(repo, SESSION_ID, {
      rid: RD_RID,
      gatesRaw: 'QA',
      reason: '   ',
      callerKind: 'human'
    }, null);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.reason).toContain('--reason');
    }
  });

  it('rejects when --gates is empty after parsing', async () => {
    const verdict = await canSkipSlice(repo, SESSION_ID, {
      rid: RD_RID,
      gatesRaw: ',,,',
      reason: 'docs only',
      callerKind: 'human'
    }, null);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.reason).toContain('--gates');
    }
  });

  it('Rule 1: rejects when slice type is bugfix (not in allowlist)', async () => {
    makeRdRequest(repo, RD_RID, 'bugfix');
    const verdict = await canSkipSlice(repo, SESSION_ID, {
      rid: RD_RID,
      gatesRaw: 'QA',
      reason: 'small fix',
      callerKind: 'human'
    }, null);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.reason).toContain('bugfix');
      expect(verdict.reason).toContain('cannot skip');
      expect(verdict.sliceType).toBe('bugfix');
    }
  });

  it('Rule 1: rejects when slice type is feature', async () => {
    makeRdRequest(repo, RD_RID, 'feature');
    const verdict = await canSkipSlice(repo, SESSION_ID, {
      rid: RD_RID,
      gatesRaw: 'QA',
      reason: 'trivial feature',
      callerKind: 'human'
    }, null);
    expect(verdict.allowed).toBe(false);
  });

  it('Rule 1: allows docs type with valid reason', async () => {
    makeRdRequest(repo, RD_RID, 'docs');
    const verdict = await canSkipSlice(repo, SESSION_ID, {
      rid: RD_RID,
      gatesRaw: 'QA',
      reason: 'docs-only change',
      callerKind: 'human'
    }, null);
    expect(verdict.allowed).toBe(true);
    if (verdict.allowed) {
      expect(verdict.sliceType).toBe('docs');
      expect(verdict.callerKind).toBe('human');
    }
  });

  it('Rule 1: allows config type', async () => {
    makeRdRequest(repo, RD_RID, 'config');
    const verdict = await canSkipSlice(repo, SESSION_ID, {
      rid: RD_RID,
      gatesRaw: 'QA',
      reason: 'config tweak',
      callerKind: 'human'
    }, null);
    expect(verdict.allowed).toBe(true);
  });

  it('Rule 1: allows chore type', async () => {
    makeRdRequest(repo, RD_RID, 'chore');
    const verdict = await canSkipSlice(repo, SESSION_ID, {
      rid: RD_RID,
      gatesRaw: 'QA',
      reason: 'chore work',
      callerKind: 'human'
    }, null);
    expect(verdict.allowed).toBe(true);
  });

  it('Rule 1: rejects when RD artifact is missing', async () => {
    const verdict = await canSkipSlice(repo, SESSION_ID, {
      rid: '2026-06-13-no-such-rid',
      gatesRaw: 'QA',
      reason: 'whatever',
      callerKind: 'human'
    }, null);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.reason).toContain('not found');
    }
  });

  it('Rule 3: script caller without --i-have-reviewed is rejected', async () => {
    makeRdRequest(repo, RD_RID, 'docs');
    const verdict = await canSkipSlice(repo, SESSION_ID, {
      rid: RD_RID,
      gatesRaw: 'QA',
      reason: 'docs',
      callerKind: 'script'
    }, null);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.reason).toContain('--i-have-reviewed');
    }
  });

  it('Rule 3: script caller with --i-have-reviewed is allowed', async () => {
    makeRdRequest(repo, RD_RID, 'docs');
    const verdict = await canSkipSlice(repo, SESSION_ID, {
      rid: RD_RID,
      gatesRaw: 'QA',
      reason: 'docs',
      callerKind: 'script',
      iHaveReviewed: true
    }, null);
    expect(verdict.allowed).toBe(true);
  });

  it('Rule 3: human caller does not need --i-have-reviewed', async () => {
    makeRdRequest(repo, RD_RID, 'docs');
    const verdict = await canSkipSlice(repo, SESSION_ID, {
      rid: RD_RID,
      gatesRaw: 'QA',
      reason: 'docs',
      callerKind: 'human'
    }, null);
    expect(verdict.allowed).toBe(true);
  });

  it('Rule 2: same-skip on existing state is idempotent (allowed)', async () => {
    makeRdRequest(repo, RD_RID, 'docs');
    const existing = writeSkipState(repo, SESSION_ID, {
      rid: RD_RID,
      skippedGates: ['QA'],
      skipReason: 'previous docs skip',
      skipAppliedAt: '2026-06-13T07:00:00.000Z',
      skipAppliedBy: 'zhuhaifeng',
      callerKind: 'human'
    });
    const verdict = await canSkipSlice(repo, SESSION_ID, {
      rid: RD_RID,
      gatesRaw: 'QA',
      reason: 'docs',
      callerKind: 'human'
    }, readSkipState(repo, SESSION_ID, RD_RID));
    expect(verdict.allowed).toBe(true);
    expect(existing).toContain('workflow-state'); // sanity (dir, not filename)
  });

  it('Rule 2: different-skip on existing state is rejected', async () => {
    makeRdRequest(repo, RD_RID, 'docs');
    writeSkipState(repo, SESSION_ID, {
      rid: RD_RID,
      skippedGates: ['QA'],
      skipReason: 'previous skip',
      skipAppliedAt: '2026-06-13T07:00:00.000Z',
      skipAppliedBy: 'zhuhaifeng',
      callerKind: 'human'
    });
    const verdict = await canSkipSlice(repo, SESSION_ID, {
      rid: RD_RID,
      gatesRaw: 'code-review',
      reason: 'now I want to skip a different gate',
      callerKind: 'human'
    }, readSkipState(repo, SESSION_ID, RD_RID));
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.reason).toContain('different skip');
    }
  });
});

describe('workflow-skip-service — applySkip', () => {
  let repo: string;
  beforeEach(() => {
    repo = makeRepo();
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('(A) writes marker on success', async () => {
    makeRdRequest(repo, RD_RID, 'docs');
    const result = await applySkip(repo, SESSION_ID, {
      rid: RD_RID,
      gatesRaw: 'QA',
      reason: 'docs-only change',
      callerKind: 'human'
    });
    expect(result.applied).toBe(true);
    if (result.applied) {
      expect(result.skippedGates).toEqual(['QA']);
      expect(result.sliceType).toBe('docs');
      expect(result.persistedTo).toContain('workflow-state');
    }
    // Verify the file was actually written.
    const state = readSkipState(repo, SESSION_ID, RD_RID);
    expect(state).not.toBeNull();
    if (state !== null) {
      expect(state.skippedGates).toEqual(['QA']);
      expect(state.skipReason).toBe('docs-only change');
      expect(state.callerKind).toBe('human');
    }
  });

  it('(B) refuses on Rule 1 deny (type not in allowlist)', async () => {
    makeRdRequest(repo, RD_RID, 'bugfix');
    const result = await applySkip(repo, SESSION_ID, {
      rid: RD_RID,
      gatesRaw: 'QA',
      reason: 'fix should not need QA',
      callerKind: 'human'
    });
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect('reason' in result ? result.reason : '').toContain('bugfix');
    }
  });

  it('(C) refuses on Rule 3 deny (script without --i-have-reviewed)', async () => {
    makeRdRequest(repo, RD_RID, 'docs');
    const result = await applySkip(repo, SESSION_ID, {
      rid: RD_RID,
      gatesRaw: 'QA',
      reason: 'docs from CI',
      callerKind: 'script'
    });
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect('reason' in result ? result.reason : '').toContain('--i-have-reviewed');
    }
  });

  it('(D) idempotent re-skip returns applied:false, idempotent:true', async () => {
    makeRdRequest(repo, RD_RID, 'docs');
    await applySkip(repo, SESSION_ID, {
      rid: RD_RID,
      gatesRaw: 'QA',
      reason: 'first skip',
      callerKind: 'human'
    });
    const second = await applySkip(repo, SESSION_ID, {
      rid: RD_RID,
      gatesRaw: 'QA',
      reason: 'second skip (same gates)',
      callerKind: 'human'
    });
    expect(second.applied).toBe(false);
    expect(second.idempotent).toBe(true);
    if (!second.applied && second.idempotent) {
      expect(second.skippedGates).toEqual(['QA']);
    }
  });

  it('(E) --dry-run does not write the state file', async () => {
    makeRdRequest(repo, RD_RID, 'docs');
    const result = await applySkip(repo, SESSION_ID, {
      rid: RD_RID,
      gatesRaw: 'QA',
      reason: 'preview only',
      callerKind: 'human',
      dryRun: true
    });
    expect(result.applied).toBe(false);
    expect(result.persistedTo).toBeNull();
    // File should NOT exist after dry-run.
    const state = readSkipState(repo, SESSION_ID, RD_RID);
    expect(state).toBeNull();
  });
});
