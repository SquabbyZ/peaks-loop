// tests/unit/services/workflow/pipeline-verify-qa-phase.test.ts
//
// rid-mut-baseline-80 — the mutation-target test for
// `src/services/workflow/pipeline-verify-qa-phase.ts`.
//
// WHY THIS FILE EXISTS. The module measured 0% killed before this file. Its
// existing coverage came from `type-tables-are-authoritative.test.ts` and
// `skip-allowlist-is-qa-free.test.ts`, and neither can be a mutation target:
// both drive `withTmpWorkspacePerTest`, which calls `process.chdir()`, and
// Stryker's vitest-runner pins `pool: 'threads'` (`vitest-test-runner.js`), where
// chdir throws. So the module was fully covered by tests the mutator could not
// run. This file exercises the same exports WITHOUT a workspace: every one of
// them is a pure function or a constant derived at module load.
//
// WHAT IT CANNOT REACH, AND SAYS SO. The load-time reconciliation at the bottom
// of the module (`qaGateReconciliationFailures` → the `throw`) runs once, on
// import, against the real type tables. A test cannot observe it failing without
// replacing those tables, which the module does not allow — `prerequisitesOfType`
// is a parameter of the private function, not of an export. Those mutants are
// therefore unreachable from any test, which is a property of the design, not a
// gap in this file.
//
// WHY THE ASSERTIONS NAME `QA_FREE_TYPES` INSTEAD OF `['docs', 'config', 'chore']`.
// The old allowlist was a hand-written literal and it was WRONG — `config` carries
// a QA phase. Asserting the derived set is what pins the derivation; asserting the
// literal would re-introduce the defect the module was written to remove.

