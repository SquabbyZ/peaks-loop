// tests/unit/services/artifacts/prd-capsule-rid-scoping.test.ts
//
// Guards slice `2026-09-14-prd-capsule-rid-scoping` (job
// `2026-09-14-followups`, 2/4).
//
// The defect this file exists for, measured 2026-09-14 in session
// `2026-09-13-session-21878f`: `prd/handoff.md` carried no rid and was ONE slot
// per session. `peaks prd handoff init` overwrote it on every call, and
// `AUDIT_REQUIRES_HANDOFF` pinned only two substrings (`schemaVersion: 2`,
// `sha256:`) — never WHOSE rid the file named. So a four-slice job passed that
// prerequisite on a capsule written for a different line of work, and the
// artifact directory ended up self-contradictory: the five audit/review
// artifacts had been rid-scoped by slice `2026-09-14-audit-artifact-rid-scoping`
// and this capsule was the one it left behind.
//
// The fix is that slice's own three-tier shape, copied rather than reinvented:
// `prd/handoff-<rid>.md` → `prd/handoff.md`, with every producer moved onto the
// rid-scoped name.
//
// So the assertions below are deliberately not "the gate passes". They are:
//   - AC2: the gate resolves EACH rid to ITS OWN capsule
//   - AC1: two rids' capsules coexist on disk and both are retrievable
//   - AC3: the pre-scoping bare name still resolves (the legacy tier)
//   - AC4: a genuinely missing capsule still FAILS (the control group —
//          "the gate can now find two rids" does not prove it still rejects a
//          third, nor one whose body violates the contract)
//   - AC5: all three producers write the rid-scoped path, and
//          `peaks prd handoff verify` passes on what they write
//
// Dimensions covered:
//   - render:      the declared naming contract (which path carries `<rid>`)
//   - behavior:    resolution outcome per rid, per on-disk layout
//   - integration: a real temp `.peaks/_runtime/<sid>/` tree, the REAL prereq
//                  registry, the three REAL producers and both audit detectors
//   - a11y:        omitted — the resolver and the detectors return envelopes;
//                  they print nothing and exit nothing

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import {
  checkPrerequisites,
  getPrerequisitesFor,
  type PrerequisiteCheckResult
} from '../../../../src/services/artifacts/artifact-prerequisites.js';
import { autoRegenPrdHandoff } from '../../../../src/services/prd/handoff-auto-regen.js';
import {
  handoffRelativePath,
  initHandoff,
  readHandoff,
  resolveHandoffPath,
  verifyHandoff,
  writeHandoff
} from '../../../../src/services/prd/handoff-service.js';
import { generateEvidence } from '../../../../src/services/evidence/evidence-generator.js';
import { detectSecurityAudit } from '../../../../src/services/audit-independent/security-audit-service.js';
import { detectPerfAudit } from '../../../../src/services/audit-independent/perf-audit-service.js';

declareDimensions(
  'tests/unit/services/artifacts/prd-capsule-rid-scoping.test.ts',
  ['render', 'behavior', 'integration'],
  [
    {
      dim: 'a11y',
      reason: 'resolver + detectors return result envelopes; print nothing and exit nothing'
    }
  ]
);

const SESSION_ID = '2026-09-14-session-probe';
const RID_A = '2026-09-14-probe-alpha';
const RID_B = '2026-09-14-probe-beta';
const RID_C = '2026-09-14-probe-gamma';

/** A body the capsule contract is happy with — the same markers the real
 *  writer emits, so a passing case here is a passing case in production. */
function capsuleBody(rid: string): string {
  return `# PRD handoff — ${rid}\n\nschemaVersion: 2\nsha256: ${'a'.repeat(64)}\n`;
}

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

function makeProjectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-prd-capsule-'));
  tempRoots.push(root);
  return root;
}

/** Write one slice's capsule through the real writer (`peaks prd handoff
 *  init --apply` reaches `initHandoff` + `writeHandoff`). */
async function writeCapsule(root: string, rid: string): Promise<string> {
  const handoff = initHandoff({
    requestId: rid,
    sessionId: SESSION_ID,
    body: capsuleBody(rid),
    writtenAt: '2026-09-14T00:00:00.000Z',
    goals: [],
    acceptanceCriteria: [],
    preservedBehavior: []
  });
  return (await writeHandoff(handoff, root)).path;
}

