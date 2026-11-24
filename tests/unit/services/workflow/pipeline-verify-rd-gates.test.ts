// tests/unit/services/workflow/pipeline-verify-rd-gates.test.ts
//
// rid `2026-10-18-rd-gates-derivation`. The arms for the RD gate list being
// DERIVED from the artifact-prerequisite contract instead of three hand-written
// type lists.
//
// THE DEFECT THIS FILE PINS: `rdGatesForType` answered "which evidence does RD
// owe" with `requestType === 'bugfix'`, `requestType !== 'docs' && !== 'chore'
// && !== 'config'`, and a four-name union — none of which read the table that
// `peaks request transition` enforces. The six-type table below is the
// pre-refactor gate list measured with a tsx probe against HEAD `f02c6be6`, so a
// silent drift in either direction reds.
//
// Dimensions: all four are covered. `a11y` pins the one new text surface — the
// accessor's refusal for a gate name the table never declared — so the refusal
// is an observed guard rather than a claim.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';
import {
  VALID_REQUEST_TYPES,
  type RequestType
} from '../../../../src/services/artifacts/artifact-prerequisites.js';
import {
  RD_EVIDENCE_GATES,
  deriveRdGates,
  rdEvidenceProbe,
  rdGatesForType
} from '../../../../src/services/workflow/pipeline-verify-rd-phase.js';
import {
  contractEvidencePaths,
  resolveRdEvidencePaths
} from '../../../../src/services/workflow/pipeline-verify-gate-support.js';

