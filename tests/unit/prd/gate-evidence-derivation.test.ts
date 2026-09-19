// tests/unit/prd/gate-evidence-derivation.test.ts
//
// Slice B2 (merged with the B1 repair), rid `rid-b2-gate-evidence-wiring`.
//
// F1 of `rid-b1-qa` was premise-level: after B1, all THREE frontmatter
// producers still passed nothing, so no capsule on disk carried
// `gateEvidence`. Every case below is about the DERIVATION and the WIRING that
// closes it — the success criterion is a capsule on disk, produced through the
// real CLI, that carries the field (see the `(integration)` block: it drives
// `prd handoff init` itself, not `initHandoff`).
//
// The other half is GATE C: the declaration must be TRUE. The table owns "which
// artifacts this type must produce"; `checkPrerequisites` now also owns "the
// capsule may not claim evidence it does not have".
//
// Dimensions: all four. `render` = the derived map's shape per request type;
// `behavior` = the unresolvable-type fallback; `integration` = the three real
// producers + the real gate; `a11y` = the failure names the offending key.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import type { ProgramIO } from '../../../src/cli/cli-helpers.js';
import { registerPrdCommands } from '../../../src/cli/commands/prd-commands.js';
import {
  checkPrerequisites,
  VALID_REQUEST_TYPES,
  type RequestType
} from '../../../src/services/artifacts/artifact-prerequisites.js';
import { createRequestArtifact } from '../../../src/services/artifacts/request-artifact-service.js';
import { generateEvidence } from '../../../src/services/evidence/evidence-generator.js';
import {
  checkDeclaredGateEvidence,
  deriveGateEvidence,
  deriveGateEvidenceForRequest
} from '../../../src/services/prd/gate-evidence-derivation.js';
import { readHandoffGateEvidence } from '../../../src/services/prd/handoff-gate-evidence.js';
import { autoRegenPrdHandoff } from '../../../src/services/prd/handoff-auto-regen.js';
import {
  handoffRelativePath,
  initHandoff,
  writeHandoff
} from '../../../src/services/prd/handoff-service.js';
import { GATE_EVIDENCE_KEYS, type GateEvidence } from '../../../src/services/prd/handoff-types.js';

declareDimensions('tests/unit/prd/gate-evidence-derivation.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const SESSION_ID = '2026-09-17-session-b2';
const REQUEST_ID = 'rid-b2-gate-evidence-wiring';
const BODY = '# Body\n\nB2 derivation probe.\n';

let tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const r = tempRoots.pop();
    if (r) rmSync(r, { recursive: true, force: true });
  }
});

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'peaks-b2-derive-'));
  tempRoots.push(dir);
  return dir;
}

/** The rid-scoped capsule path under a temp project root. */
function capsulePathOf(root: string): string {
  return join(root, handoffRelativePath(SESSION_ID, REQUEST_ID));
}

/** Lay down a real PRD request artifact through the real service. */
async function seedPrdArtifact(
  root: string,
  requestType: 'feature' | 'bugfix' | 'refactor' | 'docs' | 'config' | 'chore'
): Promise<void> {
  // `createRequestArtifact` refuses a date-prefixed session id whose dir does
  // not exist yet (F21), so the session home comes first — exactly as
  // `peaks workspace init` would leave it.
  mkdirSync(join(root, '.peaks', '_runtime', SESSION_ID), { recursive: true });
  await createRequestArtifact({
    projectRoot: root,
    role: 'prd',
    requestId: REQUEST_ID,
    sessionId: SESSION_ID,
    requestType,
    apply: true
  });
}

function makeIo(): ProgramIO {
  return { stdout: () => {}, stderr: () => {} };
}

