// tests/unit/prd/handoff-frontmatter-doc-contract.test.ts
//
// The handoff frontmatter had no automated validator: `writing-handoff-
// frontmatter.md` said so out loud ("No unit test pins the field set", "No
// command validates the frontmatter today"), and the field set drifted as a
// result. Measured against this file, the two documents disagreed with the code
// they describe — the writer doc's example carried `schemaVersion: '2.0'` while
// the serializer emits the PLAIN `schemaVersion: 2` that `AUDIT_REQUIRES_HANDOFF`
// substring-matches, and `peaks-qa`'s reader doc named `'1.0'`, a value the
// reader rejects. So a capsule written by following the instructions to the
// letter was unreadable by the code that consumes it, and the only way to find
// that out was to read the serializer.
//
// These cases pin what the documents CLAIM against what the code DOES. They do
// not validate a handoff (the bytes on disk are `peaks prd handoff verify`'s
// job); they keep the prose from becoming a false instruction again.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { GATE_EVIDENCE_KEYS } from '~/src/services/prd/handoff-types';
import { deriveGateEvidence } from '~/src/services/prd/gate-evidence-derivation';
import {
  HANDOFF_SCHEMA_VERSION,
  serializeHandoff
} from '~/src/services/prd/handoff-frontmatter-shape';
import { initHandoff } from '~/src/services/prd/handoff-service';
import { VALID_REQUEST_TYPES } from '~/src/services/artifacts/artifact-prerequisites';

const writerDoc = readFileSync(
  join(process.cwd(), 'skills/bee/peaks-rd/references/writing-handoff-frontmatter.md'),
  'utf8'
);
const readerDoc = readFileSync(
  join(process.cwd(), 'skills/bee/peaks-qa/references/reading-handoff-frontmatter.md'),
  'utf8'
);

function sampleHandoff() {
  return initHandoff({
    requestId: 'rid-doc-contract',
    sessionId: 'sid-doc-contract',
    body: 'body',
    writtenAt: '2026-10-04T00:00:00.000Z',
    goals: [],
    acceptanceCriteria: [],
    preservedBehavior: [],
    gateEvidence: { projectScan: '.peaks/project-scan/project-scan.md' }
  });
}

type DocExample = {
  gateEvidence?: Record<string, unknown>;
  schemaVersion?: string | number;
} & Record<string, unknown>;

/** The doc's fenced YAML frontmatter example, parsed. */
function exampleFrontmatter(): DocExample {
  const fence = /```yaml\r?\n([\s\S]*?)```/.exec(writerDoc);
  if (fence === null || fence[1] === undefined) {
    throw new Error('the writer doc must carry a fenced YAML frontmatter example');
  }
  // The example is a WHOLE capsule, so it opens and closes with the `---`
  // fence; strip both or this parses as two YAML documents instead of one.
  const inner = /^\s*---\r?\n([\s\S]*?)\r?\n---\s*/.exec(fence[1]);
  if (inner === null || inner[1] === undefined) {
    throw new Error('the frontmatter example must be fenced by --- on both sides');
  }
  return parseYaml(inner[1]) as DocExample;
}

describe('Scenario: the writer doc example is what the serializer writes', () => {
  it('when the example is parsed, its gateEvidence keys should be exactly GATE_EVIDENCE_KEYS', () => {
    // given: the block an LLM copies from
    const declared = Object.keys(exampleFrontmatter().gateEvidence ?? {});
    // then: the same five names, in the canonical serialization order
    expect(declared).toEqual([...GATE_EVIDENCE_KEYS]);
  });

  it('when the example sets schemaVersion, it should equal the value the serializer emits', () => {
    // given
    const example = exampleFrontmatter();
    const emittedLine = /^schemaVersion:\s*(.*)$/m.exec(serializeHandoff(sampleHandoff()));
    if (emittedLine === null) {
      throw new Error('the serializer emitted no schemaVersion line at all');
    }
    // then: the doc names `2` plain. `'2.0'` and `'1.0'` are both values the
    // reader REFUSES, and the example used to carry the first of them.
    expect(String(example.schemaVersion)).toBe(String(HANDOFF_SCHEMA_VERSION));
    expect((emittedLine[1] ?? '').trim()).toBe(String(HANDOFF_SCHEMA_VERSION));
    expect(writerDoc).not.toContain("schemaVersion: '2.0'");
    expect(writerDoc).not.toContain("schemaVersion: '1.0'");
  });

  it('when peaks-qa names schemaVersion, it should agree with the writer doc', () => {
    expect(readerDoc).toContain('`schemaVersion: 2`');
    expect(readerDoc).not.toContain("schemaVersion: '1.0'");
    expect(readerDoc).not.toContain("schemaVersion: '2.0'");
  });
});

