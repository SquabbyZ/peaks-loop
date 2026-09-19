// tests/unit/prd/handoff-gate-evidence.test.ts
//
// Slice B1 (`rid-b1-gate-evidence-producer`). The previous revision of this
// file described `gateEvidence` as an ARRAY of PATHS and its round-trip case
// carried the comment "initHandoff does not yet accept gateEvidence as input
// — adding the input parameter is the real AC-5 source change but is
// intentionally deferred to a follow-up slice". That follow-up is this slice,
// so the array fixtures are gone and the round-trip case now runs through the
// REAL producer. Four descriptions of this field disagreed (reader code,
// reader header, these tests, and
// `skills/bee/peaks-rd/references/writing-handoff-frontmatter.md:35-41`); the
// schema doc won, per the user's decision.
//
// The case that carries the slice is
// `(integration) initHandoff → writeHandoff → readHandoffGateEvidence`: if it
// cannot go red there is no producer and this slice did not land.
//
// Dimensions: all four. `render` = the serialized bytes; `behavior` = the
// reader's status classification; `integration` = the real producers against a
// real temp `.peaks` tree; `a11y` = the failure vocabulary an operator reads.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  readHandoffGateEvidence,
  type HandoffGateEvidenceResult
} from '../../../src/services/prd/handoff-gate-evidence.js';
import { serializeHandoffFrontmatter } from '../../../src/services/prd/handoff-frontmatter.js';
import {
  initHandoff,
  readHandoff,
  verifyHandoff,
  writeHandoff
} from '../../../src/services/prd/handoff-service.js';
import { autoRegenPrdHandoff } from '../../../src/services/prd/handoff-auto-regen.js';
import { deriveGateEvidence } from '../../../src/services/prd/gate-evidence-derivation.js';
import {
  GATE_EVIDENCE_KEYS,
  type GateEvidence,
  type HandoffFrontmatter
} from '../../../src/services/prd/handoff-types.js';

declareDimensions('tests/unit/prd/handoff-gate-evidence.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const SESSION_ID = '2026-09-17-session-b1';
const REQUEST_ID = 'rid-b1-gate-evidence-producer';
const BODY = '# Body\n\nAcceptance checks:\n- B1: the reader reports the map.\n';

/** All five keys, the shape the schema doc renders. */
const ALL_FIVE: GateEvidence = {
  projectScan: '.peaks/project-scan/project-scan.md',
  prdHandoff: `.peaks/_runtime/${SESSION_ID}/prd/handoff-${REQUEST_ID}.md`,
  codeReview: `.peaks/_runtime/${SESSION_ID}/rd/code-review-${REQUEST_ID}.md`,
  securityReview: `.peaks/_runtime/${SESSION_ID}/audit/security-${REQUEST_ID}.md`,
  perfBaseline: `.peaks/_runtime/${SESSION_ID}/audit/perf-${REQUEST_ID}.md`
};

let tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const r = tempRoots.pop();
    if (r) rmSync(r, { recursive: true, force: true });
  }
});

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'peaks-gate-evidence-'));
  tempRoots.push(dir);
  return dir;
}

/** Lay a hand-written capsule down and return its path. */
function writeTempHandoff(content: string): string {
  const dir = makeTempRoot();
  const filePath = join(dir, 'handoff.md');
  writeFileSync(filePath, content, 'utf8');
  return filePath;
}

/** The minimal frontmatter the reader's fence scan expects. */
function handoffWithGateEvidenceBlock(block: string): string {
  return ['---', 'schemaVersion: 2', 'requestId: r-1', block, '---', '', '# Body'].join('\n');
}

/** Narrow to the `ok` branch, failing loudly (with the status) otherwise. */
function expectOk(result: HandoffGateEvidenceResult): {
  evidence: GateEvidence;
  unknownKeys: readonly string[];
} {
  if (result.status !== 'ok') {
    throw new Error(`expected status 'ok', got '${result.status}'`);
  }
  return result;
}

/** The `---`-delimited frontmatter, verbatim, without the delimiters. */
function frontmatterBlockOf(rendered: string): string {
  const lines = rendered.split('\n');
  const close = lines.indexOf('---', 1);
  expect(close).toBeGreaterThan(1);
  return lines.slice(1, close).join('\n');
}