/** Run the REAL `peaks prd handoff init` command against `root`. */
async function runHandoffInitCli(root: string): Promise<void> {
  const program = new Command();
  program.exitOverride();
  registerPrdCommands(program, makeIo());
  await program.parseAsync([
    'node',
    'peaks',
    'prd',
    'handoff',
    'init',
    '--rid',
    REQUEST_ID,
    '--sid',
    SESSION_ID,
    '--body',
    BODY,
    '--project',
    root,
    '--apply',
    '--json'
  ]);
}

/**
 * The key set each request type must declare — SPELLED OUT, one literal row per
 * type.
 *
 * Deliberately NOT generated from `GATE_EVIDENCE_KEYS`: an expectation derived
 * from the constant under test cannot notice that constant being wrong, because
 * both sides move together (F4 of `rid-b2-qa`). It is also the pin that was
 * missing when the `config` row was documented as three keys while the code
 * produced two — eighteen green tests went by without touching `prdHandoff`
 * (QA's AC-2 finding). The `config` row is TWO keys because
 * `CONFIG_TABLE['rd:qa-handoff']` is `[SECURITY_REVIEW]` alone.
 */
const EXPECTED_KEYS_BY_TYPE: ReadonlyArray<{
  readonly type: RequestType;
  readonly keys: readonly string[];
}> = [
  {
    type: 'feature',
    keys: ['projectScan', 'prdHandoff', 'codeReview', 'securityReview', 'perfBaseline']
  },
  {
    type: 'bugfix',
    keys: ['projectScan', 'prdHandoff', 'codeReview', 'securityReview', 'perfBaseline']
  },
  {
    type: 'refactor',
    keys: ['projectScan', 'prdHandoff', 'codeReview', 'securityReview', 'perfBaseline']
  },
  { type: 'config', keys: ['projectScan', 'securityReview'] },
  { type: 'docs', keys: [] },
  { type: 'chore', keys: [] }
];

describe('(render) the derived map declares exactly what the type must produce', () => {
  it.each(EXPECTED_KEYS_BY_TYPE)('declares exactly $keys for a $type slice', ({ type, keys }) => {
    const evidence = deriveGateEvidence({
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      requestType: type
    });
    expect(Object.keys(evidence).sort()).toEqual([...keys].sort());
  });

  it('covers every request type the repo defines', () => {
    // A seventh type added without a row above would otherwise declare nothing
    // and no case would notice.
    expect(EXPECTED_KEYS_BY_TYPE.map((row) => row.type).sort()).toEqual(
      [...VALID_REQUEST_TYPES].sort()
    );
  });

  it('declares the feature-shaped paths for a feature slice', () => {
    const evidence = deriveGateEvidence({
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      requestType: 'feature'
    });
    expect(evidence.prdHandoff).toBe(handoffRelativePath(SESSION_ID, REQUEST_ID));
    expect(evidence.codeReview).toBe(
      join('.peaks', '_runtime', SESSION_ID, 'rd', `code-review-${REQUEST_ID}.md`)
    );
    expect(evidence.perfBaseline).toBe(
      join('.peaks', '_runtime', SESSION_ID, 'audit', `perf-${REQUEST_ID}.md`)
    );
    expect(evidence.projectScan).toBe(join('.peaks', 'project-scan', 'project-scan.md'));
  });

  it('declares the CONFIG-specific security path, and no prdHandoff', () => {
    // config's security evidence is the genuinely ridless
    // `rd/security-review.md` (its own table row says so). Declaring
    // `audit/security-<rid>.md` would name a file config never writes — and
    // declaring `prdHandoff` would name a handoff config is not required to
    // have (no `AUDIT_REQUIRES_HANDOFF` row).
    const evidence = deriveGateEvidence({
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      requestType: 'config'
    });
    expect(evidence.securityReview).toBe(
      join('.peaks', '_runtime', SESSION_ID, 'rd', 'security-review.md')
    );
    expect(evidence.prdHandoff).toBeUndefined();
    expect(evidence.perfBaseline).toBeUndefined();
    expect(evidence.codeReview).toBeUndefined();
  });
});