import { describe, expect, it } from 'vitest';
import {
  QA_EVIDENCE_GATES,
  QA_FREE_TYPES,
  QA_STATES,
  markQaRequestGate,
  qaPhaseGates,
  typeRequiresQaPhase
} from '../../../../src/services/workflow/pipeline-verify-qa-phase.js';
import { VALID_REQUEST_TYPES } from '../../../../src/services/artifacts/artifact-prerequisites.js';
import { allowedStatesForRole } from '../../../../src/services/artifacts/request-artifact-state-helpers.js';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions('tests/unit/services/workflow/pipeline-verify-qa-phase.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

describe('Scenario: (render) — the QA state axis is the repository model, not a restatement', () => {
  it('when read, should equal what the state model allows for the qa role', () => {
    // given: the repository's own state model
    // when:  the module's exported state list is read
    // then:  it is that list, not a hand-maintained copy
    expect(QA_STATES).toEqual(allowedStatesForRole('qa'));
    expect(QA_STATES.length).toBeGreaterThan(0);
  });

  it('when read, should carry the two evidence gates with their contract paths', () => {
    // given: no argument — this is a module-level constant
    // when:  the gate table is read
    // then:  the WHOLE structure is pinned, entry by entry. The mutation report
    //        left 11 survivors on lines 67-72 of the module — the empty-object
    //        and empty-string substitutions on this literal. Comparing the
    //        mapped columns above cannot see them: `{ name: '', description: '' }`
    //        still maps to a two-element name/path array. `toEqual` on the
    //        literal is what pins each field.
    expect(QA_EVIDENCE_GATES).toEqual([
      { name: 'test-cases', description: 'QA test cases', relativePath: 'qa/test-cases/<rid>.md' },
      {
        name: 'test-report',
        description: 'QA test report with execution results',
        relativePath: 'qa/test-reports/<rid>.md'
      }
    ]);
    for (const gate of QA_EVIDENCE_GATES) {
      expect(gate.description.length).toBeGreaterThan(0);
    }
  });
});

describe('Scenario: (behavior) — the phase exists exactly when the table carries a QA row', () => {
  it('when the type is in the table with a QA row, should require the phase', () => {
    // given: a type whose table carries QA prerequisites
    // when:  the derivation runs
    // then:  the phase is required
    expect(typeRequiresQaPhase('feature')).toBe(true);
  });

  it('when the type is a valid request type with no QA row, should not require the phase', () => {
    // given: every derived QA-free type
    // when:  the derivation runs
    // then:  none requires a phase — and the set is exactly what the derivation says
    for (const requestType of QA_FREE_TYPES) {
      expect(typeRequiresQaPhase(requestType)).toBe(false);
    }
  });

  it('when the type is not a request type, should refuse by name rather than answer false', () => {
    // given: a value that is not a member of the type union
    // when:  the derivation runs
    // then:  it THROWS, naming the alternatives — a bare false would read as "no phase"
    expect(() => typeRequiresQaPhase('not-a-type' as never)).toThrow(
      /is not a request type — expected one of/
    );
    expect(() => typeRequiresQaPhase('not-a-type' as never)).toThrow(/feature/);
  });

  it('when the allowlist is read, should be derived from the types and never name config', () => {
    // given: the historical defect — a hand-written allowlist naming `config`,
    //        which carries a QA phase and so could bypass a required phase
    // when:  the derived allowlist is read
    // then:  `config` is absent, every member is a valid type, and the split
    //        partitions the type list exactly
    expect(QA_FREE_TYPES).not.toContain('config');
    for (const requestType of QA_FREE_TYPES) {
      expect(VALID_REQUEST_TYPES).toContain(requestType);
    }
    expect(
      [...QA_FREE_TYPES, ...VALID_REQUEST_TYPES.filter((t) => !QA_FREE_TYPES.includes(t))].sort()
    ).toEqual([...VALID_REQUEST_TYPES].sort());
  });

  it('when the allowlist is frozen, should be exactly docs and chore, and not a mutable array', () => {
    // given: the derivation ran at module load
    // when:  the derived value is inspected
    // then:  the EXACT membership is pinned — a mutation that swaps the filter
    //        predicate, drops the filter, or returns the input unchanged all
    //        produce a different set, so comparing the whole array kills them.
    //        Without this arm the shape assertions above pass for several wrong
    //        derivations.
    expect([...QA_FREE_TYPES]).toEqual(['docs', 'chore']);
    // Frozen, so a caller cannot widen the skip surface by pushing onto it.
    expect(Object.isFrozen(QA_FREE_TYPES)).toBe(true);
  });

  it('when the state axis is read, should be exactly the four QA states in order', () => {
    // given: the repository's state model for the qa role
    // when:  the exported list is inspected
    // then:  the EXACT sequence is pinned — `toEqual` on the whole array kills
    //        a mutation that reorders or drops a state, which the length check
    //        above cannot see
    expect([...QA_STATES]).toEqual(['draft', 'running', 'verdict-issued', 'blocked']);
  });
});

describe('Scenario: (integration) — the gate list has the shape the checker consumes', () => {
  it('when the phase is not required, should build no gate at all', () => {
    // given: a type whose table carries no QA row
    // when:  the gate list is built
    // then:  it is EMPTY — the checker reads an empty list as "no phase"
    expect(qaPhaseGates(false, [{ name: 'test-cases', description: 'x' }])).toEqual([]);
  });

  it('when the phase is required, should lead with the request gate then one per evidence item', () => {
    // given: a required phase with two evidence items
    // when:  the gate list is built
    // then:  the whole list is pinned field by field. The map-based assertion
    //        this replaced compared only `name`, so the `passed: false` and
    //        `detail: ''` fields of the REQUEST gate were never compared when
    //        evidence was non-empty — the loop below pins them, but the
    //        `toEqual` is what makes a `false`->`true` swap on line 157 visible.
    const gates = qaPhaseGates(true, [
      { name: 'test-cases', description: 'QA test cases' },
      { name: 'test-report', description: 'QA test report' }
    ]);
    expect(gates).toEqual([
      {
        name: 'qa-request-exists',
        description: 'QA request artifact created',
        passed: false,
        detail: ''
      },
      { name: 'test-cases', description: 'QA test cases', passed: false, detail: '' },
      { name: 'test-report', description: 'QA test report', passed: false, detail: '' }
    ]);
  });

  it('when evidence is empty, should still build the request gate alone', () => {
    // given: a required phase whose evidence list is empty
    // when:  the gate list is built
    // then:  exactly one gate, the request gate
    const gates = qaPhaseGates(true, []);
    expect(gates).toHaveLength(1);
    expect(gates[0]?.name).toBe('qa-request-exists');
  });

  it('when the request gate is marked, should fill it and leave the evidence gates alone', () => {
    // given: a built gate list
    // when:  the request gate is marked as found
    // then:  only the first gate changes, and its detail names the path
    const gates = qaPhaseGates(true, [{ name: 'test-cases', description: 'QA test cases' }]);
    markQaRequestGate(gates, '.peaks/_runtime/sid/qa/requests/001-x.md');
    expect(gates[0]?.passed).toBe(true);
    expect(gates[0]?.detail).toBe('found at .peaks/_runtime/sid/qa/requests/001-x.md');
    expect(gates[1]?.passed).toBe(false);
  });

  it('when the gate list is empty, should be a no-op rather than throw', () => {
    // given: the empty list a type with no QA phase produces
    // when:  the request gate is marked anyway
    // then:  nothing happens — the caller does not have to branch on phase existence
    const gates: Parameters<typeof markQaRequestGate>[0] = [];
    expect(() => markQaRequestGate(gates, 'anywhere')).not.toThrow();
    expect(gates).toEqual([]);
  });
});

describe('Scenario: (a11y) — a refusal names the value it got and the alternatives', () => {
  it('when the type is refused, should quote the offending value verbatim', () => {
    // given: a caller passing a plausible-looking but wrong value
    // when:  the derivation refuses
    // then:  the message contains the value AND the word "expected"
    let message = '';
    try {
      typeRequiresQaPhase('Feature' as never);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain('"Feature"');
    expect(message).toContain('expected one of');
    // The WHOLE message is pinned. The mutation report showed the message
    // substitution surviving on the throw line because only substrings were
    // compared before this arm; comparing the full text kills it.
    expect(message).toBe(
      `pipeline-verify: "Feature" is not a request type — expected one of ${VALID_REQUEST_TYPES.join(', ')}`
    );
  });
});

describe('Scenario: (behavior) — the derivation returns the table rows, not an empty list', () => {
  it('when every type is checked, should find at least one type WITH a QA phase and one without', () => {
    // given: every valid request type
    // when:  the derivation runs over each
    // then:  BOTH outcomes occur. The mutation report showed the flatMap body
    //        surviving as `[]` — a derivation that returned nothing would make
    //        `typeRequiresQaPhase` answer false for every type, and the
    //        QA_FREE_TYPES assertions alone cannot see that because they only
    //        check the FREE side.
    const withPhase = VALID_REQUEST_TYPES.filter((t) => typeRequiresQaPhase(t));
    const withoutPhase = VALID_REQUEST_TYPES.filter((t) => !typeRequiresQaPhase(t));
    expect(withPhase.length).toBeGreaterThan(0);
    expect(withoutPhase.length).toBeGreaterThan(0);
    // `feature` is the canonical type the contract requires a QA phase for.
    expect(withPhase).toContain('feature');
    // and the two sides partition the type list with no type falling through
    expect(withPhase.length + withoutPhase.length).toBe(VALID_REQUEST_TYPES.length);
  });
});