/** Write the PRE-scoping layout by hand: one bare capsule per session. */
function writeLegacyCapsule(root: string): string {
  const path = join(root, '.peaks', '_runtime', SESSION_ID, 'prd', 'handoff.md');
  mkdirSync(join(root, '.peaks', '_runtime', SESSION_ID, 'prd'), { recursive: true });
  writeFileSync(
    path,
    [
      '---',
      'requestId: 2026-09-01-foreign',
      `sessionId: ${SESSION_ID}`,
      'schemaVersion: 2',
      `sha256: ${'b'.repeat(64)}`,
      `handoffHash: ${'b'.repeat(64)}`,
      'writtenAt: 2026-09-01T00:00:00.000Z',
      'goals: []',
      'acceptanceCriteria: []',
      'preservedBehavior: []',
      'handoffPath: prd/handoff.md',
      '---',
      capsuleBody('2026-09-01-foreign')
    ].join('\n'),
    'utf8'
  );
  return path;
}

/** The `prd/handoff` entries in a check result — the gate reports one
 *  `missing` row per failed check, so a body violation shows up here too. */
function handoffRows(result: PrerequisiteCheckResult): readonly string[] {
  return result.missing.filter((m) => m.path.startsWith('prd/handoff')).map((m) => m.path);
}

function check(root: string, rid: string): Promise<PrerequisiteCheckResult> {
  return checkPrerequisites({
    projectRoot: root,
    sessionId: SESSION_ID,
    role: 'rd',
    newState: 'qa-handoff',
    requestId: rid,
    requestType: 'feature'
  });
}

describe('(render) the capsule naming contract', () => {
  it('should name `prd/handoff-<rid>.md` with the bare name as its legacy tier', () => {
    const prereq = getPrerequisitesFor('rd', 'qa-handoff', 'feature').find(
      (candidate) => candidate.legacyRelativePath === 'prd/handoff.md'
    );
    // Fail loudly if the tier is dropped: that is the back-compat axis.
    expect(prereq?.relativePath).toBe('prd/handoff-<rid>.md');
    // Found through the tier rather than the primary, so this file also fails
    // if the source is retired from the table altogether.
    expect(prereq?.mustContain).toEqual(['schemaVersion: 2', 'sha256:']);
  });

  it('should build the rid-scoped relative path, not the bare one', () => {
    expect(handoffRelativePath(SESSION_ID, RID_A)).toBe(
      join('.peaks', '_runtime', SESSION_ID, 'prd', `handoff-${RID_A}.md`)
    );
  });
});

describe('(behavior) AC1/AC2 — two rids in one session', () => {
  it('should let each rid keep its own capsule, both readable (AC1)', async () => {
    const root = makeProjectRoot();
    const pathA = await writeCapsule(root, RID_A);
    const pathB = await writeCapsule(root, RID_B);

    // Physically different files — the collision the slice exists to remove.
    expect(pathA).not.toBe(pathB);
    expect(readFileSync(pathA, 'utf8')).not.toBe(readFileSync(pathB, 'utf8'));

    // ...and each one still says whose it is.
    expect((await readHandoff(pathA)).frontmatter.requestId).toBe(RID_A);
    expect((await readHandoff(pathB)).frontmatter.requestId).toBe(RID_B);
  });

  it('should resolve each rid to its OWN capsule (AC2)', async () => {
    const root = makeProjectRoot();
    await writeCapsule(root, RID_A);
    await writeCapsule(root, RID_B);

    expect(handoffRows(await check(root, RID_A))).toEqual([]);
    expect(handoffRows(await check(root, RID_B))).toEqual([]);
  });

  it("should not let one rid's capsule satisfy another rid (the control)", async () => {
    const root = makeProjectRoot();
    await writeCapsule(root, RID_B);

    // RID_A has no capsule even though its session does. Before this slice the
    // session had exactly one slot, so this is the assertion that would have
    // passed on somebody else's evidence.
    expect(handoffRows(await check(root, RID_A))).toEqual([`prd/handoff-${RID_A}.md`]);
    expect(handoffRows(await check(root, RID_B))).toEqual([]);
  });
});

describe('(behavior) AC3 — the pre-scoping layout still resolves', () => {
  it('should accept a session that holds only the bare capsule', async () => {
    const root = makeProjectRoot();
    const legacy = writeLegacyCapsule(root);

    // The bare capsule names `2026-09-01-foreign`, and the gate accepts it for
    // an unrelated rid. That is AC3 by construction: the legacy tier is
    // deliberately rid-blind so the three sessions on disk
    // (`2026-09-06-session-a87ca4`, `2026-09-12-session-e37ef0`,
    // `2026-09-13-session-21878f`) keep passing. The scoping binds for
    // capsules written from now on.
    expect(handoffRows(await check(root, RID_A))).toEqual([]);
    expect(resolveHandoffPath({ projectRoot: root, sessionId: SESSION_ID, requestId: RID_A })).toBe(
      legacy
    );
  });

  it('should keep the legacy body contract — a bad bare capsule is still refused', async () => {
    const root = makeProjectRoot();
    const path = writeLegacyCapsule(root);
    // Right location for the tier, unusable content: the gate's markers live
    // in the frontmatter, so this is a whole-file rewrite, not a body edit.
    writeFileSync(path, '# PRD handoff\n\nhandoffHash: "aa"\n', 'utf8');

    // The tier changes WHERE the file may be, never WHAT it must contain.
    const rows = handoffRows(await check(root, RID_A));
    expect(rows).toHaveLength(1);
  });

  it('should still refuse the legacy layout when the capsule is genuinely absent', async () => {
    const root = makeProjectRoot();
    expect(handoffRows(await check(root, RID_A))).toEqual([`prd/handoff-${RID_A}.md`]);
  });
});

