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

import { readFileSync } from 'node:fs';
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
import { contractEvidencePaths } from '../../../../src/services/workflow/pipeline-verify-gate-support.js';

declareDimensions('tests/unit/services/workflow/pipeline-verify-rd-gates.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

/** The pre-refactor gate list per type, measured on HEAD `f02c6be6`. */
const PRE_REFACTOR_GATES: ReadonlyArray<readonly [RequestType, readonly string[]]> = [
  [
    'feature',
    ['rd-request-exists', 'prd-handoff', 'code-review', 'security-review', 'perf-baseline']
  ],
  [
    'bugfix',
    [
      'rd-request-exists',
      'prd-handoff',
      'bug-analysis',
      'code-review',
      'security-review',
      'perf-baseline'
    ]
  ],
  [
    'refactor',
    ['rd-request-exists', 'prd-handoff', 'code-review', 'security-review', 'perf-baseline']
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
      'perf-baseline'
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
      'perf-baseline'
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