declareDimensions('tests/unit/services/workflow/pipeline-verify-rd-gates.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

/** The pre-refactor gate list per type, measured on HEAD `f02c6be6`, plus the
 *  `design-conformance` row S3 appended to the three tables that carry it. */
const PRE_REFACTOR_GATES: ReadonlyArray<readonly [RequestType, readonly string[]]> = [
  [
    'feature',
    [
      'rd-request-exists',
      'prd-handoff',
      'code-review',
      'security-review',
      'perf-baseline',
      'design-conformance'
    ]
  ],
  [
    'bugfix',
    [
      'rd-request-exists',
      'prd-handoff',
      'bug-analysis',
      'code-review',
      'security-review',
      'perf-baseline',
      'design-conformance'
    ]
  ],
  [
    'refactor',
    [
      'rd-request-exists',
      'prd-handoff',
      'code-review',
      'security-review',
      'perf-baseline',
      'design-conformance'
    ]
  ],
  ['docs', ['rd-request-exists']],
  ['config', ['rd-request-exists', 'security-review']],
  ['chore', ['rd-request-exists']]
];

/** The production source, read so a reintroduced literal type check is visible. */
const RD_PHASE_SOURCE = readFileSync(
  new URL('../../../../src/services/workflow/pipeline-verify-rd-phase.ts', import.meta.url),
  'utf8'
);

describe('Scenario: render — the gate list each type now evaluates', () => {
  it.each(PRE_REFACTOR_GATES)(
    'when RD hands off a %s slice, should name the pre-refactor gates in order',
    (requestType, expected) => {
      expect(rdGatesForType(requestType).map((gate) => gate.name)).toEqual(expected);
    }
  );

  it('when a type owes every evidence gate, should carry the pre-refactor descriptions unfilled', () => {
    expect(rdGatesForType('bugfix')).toEqual([
      {
        name: 'rd-request-exists',
        description: 'RD request artifact created',
        passed: false,
        detail: ''
      },
      {
        name: 'prd-handoff',
        description: 'PRD handoff capsule (approved scope + non-goals)',
        passed: false,
        detail: ''
      },
      { name: 'bug-analysis', description: 'Bug root-cause analysis', passed: false, detail: '' },
      { name: 'code-review', description: 'Code review evidence', passed: false, detail: '' },
      {
        name: 'security-review',
        description: 'Security review evidence',
        passed: false,
        detail: ''
      },
      {
        name: 'perf-baseline',
        description: 'Performance audit evidence',
        passed: false,
        detail: ''
      },
      {
        name: 'design-conformance',
        description: 'Design conformance evidence (peaks design check --gate)',
        passed: false,
        detail: ''
      }
    ]);
  });
});

describe('Scenario: behavior — the lookup, not a restated list, decides', () => {
  it('when the lookup reports no contract row for one gate, should drop exactly that gate', () => {
    const dropped = 'rd/code-review.md';
    const gates = deriveRdGates('bugfix', (_requestType, relativePath) =>
      relativePath === dropped ? null : ['contract row']
    );

    expect(gates.map((gate) => gate.name)).toEqual([
      'rd-request-exists',
      'prd-handoff',
      'bug-analysis',
      'security-review',
      'perf-baseline',
      'design-conformance'
    ]);
  });

  it('when the lookup carries every gate, should build all five even for a type the table gives none', () => {
    // `docs` owes no evidence in production, so a restated list could not
    // produce this answer; only a lookup-driven derivation can.
    expect(deriveRdGates('docs', () => ['contract row']).map((gate) => gate.name)).toEqual([
      'rd-request-exists',
      ...RD_EVIDENCE_GATES.map((gate) => gate.name)
    ]);
  });

  it('when the production binding is driven with a carried contract, should build every gate', () => {
    // Bound at `rdGatesForType`, not `deriveRdGates`: a restatement inside the
    // production binding would answer `docs` with the request gate alone.
    expect(rdGatesForType('docs', () => ['contract row']).map((gate) => gate.name)).toEqual([
      'rd-request-exists',
      ...RD_EVIDENCE_GATES.map((gate) => gate.name)
    ]);
  });

  it('when the production binding is driven with a null row, should drop exactly that gate', () => {
    const dropped = 'rd/code-review.md';
    const gates = rdGatesForType('docs', (_requestType, relativePath) =>
      relativePath === dropped ? null : ['contract row']
    );

    expect(gates.map((gate) => gate.name)).toEqual([
      'rd-request-exists',
      'prd-handoff',
      'bug-analysis',
      'security-review',
      'perf-baseline',
      'design-conformance'
    ]);
  });

  it('when the production source is read, should not name a request type', () => {
    expect(RD_PHASE_SOURCE).not.toMatch(/requestType\s*[!=]==\s*'/);
  });
});

describe('Scenario: integration — the derivation follows the real contract table', () => {
  it('when each type is asked, should include exactly the gates the real contract carries', () => {
    for (const requestType of VALID_REQUEST_TYPES) {
      const carried = RD_EVIDENCE_GATES.filter(
        (gate) => contractEvidencePaths('rd', 'qa-handoff', requestType, gate.relativePath) !== null
      ).map((gate) => gate.name);

      expect(
        rdGatesForType(requestType)
          .slice(1)
          .map((gate) => gate.name)
      ).toEqual(carried);
    }
  });

  it('when asked for each declared gate, should name a contract path the real table resolves', () => {
    for (const gate of RD_EVIDENCE_GATES) {
      const probe = rdEvidenceProbe(gate.name);

      expect(probe).toBe(gate.relativePath);
      expect(
        VALID_REQUEST_TYPES.some(
          (requestType) => contractEvidencePaths('rd', 'qa-handoff', requestType, probe) !== null
        )
      ).toBe(true);
    }
  });

  it('when the production binding is asked for a feature slice, should build the design-conformance gate', () => {
    // given: a feature slice and the PRODUCTION binding — no injected lookup,
    //        because a synthetic one carries every row by construction
    // when:  the gate list is built
    // then:  the design-conformance row is present
    expect(rdGatesForType('feature').map((gate) => gate.name)).toContain('design-conformance');
  });

  it('when the production binding is asked for a docs slice, should not build the design-conformance gate', () => {
    // given: a docs slice, whose table carries no design row
    // when:  the gate list is built
    // then:  the gate is absent — the table lookup is the only condition
    expect(rdGatesForType('docs').map((gate) => gate.name)).not.toContain('design-conformance');
  });

  it('when a feature slice is missing in-window design evidence, should soft-pass and name the window', () => {
    // given: the production gate list and a project root holding no evidence at all
    // when:  the resolver walks the gates it was handed
    // then:  the design gate soft-passes under the back-compat window, and the
    //        next action still says the artifact is owed before it closes
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-design-gate-'));
    try {
      const gates = rdGatesForType('feature');
      const violations: string[] = [];
      const nextActions: string[] = [];
      resolveRdEvidencePaths(
        gates,
        'session-design-gate',
        projectRoot,
        'rid-design-gate',
        'feature',
        violations,
        nextActions,
        { anyEvidenceResolved: false, allResolvedPathsCanonical: true }
      );
      const gate = gates.find((entry) => entry.name === 'design-conformance');
      expect(gate?.passed).toBe(true);
      expect(gate?.detail).toBe('missing (back-compat until v4.4.0)');
      expect(violations).not.toContain(
        'RD evidence missing: Design conformance evidence (peaks design check --gate) (design/check-rid-design-gate.md)'
      );
      expect(nextActions.some((action) => action.includes('v4.4.0'))).toBe(true);
      expect(nextActions.some((action) => action.includes('design/check-rid-design-gate.md'))).toBe(
        true
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('when a non-back-compat evidence file is missing, should still violate', () => {
    // given: the same empty project root
    // when:  the resolver walks the gates
    // then:  code-review has no window and stays a hard violation
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-design-gate-'));
    try {
      const gates = rdGatesForType('feature');
      const violations: string[] = [];
      resolveRdEvidencePaths(
        gates,
        'session-design-gate',
        projectRoot,
        'rid-design-gate',
        'feature',
        violations,
        [],
        { anyEvidenceResolved: false, allResolvedPathsCanonical: true }
      );
      expect(gates.find((entry) => entry.name === 'code-review')?.passed).toBe(false);
      expect(
        violations.some((entry) => entry.startsWith('RD evidence missing: Code review evidence'))
      ).toBe(true);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('when design evidence exists but violates its body contract, should still fail', () => {
    // given: a canonical design evidence file carrying none of the pinned markers
    // when:  the resolver walks the gates and reads that file's body
    // then:  the window softens a MISSING file only — a bad body is still a violation
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-design-gate-'));
    try {
      const sessionDir = join(projectRoot, '.peaks', '_runtime', 'session-design-gate');
      mkdirSync(join(sessionDir, 'design'), { recursive: true });
      writeFileSync(join(sessionDir, 'design', 'check-rid-design-gate.md'), 'schemaVersion: 1\n');
      const gates = rdGatesForType('feature');
      const violations: string[] = [];
      resolveRdEvidencePaths(
        gates,
        'session-design-gate',
        projectRoot,
        'rid-design-gate',
        'feature',
        violations,
        [],
        { anyEvidenceResolved: false, allResolvedPathsCanonical: true }
      );
      const gate = gates.find((entry) => entry.name === 'design-conformance');
      expect(gate?.passed).toBe(false);
      expect(gate?.detail).toContain('missing section(s)');
      expect(violations.some((entry) => entry.includes('does not satisfy the contract'))).toBe(
        true
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

describe('Scenario: a11y — the accessor refuses an invented gate by name', () => {
  it('when the gate is not declared, should name it and list the declared gates', () => {
    let message = '';
    try {
      rdEvidenceProbe('not-a-gate');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('"not-a-gate" is not an RD evidence gate');
    for (const gate of RD_EVIDENCE_GATES) expect(message).toContain(gate.name);
  });
});