describe('Scenario: the per-type gateEvidence claims match the derivation', () => {
  /**
   * The doc lists each request type's declared keys in one bullet —
   * `` - `feature` / `refactor` / `bugfix` → **5 keys**: `projectScan`, … ``,
   * or says the block is absent. Read the claim off the page; do not restate it
   * here, or this file becomes a second copy of the thing it audits.
   */
  function claimedKeysForType(requestType: string): string[] | null {
    for (const rawLine of writerDoc.split('\n')) {
      const bullet = rawLine.trim();
      if (!bullet.startsWith('-') || !bullet.includes('→')) continue;
      const head = bullet.slice(0, bullet.indexOf('→')).replace(/^-\s*/, '');
      const types = head.split('/').map((part) => part.trim().replace(/`/g, ''));
      if (!types.includes(requestType)) continue;
      if (/no `gateEvidence` block at all/.test(bullet)) return [];
      const list = /keys\*\*:\s*((?:`[A-Za-z]+`(?:, )?)+)/.exec(bullet);
      if (list === null) return null;
      return [...(list[1] as string).matchAll(/`([A-Za-z]+)`/g)].map((m) => m[1] as string);
    }
    return null;
  }

  for (const requestType of VALID_REQUEST_TYPES) {
    it(`when the type is ${requestType}, the doc's key list should equal deriveGateEvidence's`, () => {
      const claimed = claimedKeysForType(requestType);
      if (claimed === null) {
        throw new Error(`the writer doc does not state what ${requestType} declares`);
      }
      const derived = Object.keys(
        deriveGateEvidence({ sessionId: 'sid-x', requestId: 'rid-x', requestType })
      );
      // The CLAIM is membership. Order is settled one layer down — the
      // serializer renders `GATE_EVIDENCE_KEYS` order, not the map's insertion
      // order — and the derivation builds from the prerequisite table, so the
      // two legitimately differ here.
      expect([...claimed].sort()).toEqual(derived.sort());
    });
  }

  it('when a type declares nothing, the doc should say so rather than list empty keys', () => {
    expect(
      Object.keys(deriveGateEvidence({ sessionId: 's', requestId: 'r', requestType: 'docs' }))
    ).toEqual([]);
    expect(writerDoc).toMatch(/`docs` \/ `chore` → \*\*no `gateEvidence` block at all\*\*/);
  });
});

describe('Scenario: the documented field set against the emitted one', () => {
  /**
   * What this block is for. peaks-qa's mechanical cross-checks 1, 2, 3 and 5 read
   * `decisions[]`, `risks[]`, `files[]` and `nextActions[]` from the frontmatter;
   * the serializer used to emit none of them (the type had no such field), while
   * `isHandoffFrontmatter` REQUIRED five the docs never listed (`sessionId`,
   * `writtenAt`, `goals`, `acceptanceCriteria`, `preservedBehavior`) and the
   * example omitted. So a capsule hand-written from the doc was refused outright,
   * and four of five QA checks read fields no writer could produce. Both halves
   * close here: the fields are on the type, and the doc shows what the reader
   * demands. These cases fail again if either side drifts, which is the point.
   */
  const QA_CHECKED_FIELDS = ['scope', 'files', 'decisions', 'risks', 'nextActions'];
  const READER_REQUIRED_FIELDS = [
    'requestId',
    'sessionId',
    'schemaVersion',
    'handoffHash',
    'writtenAt',
    'goals',
    'acceptanceCriteria',
    'preservedBehavior',
    'handoffPath'
  ];

  function fullyAuthored() {
    const base = sampleHandoff();
    return {
      ...base,
      frontmatter: {
        ...base.frontmatter,
        scope: ['src/services/prd/handoff-service.ts'],
        files: ['src/services/prd/handoff-types.ts'],
        decisions: [{ id: 'D1', summary: 'one line', rationale: 'because' }],
        risks: [{ id: 'R1', description: 'auth boundary', mitigation: 'a test' }],
        nextActions: ['peaks-qa runs the regression matrix']
      }
    };
  }

  it('when a capsule authors the five fields peaks-qa reads, the serializer should emit them', () => {
    const serialized = serializeHandoff(fullyAuthored());
    for (const field of QA_CHECKED_FIELDS) {
      expect(serialized, `${field} was authored and then dropped`).toMatch(
        new RegExp(`^${field}:`, 'm')
      );
    }
    // The records keep their named fields rather than flattening to strings —
    // which is what makes `risks[].mitigation` checkable at all.
    expect(serialized).toContain('mitigation: "a test"');
  });

  it('when a risk has no mitigation, the write should refuse rather than drop the field', () => {
    const base = sampleHandoff();
    const malformed = {
      ...base,
      frontmatter: { ...base.frontmatter, risks: [{ id: 'R1', description: 'auth' }] }
    };
    expect(() => serializeHandoff(malformed as never)).toThrow(/missing mitigation/);
  });

  it('when the writer doc shows its example, it should cover every field the reader requires', () => {
    for (const field of [...QA_CHECKED_FIELDS, ...READER_REQUIRED_FIELDS]) {
      expect(
        new RegExp(`^${field}:`, 'm').test(writerDoc),
        `the doc must show \`${field}\` in its example — readHandoff requires it`
      ).toBe(true);
    }
  });

  it('when peaks-qa names its fields, none should be one the serializer cannot write', () => {
    const line = readerDoc.split('\n').find((text) => text.startsWith('`requestId`')) ?? '';
    const named = [...line.matchAll(/`([A-Za-z]+)(?:\[\])?`/g)].map((m) => m[1] as string);
    const emitted = [...serializeHandoff(fullyAuthored()).matchAll(/^([A-Za-z]+):/gm)].map(
      (m) => m[1] as string
    );
    expect(named.filter((field) => !emitted.includes(field))).toEqual([]);
  });
});