describe('(render) serializeHandoffFrontmatter renders the map, or nothing', () => {
  function frontmatterOf(evidence: GateEvidence | undefined): HandoffFrontmatter {
    const handoff = initHandoff({
      requestId: REQUEST_ID,
      sessionId: SESSION_ID,
      body: BODY,
      writtenAt: '2026-09-17T00:00:00.000Z',
      goals: ['G1'],
      acceptanceCriteria: ['AC-1'],
      preservedBehavior: [],
      ...(evidence === undefined ? {} : { gateEvidence: evidence })
    });
    return handoff.frontmatter;
  }

  it('omits the field entirely when no evidence is declared', () => {
    const rendered = serializeHandoffFrontmatter(frontmatterOf(undefined));
    expect(rendered).not.toContain('gateEvidence');
  });

  it('omits the field for an empty map rather than emitting `gateEvidence: {}`', () => {
    // An empty declaration and no declaration render the SAME bytes: every
    // handoff that declares nothing stays byte-identical to a pre-B1 capsule.
    const rendered = serializeHandoffFrontmatter(frontmatterOf({}));
    expect(rendered).not.toContain('gateEvidence');
  });

  it('emits the five keys in canonical order, after every anchored field', () => {
    const lines = frontmatterBlockOf(serializeHandoffFrontmatter(frontmatterOf(ALL_FIVE))).split(
      '\n'
    );
    // The two scalars the gate and both audit loaders match as `^`-anchored
    // lines must stay ABOVE the new block — nothing may be inserted before
    // them.
    for (const anchor of ['schemaVersion: 2', 'sha256: ', 'handoffHash: ']) {
      const index = lines.findIndex((line) => line.startsWith(anchor));
      expect(index).toBeGreaterThan(0);
      expect(index).toBeLessThan(lines.indexOf('gateEvidence:'));
    }
    const blockStart = lines.indexOf('gateEvidence:');
    expect(lines.slice(blockStart + 1, blockStart + 1 + GATE_EVIDENCE_KEYS.length)).toEqual(
      GATE_EVIDENCE_KEYS.map((key) => `  ${key}: ${JSON.stringify(ALL_FIVE[key] ?? '')}`)
    );
  });

  it('round-trips through YAML: serialize → parse → the same map', () => {
    // Requirement 8, without touching the disk.
    const parsed = parseYaml(
      frontmatterBlockOf(serializeHandoffFrontmatter(frontmatterOf(ALL_FIVE)))
    ) as Record<string, unknown>;
    expect(parsed['gateEvidence']).toEqual(ALL_FIVE);
  });

  it('refuses an unknown key instead of dropping it silently (F3)', () => {
    // Before B2 this map rendered NO block at all, so the capsule read back as
    // "declared nothing" — a typo erased by silence, contradicting the type's
    // own promise that unknown keys are reported rather than dropped. The type
    // system catches literal typos; `JSON.parse` is the runtime path it cannot
    // see, and the B2 derivation is exactly such an adapter feeding this
    // serializer, so the guard is runtime and the serializer is where it
    // lives (one funnel, all three producers).
    const fromJson = JSON.parse('{"projectScans": "typo.md"}') as GateEvidence;
    expect(() => serializeHandoffFrontmatter(frontmatterOf(fromJson))).toThrow(
      /unknown gateEvidence key\(s\) \[projectScans\]/
    );
  });

  it('refuses a non-string evidence value', () => {
    const fromJson = JSON.parse('{"projectScan": 42}') as unknown as GateEvidence;
    expect(() => serializeHandoffFrontmatter(frontmatterOf(fromJson))).toThrow(/must be strings/);
  });

  it('quotes path scalars so a Windows backslash survives the YAML round trip', () => {
    const winPath = '.peaks\\_runtime\\project-scan.md';
    const parsed = parseYaml(
      frontmatterBlockOf(serializeHandoffFrontmatter(frontmatterOf({ projectScan: winPath })))
    ) as Record<string, unknown>;
    expect(parsed['gateEvidence']).toEqual({ projectScan: winPath });
  });
});