describe('(behavior) an unresolvable type declares nothing at all', () => {
  it('returns undefined when the slice has no PRD artifact yet', async () => {
    // The pre-B2 bytes: no block, rather than a half-derived map that would be
    // a false statement about the keys it omits.
    const root = makeTempRoot();
    expect(
      await deriveGateEvidenceForRequest({
        projectRoot: root,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID
      })
    ).toBeUndefined();
  });

  it('throws for an id the service refuses, so "unreadable" is not "nothing to declare"', async () => {
    // F4 (`rid-f4-ceiling-breach`) — the other half of the case above, and the
    // distinction the old `catch { return undefined }` erased: an artifact the
    // service REFUSES to look up and an artifact that is simply not there both
    // arrived as `undefined`. `showRequestArtifact` fails `REQUEST_ID_PATTERN`
    // on a traversal-shaped rid before it touches the disk, so this is a real
    // throw from the real service — no stub, and no new seam to inject one
    // through (Karpathy #2).
    //
    // INJECTION (measured red): put `catch { return undefined }` back around
    // the `showRequestArtifact` call and this case fails on `rejects` — the
    // call resolves to `undefined`, the very value the no-artifact case above
    // asserts. That is the defect, stated as a test.
    const root = makeTempRoot();
    await expect(
      deriveGateEvidenceForRequest({
        projectRoot: root,
        sessionId: SESSION_ID,
        requestId: '../no-traversal'
      })
    ).rejects.toThrow(/Invalid request id/);

    // Both branches in one case, because the property being pinned is the
    // DISTINCTION: the same function, on the same root, still resolves
    // `undefined` when there is genuinely no artifact.
    expect(
      await deriveGateEvidenceForRequest({
        projectRoot: root,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID
      })
    ).toBeUndefined();
  });

  it('returns the type-specific map once the artifact exists', async () => {
    // `feature` here — a type WITH a gate row — so the map is non-empty and the
    // difference from the `undefined` case above is visible.
    const root = makeTempRoot();
    await seedPrdArtifact(root, 'feature');
    const evidence = await deriveGateEvidenceForRequest({
      projectRoot: root,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID
    });
    expect(evidence === undefined ? [] : Object.keys(evidence).sort()).toEqual([
      'codeReview',
      'perfBaseline',
      'prdHandoff',
      'projectScan',
      'securityReview'
    ]);
  });

  it('returns an EMPTY map for a type with no gate row', async () => {
    // Not `undefined`: the type IS resolved, and the honest answer for a docs
    // slice is "there is no gate to declare evidence to". The serializer then
    // omits the block entirely, so the capsule keeps the pre-B2 bytes.
    const root = makeTempRoot();
    await seedPrdArtifact(root, 'docs');
    expect(
      await deriveGateEvidenceForRequest({
        projectRoot: root,
        sessionId: SESSION_ID,
        requestId: REQUEST_ID
      })
    ).toEqual({});
  });
});

