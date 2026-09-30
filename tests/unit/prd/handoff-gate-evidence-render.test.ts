// tests/unit/prd/handoff-gate-evidence-render.test.ts
//
// Slice B1 (`rid-b1-gate-evidence-producer`) — the `render` dimension of the
// sibling `handoff-gate-evidence.test.ts`. Split out to bring that file under
// its 500-line raw cap; the cases, their assertions and their order are
// unchanged, and the module fixtures (SESSION_ID / REQUEST_ID / BODY / ALL_FIVE)
// are hoisted verbatim into `_handoff-gate-evidence-fixtures.ts`.
//
// This file exercises ONLY the render dimension: `serializeHandoffFrontmatter`
// emitting (or omitting) the `gateEvidence` block, the byte-level ordering
// against the anchored scalars, the YAML round trip and the serializer's
// runtime refusal of bad input. `behavior` / `integration` / `a11y` are omitted
// here and covered by the reader file.

import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { declareDimensions } from '../_setup/4dim-template.js';
import { initHandoff } from '../../../src/services/prd/handoff-service.js';
import { serializeHandoffFrontmatter } from '../../../src/services/prd/handoff-frontmatter.js';
import {
  GATE_EVIDENCE_KEYS,
  type GateEvidence,
  type HandoffFrontmatter
} from '../../../src/services/prd/handoff-types.js';
import { SESSION_ID, REQUEST_ID, BODY, ALL_FIVE } from './_handoff-gate-evidence-fixtures.js';

declareDimensions(
  'tests/unit/prd/handoff-gate-evidence-render.test.ts',
  ['render'],
  [
    {
      dim: 'behavior',
      reason: 'the reader classifier is covered by handoff-gate-evidence.test.ts'
    },
    {
      dim: 'integration',
      reason:
        'the real producers against a temp .peaks tree are covered by handoff-gate-evidence.test.ts'
    },
    { dim: 'a11y', reason: 'the failure vocabulary is covered by handoff-gate-evidence.test.ts' }
  ]
);

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