describe('(behavior) readHandoffGateEvidence classifies each outcome distinctly', () => {
  it('reports `file-missing` for a path that does not exist', async () => {
    const result = await readHandoffGateEvidence('/nonexistent/path/handoff.md');
    expect(result).toEqual({ status: 'file-missing' });
  });

  it('reports `frontmatter-malformed` when the closing fence is absent', async () => {
    // Was `null` before B1: indistinguishable from "declared nothing".
    const filePath = writeTempHandoff('---\ngateEvidence:\n  projectScan: a.md\n');
    const result = await readHandoffGateEvidence(filePath);
    expect(result).toEqual({ status: 'frontmatter-malformed', reason: 'no-frontmatter-fence' });
  });

  it('reports `frontmatter-malformed` with the parser message when the YAML is broken', async () => {
    const filePath = writeTempHandoff(
      '---\nschemaVersion: 2\ngateEvidence: {unclosed\n---\n\n# Body\n'
    );
    const result = await readHandoffGateEvidence(filePath);
    expect(result.status).toBe('frontmatter-malformed');
    expect(result.status === 'frontmatter-malformed' ? result.reason : '').toContain(
      'yaml-parse-error'
    );
  });

  it('reports `field-absent` (not an error) for a pre-B1 handoff', async () => {
    // Invariant 1: a capsule written before this field existed still parses.
    const filePath = writeTempHandoff(
      '---\nschemaVersion: 2\nrequestId: r-1\nhandoffHash: abc\n---\n\n# Body\n'
    );
    const result = await readHandoffGateEvidence(filePath);
    expect(result).toEqual({ status: 'field-absent' });
  });

  it('reports `field-not-map` for the pre-B1 ARRAY shape, naming the type found', async () => {
    // The shape this file's own fixtures used to write. It is a broken
    // declaration now, not a claim — and it is not `null`.
    const filePath = writeTempHandoff(
      handoffWithGateEvidenceBlock('gateEvidence: [audit/security-r.md]')
    );
    expect(await readHandoffGateEvidence(filePath)).toEqual({
      status: 'field-not-map',
      actualType: 'array'
    });
  });

  it('reports `field-not-map` when the key is present but empty (`gateEvidence:`)', async () => {
    // `in`, not `!== undefined`: an empty value parses to null and IS a
    // declaration, so it must not read as if nothing were written.
    const filePath = writeTempHandoff(handoffWithGateEvidenceBlock('gateEvidence:'));
    expect(await readHandoffGateEvidence(filePath)).toEqual({
      status: 'field-not-map',
      actualType: 'null'
    });
  });

  it('reports `value-not-string` with every offending key, instead of dropping them', async () => {
    // The old reader FILTERED non-string entries out and returned what was
    // left, so `[42, valid-gate, true]` became `['valid-gate']` and the
    // caller never learned two entries were unusable. The whole declaration
    // is refused now.
    const filePath = writeTempHandoff(
      handoffWithGateEvidenceBlock(
        ['gateEvidence:', '  projectScan: 42', '  codeReview: ok.md', '  perfBaseline: true'].join(
          '\n'
        )
      )
    );
    expect(await readHandoffGateEvidence(filePath)).toEqual({
      status: 'value-not-string',
      keys: ['perfBaseline', 'projectScan']
    });
  });

  it('reads a partial map without inventing the keys that are absent', async () => {
    // Requirement 3: a slice that ran two of five gates declares two.
    const filePath = writeTempHandoff(
      handoffWithGateEvidenceBlock(
        ['gateEvidence:', '  projectScan: scan.md', '  perfBaseline: perf.md'].join('\n')
      )
    );
    expect(expectOk(await readHandoffGateEvidence(filePath)).evidence).toEqual({
      projectScan: 'scan.md',
      perfBaseline: 'perf.md'
    });
  });

  it('reads all five keys of a flow-style map', async () => {
    const flow = `gateEvidence: {${GATE_EVIDENCE_KEYS.map((k) => `${k}: ${k}.md`).join(', ')}}`;
    const filePath = writeTempHandoff(handoffWithGateEvidenceBlock(flow));
    // The EXPECTATION is written out in full, not derived from
    // `GATE_EVIDENCE_KEYS` (F4 of `rid-b2-qa`): an expectation generated from
    // the constant under test moves with it, so it could not notice that
    // constant being wrong. These five literals can.
    expect(expectOk(await readHandoffGateEvidence(filePath)).evidence).toEqual({
      projectScan: 'projectScan.md',
      prdHandoff: 'prdHandoff.md',
      codeReview: 'codeReview.md',
      securityReview: 'securityReview.md',
      perfBaseline: 'perfBaseline.md'
    });
  });

  it('returns an empty map (not `field-absent`) for `gateEvidence: {}`', async () => {
    // Requirement 6, the judgement call: the field was WRITTEN and declares
    // nothing. That is a fact about the author, distinct from never writing the
    // field, so the reader reports `ok` with zero keys. Collapsing it into
    // `field-absent` would hide a hand-authored empty stub.
    //
    // What Gate C then does with it is asserted, not assumed — see
    // `(integration) GATE C checks the declaration it is handed` in
    // `gate-evidence-derivation.test.ts`. An empty declaration PASSES the
    // declaration check, because that check asks "are the paths this capsule
    // claims real?", and an empty claim names no path to check; the type's
    // evidence requirements are the TABLE's job (`PREREQUISITES_BY_TYPE`), so an
    // empty map cannot open the gate — a weak claim, not a false one. The
    // previous revision of this comment said the opposite ("zero of five keys
    // present ⇒ fail"), which QA measured as false.
    const filePath = writeTempHandoff(handoffWithGateEvidenceBlock('gateEvidence: {}'));
    expect(await readHandoffGateEvidence(filePath)).toEqual({
      status: 'ok',
      evidence: {},
      unknownKeys: []
    });
  });

  it('reports keys outside the five as `unknownKeys` rather than dropping them', async () => {
    // A typo'd key is the reason a required gate reads as undeclared, so the
    // reader names it instead of silently ignoring it.
    const filePath = writeTempHandoff(
      handoffWithGateEvidenceBlock(['gateEvidence:', '  projectScans: scan.md'].join('\n'))
    );
    const result = expectOk(await readHandoffGateEvidence(filePath));
    expect(result.evidence).toEqual({});
    expect(result.unknownKeys).toEqual(['projectScans']);
  });
});