describe('(integration) the three producers put the field on disk', () => {
  it('writes the derived map through the REAL `prd handoff init` command', async () => {
    // THE case of this slice: F1's only proof. A capsule produced by the
    // production CLI path carries `gateEvidence`, and the reader recovers the
    // derived map from the bytes.
    const root = makeTempRoot();
    await seedPrdArtifact(root, 'feature');

    await runHandoffInitCli(root);

    const written = readFileSync(capsulePathOf(root), 'utf8');
    expect(written).toContain('gateEvidence:');
    const read = await readHandoffGateEvidence(capsulePathOf(root));
    expect(read.status).toBe('ok');
    expect(read.status === 'ok' ? read.evidence : null).toEqual(
      deriveGateEvidence({
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        requestType: 'feature'
      })
    );
  });

  it('writes no gateEvidence block for a docs slice, end to end', async () => {
    // F1 of `rid-b2-qa`, closed on the bytes: a docs/chore capsule used to
    // declare `projectScan`, a statement nothing ever read (the only consumer
    // runs at `rd:qa-handoff`, which has no docs row). The declaration is gone,
    // so this capsule is byte-identical to a pre-B2 one.
    const root = makeTempRoot();
    await seedPrdArtifact(root, 'docs');

    await runHandoffInitCli(root);

    expect(readFileSync(capsulePathOf(root), 'utf8')).not.toContain('gateEvidence');
    expect(await readHandoffGateEvidence(capsulePathOf(root))).toEqual({ status: 'field-absent' });
  });

  it('writes NO gateEvidence block when the type cannot be resolved', async () => {
    // The byte-identical fallback, asserted on the bytes: no key, not an
    // empty map.
    const root = makeTempRoot();

    await runHandoffInitCli(root);

    const written = readFileSync(capsulePathOf(root), 'utf8');
    expect(written).not.toContain('gateEvidence');
  });

  it('writes the derived map through `autoRegenPrdHandoff`', async () => {
    // The second producer. B1 gave it an optional caller-supplied map, which
    // its one production caller never passed — the same F1 hole on a second
    // axis. It derives now, so there is no input to forget.
    const root = makeTempRoot();
    await seedPrdArtifact(root, 'feature');

    const regen = await autoRegenPrdHandoff({
      projectRoot: root,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      role: 'prd'
    });
    expect(regen.status).toBe('created');
    if (regen.status !== 'created') throw new Error('unreachable');

    const read = await readHandoffGateEvidence(regen.path);
    expect(read.status === 'ok' ? Object.keys(read.evidence).sort() : []).toEqual(
      [...GATE_EVIDENCE_KEYS].sort()
    );
  });

  it('writes the derived map through `peaks evidence generate`', async () => {
    // The THIRD producer, which B1 did not touch at all (QA found it).
    const root = makeTempRoot();
    await seedPrdArtifact(root, 'config');

    const out = await generateEvidence({
      projectRoot: root,
      rid: REQUEST_ID,
      title: 'third producer probe',
      files: [],
      lineCounts: {},
      sessionId: SESSION_ID
    });

    const read = await readHandoffGateEvidence(out.handoffPath);
    expect(read.status).toBe('ok');
    expect(read.status === 'ok' ? read.evidence.securityReview : null).toBe(
      join('.peaks', '_runtime', SESSION_ID, 'rd', 'security-review.md')
    );
  });
});