describe('(behavior) AC4 — the clean control group', () => {
  it('should fail a rid whose capsule is missing even when a sibling has one', async () => {
    const root = makeProjectRoot();
    await writeCapsule(root, RID_A);
    await writeCapsule(root, RID_B);

    const rows = handoffRows(await check(root, RID_C));
    expect(rows).toEqual([`prd/handoff-${RID_C}.md`]);
  });

  it('should still fail a capsule whose body violates the contract', async () => {
    const root = makeProjectRoot();
    const path = await writeCapsule(root, RID_A);
    // Right path, unusable content: `existsSync` alone would open the gate.
    writeFileSync(path, '# PRD handoff\n\nschemaVersion: 1\nhandoffHash: "aa"\n', 'utf8');

    const rows = handoffRows(await check(root, RID_A));
    expect(rows).toEqual([`prd/handoff-${RID_A}.md`]);
  });
});

describe('(integration) AC5 — every producer moved, and verify follows', () => {
  it('should write the rid-scoped path through `peaks prd handoff init`', async () => {
    const root = makeProjectRoot();
    const path = await writeCapsule(root, RID_A);
    expect(path).toBe(join(root, handoffRelativePath(SESSION_ID, RID_A)));
    expect((await verifyHandoff(path)).ok).toBe(true);
  });

  it('should write the rid-scoped path through the auto-regen producer', async () => {
    const root = makeProjectRoot();
    const requests = join(root, '.peaks', '_runtime', SESSION_ID, 'prd', 'requests');
    mkdirSync(requests, { recursive: true });
    writeFileSync(join(requests, `${RID_A}.md`), capsuleBody(RID_A), 'utf8');

    const result = await autoRegenPrdHandoff({
      projectRoot: root,
      sessionId: SESSION_ID,
      requestId: RID_A,
      role: 'prd'
    });
    expect(result.status).toBe('created');
    if (result.status !== 'created') throw new Error('unreachable');
    expect(result.path).toBe(join(root, handoffRelativePath(SESSION_ID, RID_A)));
    expect((await verifyHandoff(result.path)).ok).toBe(true);
  });

  it('should write the rid-scoped path through `peaks evidence generate`', async () => {
    const root = makeProjectRoot();
    const out = await generateEvidence({
      projectRoot: root,
      rid: RID_A,
      title: 'producer move probe',
      files: [],
      lineCounts: {},
      sessionId: SESSION_ID
    });
    expect(out.handoffPath).toBe(join(root, handoffRelativePath(SESSION_ID, RID_A)));
    expect((await verifyHandoff(out.handoffPath)).ok).toBe(true);
  });
});

describe('(integration) the readers follow the writer', () => {
  it('should let both audit detectors find the rid-scoped capsule (AC5)', async () => {
    const root = makeProjectRoot();
    await writeCapsule(root, RID_A);
    // No template in this tree, so `ready` is unreachable and the FIRST state
    // the detector can report is `template-missing` — which is exactly the
    // evidence needed: the capsule was FOUND, the template was not.
    for (const state of [
      detectSecurityAudit({ projectRoot: root, sessionId: SESSION_ID, requestId: RID_A }).state,
      detectPerfAudit({ projectRoot: root, sessionId: SESSION_ID, requestId: RID_A }).state
    ]) {
      expect(state).toBe('template-missing');
    }
  });

  it('should report missing for a rid-less probe on a rid-scoped-only tree (disclosed residual)', async () => {
    const root = makeProjectRoot();
    await writeCapsule(root, RID_A);

    // `peaks security-audit detect --sid` carries no rid, so it can name only
    // the bare path. It fails CLOSED: reporting "missing" for a capsule it
    // cannot name beats picking one of the session's capsules at random, which
    // is the cross-slice mix-up this scoping exists to close.
    expect(detectSecurityAudit({ projectRoot: root, sessionId: SESSION_ID }).state).toBe(
      'handoff-missing'
    );
    expect(detectPerfAudit({ projectRoot: root, sessionId: SESSION_ID }).state).toBe(
      'handoff-missing'
    );
    // ...and the residual is scoped to that surface: the same tree resolves
    // when the caller can pass the rid.
    expect(
      resolveHandoffPath({ projectRoot: root, sessionId: SESSION_ID, requestId: RID_A })
    ).not.toBeNull();
  });
});