describe('(integration) the producers and the reader agree end to end', () => {
  function build(root: string, evidence: GateEvidence) {
    return initHandoff({
      requestId: REQUEST_ID,
      sessionId: SESSION_ID,
      body: BODY,
      writtenAt: '2026-09-17T00:00:00.000Z',
      goals: ['G1'],
      acceptanceCriteria: ['AC-1'],
      preservedBehavior: [],
      gateEvidence: evidence
    });
  }

  it('round-trips `initHandoff` → `writeHandoff` → `readHandoffGateEvidence`', async () => {
    // THE case of this slice: the only proof a producer exists. Break the
    // `gateEvidence` spread in `initHandoff` (or the block in
    // `handoff-frontmatter.ts`) and this fails.
    const root = makeTempRoot();
    const written = await writeHandoff(build(root, ALL_FIVE), root);

    const result = await readHandoffGateEvidence(written.path);
    expect(result).toEqual({ status: 'ok', evidence: ALL_FIVE, unknownKeys: [] });
  });

  it('leaves the capsule readable and verifiable with the field present', async () => {
    // The new field must not disturb the hash contract or the anchors: the
    // body hash is unchanged and every pre-existing field still parses.
    const root = makeTempRoot();
    const written = await writeHandoff(build(root, ALL_FIVE), root);

    expect(await verifyHandoff(written.path)).toMatchObject({ ok: true });
    const handoff = await readHandoff(written.path);
    expect(handoff.frontmatter.gateEvidence).toEqual(ALL_FIVE);
    expect(handoff.frontmatter.schemaVersion).toBe('2');
  });

  it('writes no `gateEvidence` block for a producer call that declares none', async () => {
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
    const written = await writeHandoff(handoff, root);
    // Pre-B1 capsules are byte-identical: the reader says "declared nothing".
    expect(await readHandoffGateEvidence(written.path)).toEqual({ status: 'field-absent' });
  });

  it('keeps the field when `autoRegenPrdHandoff` creates the capsule', async () => {
    // Requirement 7: the second producer. Without the map, an auto-regenerated
    // capsule silently loses a declaration the init producer would have
    // written — one field, two results, depending on which producer happened
    // to run.
    const root = makeTempRoot();
    const requests = join(root, '.peaks', '_runtime', SESSION_ID, 'prd', 'requests');
    mkdirSync(requests, { recursive: true });
    writeFileSync(join(requests, `${REQUEST_ID}.md`), BODY, 'utf8');

    const regen = await autoRegenPrdHandoff({
      projectRoot: root,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      role: 'prd'
    });
    expect(regen.status).toBe('created');
    if (regen.status !== 'created') throw new Error('unreachable');

    // B2: the producer derives the map instead of taking it from the caller —
    // B1's optional input was never passed by this producer's one production
    // caller, which is the F1 hole. The request artifact seeded above carries
    // no `- type:`, so the type resolves to the default (`feature`).
    expect(expectOk(await readHandoffGateEvidence(regen.path)).evidence).toEqual(
      deriveGateEvidence({
        sessionId: SESSION_ID,
        requestId: REQUEST_ID,
        requestType: 'feature'
      })
    );
  });

  it('does not overwrite an existing capsule (and so cannot lose a declared map)', async () => {
    const root = makeTempRoot();
    const written = await writeHandoff(build(root, ALL_FIVE), root);
    const requests = join(root, '.peaks', '_runtime', SESSION_ID, 'prd', 'requests');
    mkdirSync(requests, { recursive: true });
    writeFileSync(join(requests, `${REQUEST_ID}.md`), BODY, 'utf8');

    const regen = await autoRegenPrdHandoff({
      projectRoot: root,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      role: 'prd'
    });
    expect(regen.status).toBe('skipped-exists');
    expect(expectOk(await readHandoffGateEvidence(written.path)).evidence).toEqual(ALL_FIVE);
  });
});