describe('(integration) GATE C checks the declaration it is handed', () => {
  /** Write a capsule that declares `evidence`, through the real writer. */
  async function writeCapsule(root: string, evidence: GateEvidence): Promise<void> {
    const handoff = initHandoff({
      requestId: REQUEST_ID,
      sessionId: SESSION_ID,
      body: BODY,
      writtenAt: '2026-09-17T00:00:00.000Z',
      goals: [],
      acceptanceCriteria: [],
      preservedBehavior: [],
      gateEvidence: evidence
    });
    await writeHandoff(handoff, root);
  }

  async function gateRows(root: string, requestType: 'feature' | 'docs') {
    const result = await checkPrerequisites({
      projectRoot: root,
      sessionId: SESSION_ID,
      role: 'rd',
      newState: 'qa-handoff',
      requestId: REQUEST_ID,
      requestType
    });
    return result.missing.filter((row) => row.path.startsWith('gateEvidence'));
  }

  it('fails, naming the KEY, when a declared path is not on disk', async () => {
    const root = makeTempRoot();
    const declared = deriveGateEvidence({
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      requestType: 'feature'
    });
    await writeCapsule(root, declared);
    // Only the project scan exists; the four Gate C artifacts do not.
    mkdirSync(join(root, '.peaks', 'project-scan'), { recursive: true });
    writeFileSync(join(root, '.peaks', 'project-scan', 'project-scan.md'), '# scan\n', 'utf8');

    const rows = await gateRows(root, 'feature');
    // `prdHandoff` is NOT in this list, and its absence is the check working:
    // the capsule IS the handoff, so the path that key declares exists by
    // construction. The three audit/review paths are the ones that were never
    // written.
    expect(rows.map((row) => row.path).sort()).toEqual([
      'gateEvidence.codeReview',
      'gateEvidence.perfBaseline',
      'gateEvidence.securityReview'
    ]);
  });

  it('passes the declaration once every declared path exists', async () => {
    const root = makeTempRoot();
    const declared = deriveGateEvidence({
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      requestType: 'feature'
    });
    for (const declaredPath of Object.values(declared)) {
      if (declaredPath === undefined) continue;
      const absolute = join(root, declaredPath);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, 'schemaVersion: 2\nsha256: stub\n', 'utf8');
    }
    await writeCapsule(root, declared);

    expect(await gateRows(root, 'feature')).toEqual([]);
  });

  it('leaves a pre-B1 capsule alone (no declaration is not a failure)', async () => {
    const root = makeTempRoot();
    const handoff = initHandoff({
      requestId: REQUEST_ID,
      sessionId: SESSION_ID,
      body: BODY,
      writtenAt: '2026-09-17T00:00:00.000Z',
      goals: [],
      acceptanceCriteria: [],
      preservedBehavior: []
    });
    await writeHandoff(handoff, root);

    expect(await gateRows(root, 'feature')).toEqual([]);
  });

  it('refuses a capsule whose declaration is broken, not empty', async () => {
    // B1's point, used by its consumer: `field-absent` passes, a declaration
    // that cannot be read does not.
    const root = makeTempRoot();
    mkdirSync(join(root, '.peaks', '_runtime', SESSION_ID, 'prd'), { recursive: true });
    writeFileSync(
      capsulePathOf(root),
      [
        '---',
        'requestId: ' + REQUEST_ID,
        `sessionId: ${SESSION_ID}`,
        'schemaVersion: 2',
        `sha256: ${'a'.repeat(64)}`,
        `handoffHash: "${'a'.repeat(64)}"`,
        'writtenAt: 2026-09-17T00:00:00.000Z',
        'goals: []',
        'acceptanceCriteria: []',
        'preservedBehavior: []',
        'handoffPath: prd/handoff-' + REQUEST_ID + '.md',
        'gateEvidence: [a.md, b.md]',
        '---',
        BODY
      ].join('\n'),
      'utf8'
    );

    const rows = await gateRows(root, 'feature');
    expect(rows.map((row) => row.path)).toEqual(['gateEvidence(field-not-map)']);
  });

  it('requires nothing of a docs slice (its gate row has no evidence)', async () => {
    const root = makeTempRoot();
    await writeCapsule(root, { projectScan: '.peaks/project-scan/project-scan.md' });

    expect(await gateRows(root, 'docs')).toEqual([]);
  });

  it('passes an EMPTY declaration — but the table still fails the type', async () => {
    // The judgement call, pinned: `gateEvidence: {}` is a weak claim, not a
    // false one. This check validates the DECLARATION ("are the claimed paths
    // real?"); the type's REQUIREMENTS stay the table's job, so an empty map
    // cannot open the gate. Failing it here would make this check a second copy
    // of the requirement — the divergence it exists to avoid.
    //
    // The capsule is hand-written ON PURPOSE: `initHandoff({gateEvidence: {}})`
    // renders NO block (the serializer omits an empty map), so it would reach
    // this check as `field-absent` and the case would pass for the wrong
    // reason. An injection probe caught exactly that — the first version of
    // this case declared nothing at all.
    const root = makeTempRoot();
    mkdirSync(join(root, '.peaks', '_runtime', SESSION_ID, 'prd'), { recursive: true });
    writeFileSync(
      capsulePathOf(root),
      [
        '---',
        `requestId: ${REQUEST_ID}`,
        `sessionId: ${SESSION_ID}`,
        'schemaVersion: 2',
        `sha256: ${'a'.repeat(64)}`,
        `handoffHash: "${'a'.repeat(64)}"`,
        'writtenAt: 2026-09-17T00:00:00.000Z',
        'goals: []',
        'acceptanceCriteria: []',
        'preservedBehavior: []',
        `handoffPath: prd/handoff-${REQUEST_ID}.md`,
        'gateEvidence: {}',
        '---',
        BODY
      ].join('\n'),
      'utf8'
    );
    // Guard the guard: an empty map, not `field-absent`.
    expect(await readHandoffGateEvidence(capsulePathOf(root))).toEqual({
      status: 'ok',
      evidence: {},
      unknownKeys: []
    });

    expect(await gateRows(root, 'feature')).toEqual([]);
    const result = await checkPrerequisites({
      projectRoot: root,
      sessionId: SESSION_ID,
      role: 'rd',
      newState: 'qa-handoff',
      requestId: REQUEST_ID,
      requestType: 'feature'
    });
    // Still CLOSED, by the table, for the four artifacts a feature slice must
    // produce — and the capsule itself is one of them, so it resolves.
    expect(result.ok).toBe(false);
    // The table reports its rows with `<rid>` RESOLVED, unlike the declaration
    // rows, which name the key.
    expect(result.missing.map((row) => row.path)).toContain(`rd/code-review-${REQUEST_ID}.md`);
    expect(result.missing.map((row) => row.path)).toContain(`audit/perf-${REQUEST_ID}.md`);
  });

  it('reports a missing capsule without claiming a declaration failure', async () => {
    const root = makeTempRoot();
    const result = await checkDeclaredGateEvidence({
      projectRoot: root,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID
    });
    expect(result).toEqual({ ok: true, missing: [], warnings: [] });
  });
});

describe('(a11y) the failure names the key and the path a human must create', () => {
  it('names both the offending key and the declared path in its message', async () => {
    const root = makeTempRoot();
    const handoff = initHandoff({
      requestId: REQUEST_ID,
      sessionId: SESSION_ID,
      body: BODY,
      writtenAt: '2026-09-17T00:00:00.000Z',
      goals: [],
      acceptanceCriteria: [],
      preservedBehavior: [],
      gateEvidence: { perfBaseline: '.peaks/_runtime/x/audit/perf-missing.md' }
    });
    await writeHandoff(handoff, root);

    const rows = await checkpointRows(root);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.path).toBe('gateEvidence.perfBaseline');
    expect(rows[0]?.description).toContain('perfBaseline');
    expect(rows[0]?.description).toContain('.peaks/_runtime/x/audit/perf-missing.md');
  });

  it('warns (without blocking) about a key outside the five', async () => {
    const root = makeTempRoot();
    mkdirSync(join(root, '.peaks', '_runtime', SESSION_ID, 'prd'), { recursive: true });
    writeFileSync(
      capsulePathOf(root),
      ['---', 'schemaVersion: 2', 'gateEvidence:', '  projectScans: typo.md', '---', BODY].join(
        '\n'
      ),
      'utf8'
    );

    const result = await checkDeclaredGateEvidence({
      projectRoot: root,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.map((warning) => warning.code)).toEqual(['gate-evidence-unknown-key']);
    expect(result.warnings[0]?.message).toContain('projectScans');
  });
});

/** The `gateEvidence.*` rows from a real gate run, for the a11y cases. */
async function checkpointRows(root: string) {
  const result = await checkPrerequisites({
    projectRoot: root,
    sessionId: SESSION_ID,
    role: 'rd',
    newState: 'qa-handoff',
    requestId: REQUEST_ID,
    requestType: 'feature'
  });
  return result.missing.filter((row) => row.path.startsWith('gateEvidence'));
}