describe('(integration) the two readers agree about the same bytes', () => {
  /**
   * A capsule `readHandoff` will accept (all required fields), with
   * `gateEvidence` supplied by the caller so each case can vary only that.
   */
  function fullHandoffWith(block: string): string {
    return [
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
      block,
      '---',
      BODY
    ].join('\n');
  }

  it('stores exactly the map the reader reports as `evidence`', async () => {
    // F2 of `rid-b1-qa`: these were two shape predicates, so the same bytes
    // produced two different maps. One classifier now backs both.
    const filePath = writeTempHandoff(
      fullHandoffWith(
        ['gateEvidence:', '  projectScan: scan.md', '  perfBaseline: perf.md'].join('\n')
      )
    );
    const viaReader = expectOk(await readHandoffGateEvidence(filePath));
    const viaHandoff = await readHandoff(filePath);
    expect(viaHandoff.frontmatter.gateEvidence).toEqual(viaReader.evidence);
    expect(viaHandoff.frontmatter.gateEvidence).toEqual({
      projectScan: 'scan.md',
      perfBaseline: 'perf.md'
    });
  });

  it('drops an unknown key from `frontmatter.gateEvidence` and reports it as unknownKeys', async () => {
    // The interface says `GateEvidence` is the five keys. Storing the raw
    // YAML object made that a claim rather than a fact, and made the typed
    // field disagree with the reader for the same bytes.
    const filePath = writeTempHandoff(
      fullHandoffWith(['gateEvidence:', '  projectScans: typo.md'].join('\n'))
    );
    const viaReader = expectOk(await readHandoffGateEvidence(filePath));
    const viaHandoff = await readHandoff(filePath);
    expect(viaHandoff.frontmatter.gateEvidence).toEqual(viaReader.evidence);
    expect(viaHandoff.frontmatter.gateEvidence).toEqual({});
    expect(viaReader.unknownKeys).toEqual(['projectScans']);
  });

  it('REFUSES the same malformed declarations, in both directions', async () => {
    // `readHandoff` throws where the reader returns a status — that split is
    // the pre-existing policy difference. What must NOT happen is one of them
    // producing a map while the other refuses, which is what B1 shipped.
    for (const block of ['gateEvidence: [a.md]', 'gateEvidence:', 'gateEvidence: nope.md']) {
      const filePath = writeTempHandoff(fullHandoffWith(block));
      await expect(readHandoff(filePath)).rejects.toThrow(/frontmatter shape validation failed/);
      const viaReader = await readHandoffGateEvidence(filePath);
      expect(viaReader.status).toBe('field-not-map');
    }
  });
});

describe('(a11y) the outcome names what is wrong to a human', () => {
  it('separates "declared nothing" from "declared something broken"', async () => {
    // The one property the pre-B1 reader could not express: both used to be
    // `null`, so a caller could not tell whether to proceed or to stop.
    const nothing = await readHandoffGateEvidence(
      writeTempHandoff('---\nschemaVersion: 2\n---\n\n# Body\n')
    );
    const broken = await readHandoffGateEvidence(
      writeTempHandoff(handoffWithGateEvidenceBlock('gateEvidence: [a.md]'))
    );
    // Pinning each to its own literal IS the distinction; an extra
    // `not.toBe` between them (removed, F4 of `rid-b1-qa`) could not fail
    // once these two hold, so it asserted nothing.
    expect(nothing.status).toBe('field-absent');
    expect(broken.status).toBe('field-not-map');
  });

  it('does not report a file that exists but cannot be read as missing', async () => {
    // N1 (`handoff-service.verifyHandoff`) is the same lesson: folding every
    // read failure into `file-missing` sends an operator to look for a file
    // that is right there. Reading a directory is the portable way to make
    // `readFile` fail on a path that exists.
    const result = await readHandoffGateEvidence(makeTempRoot());
    expect(result.status).toBe('read-error');
    expect(result.status === 'read-error' ? result.reason : '').not.toBe('');
  });

  it('names the offending keys in the failure, not just the count', async () => {
    const result = await readHandoffGateEvidence(
      writeTempHandoff(
        handoffWithGateEvidenceBlock(['gateEvidence:', '  securityReview: 7'].join('\n'))
      )
    );
    expect(result).toEqual({ status: 'value-not-string', keys: ['securityReview'] });
  });
});
