// tests/unit/standards/no-proof-suite-skip.test.ts
//
// rid-038 W2/D3 — a proof carrier may not be switched OFF.
//
// THE DEFECT THIS LOCKS (rid-035 slice ①, measured 2026-10-09). The three-layer read-only
// proof was wrapped in `describe.skipIf(!existsSync(dist/cli/index.js))`. With the build
// artifact absent — the common state on a fresh checkout — nine arms skipped and the file
// exited 0. The proof did not fail and did not run: it VANISHED, and it reported success
// while vanishing. The skip was removed in slice ①. Nothing then prevented it returning,
// because a suite-level gate on a proof is a legal spelling and vitest reports a skipped
// arm as neither a pass nor a failure.
//
// WHAT THIS FILE ADDS IS A MECHANISM, NOT A NOTE. Three facts are pinned, and all three
// are needed — the third is why the guard cannot pass by being unable to fail:
//
//   1. every gate carried by a proof carrier is DECLARED here, with the reason it is
//      allowed to be conditional. `readonly-proof.test.ts` gates its CI-only sandbox layer
//      on purpose (`!SANDBOX_REQUESTED`, a sandbox that was never requested is an honest
//      stated skip), so "no gates at all" would be a false red; "no UNDECLARED gate" is
//      the true rule, and the declaration is the deliberate act.
//   2. the suites that carry the proof unconditionally are still registered that way at the
//      top level — so the allow-list above cannot be edited to gate the carriage itself.
//   3. INJECTION. Both arms build a tree under OS tmp holding a copy of the real proof with
//      one gate put back, and the SAME `checkProofCarriers` the first arm runs must go red
//      on it. A guard nobody can watch failing is decoration.
//
// SCOPE IS A NAMED FILE SET, NOT A REPO-WIDE HEURISTIC. `_proof-suite-skip-scan.ts` states
// why: gating a suite is normal and correct elsewhere in this repository, so a repo-wide
// rule would be a false-red machine. The set is the DIRECTORY `tests/integration/readonly-surface`
// walked for `.test.ts` carriers, so a proof carrier added beside this one joins by existing.
//
// NOTHING IS WRITTEN INTO THE REPOSITORY (backlog §2.31). Every injected tree lives under
// `mkdtempSync(join(tmpdir(), …))`, via the temp-tree harness `gate-module-set.test.ts`
// already reuses; the real carrier is only ever READ.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { REPO_ROOT, withFixtureTree } from './_file-size-cap-scan.js';
import {
  checkProofCarriers,
  describeProofFindings,
  proofCarrierFiles,
  suiteSkipGates,
  topLevelUnconditionalSuites,
  type ProofSkipFinding
} from './_proof-suite-skip-scan.js';

declareDimensions(
  'tests/unit/standards/no-proof-suite-skip.test.ts',
  ['integration', 'behavior', 'a11y'],
  [
    {
      dim: 'render',
      reason:
        'the guard prints nothing: its only output is a finding list, whose shape and content are asserted by the behavior arm'
    }
  ]
);

const PROOF_FILE_REL = 'tests/integration/readonly-surface/readonly-proof.test.ts';

/** The three-layer proof's unconditional carriage: it must run without asking anything. */
const PRECONDITION_SUITE = 'Scenario: integration — the proof cannot vanish with the build';
const LAYER_A_SUITE = 'Scenario: integration — layer A, state is read-only';
const LAYER_B_SUITE =
  'Scenario: integration — layer B, the CLI spawns nothing and reaches no network';

/** The ONE gate a proof carrier may carry today, and why it is allowed to be conditional. */
const LAYER_C_SANDBOX_SUITE =
  'Scenario: integration — layer C, the same result inside a real sandbox (CI-only)';

/**
 * The declared gates, per carrier. An entry is a CLAIM by this guard, not a copy of the
 * file: `PROOF_FILE_REL` carries exactly one gate and it is this one. A gate added
 * anywhere in a carrier — on a suite, or on a single arm — is a finding until it is
 * declared here, which is what makes "we skipped the proof for now" a deliberate edit to
 * this file rather than a silent one-line change to the proof.
 */
const DECLARED_GATES: Readonly<Record<string, readonly string[]>> = {
  [PROOF_FILE_REL]: [LAYER_C_SANDBOX_SUITE]
};

/** The suites whose unconditional registration the proof's whole claim rests on. */
const REQUIRED_UNGATED_LIST: readonly string[] = [PRECONDITION_SUITE, LAYER_A_SUITE, LAYER_B_SUITE];
const REQUIRED_UNGATED: Readonly<Record<string, readonly string[]>> = {
  [PROOF_FILE_REL]: REQUIRED_UNGATED_LIST
};

const PROOF_SOURCE = readFileSync(join(REPO_ROOT, PROOF_FILE_REL), 'utf8');

const LAYER_A_FIRST_ARM =
  'when each curated argv runs on a populated fixture, should leave the tree byte-identical';

/** Replace `from` with `to`, refusing to report an injection that matched nothing. */
function inject(source: string, from: string, to: string): string {
  if (!source.includes(from)) {
    throw new Error(`the injection anchor is not in ${PROOF_FILE_REL} any more:\n  ${from}`);
  }
  const injected = source.replace(from, to);
  expect(injected, 'the injection changed nothing').not.toBe(source);
  return injected;
}

/** The gate-put-back injection: exactly the spelling slice ① removed. */
function withWholeSuiteSkipIf(source: string): string {
  return inject(
    source,
    `describe('${PRECONDITION_SUITE}', () => {`,
    `describe.skipIf(!existsSync(DIST_ENTRY))('${PRECONDITION_SUITE}', () => {`
  );
}

/** The same vanish one layer down: one arm of layer A, switched off with `it.skip`. */
function withSkippedArm(source: string): string {
  return inject(
    source,
    `  it(\n    '${LAYER_A_FIRST_ARM}'`,
    `  it.skip(\n    '${LAYER_A_FIRST_ARM}'`
  );
}

/** Run the SAME checker the real-tree arm runs, over a tree holding this source. */
function findingsFor(source: string): ProofSkipFinding[] {
  let findings: ProofSkipFinding[] = [];
  withFixtureTree({ [PROOF_FILE_REL]: source }, (root) => {
    findings = checkProofCarriers(root, DECLARED_GATES, REQUIRED_UNGATED);
  });
  return findings;
}

describe('Scenario: integration — the carriers in THIS repository', () => {
  it('carry no gate this guard has not declared, and keep their carriage unconditional', () => {
    // given: the real repository root
    // when:  the whole rule runs over its proof carriers
    const findings = checkProofCarriers(REPO_ROOT, DECLARED_GATES, REQUIRED_UNGATED);

    // then:  the guard is silent, and it is silent because it MEASURED — never because
    //        the walk came back empty. The next arm is that measurement.
    expect(findings, describeProofFindings(findings)).toEqual([]);
  });

  it('are reached by the walk, and the scan SEES the one declared gate and the three required suites', () => {
    // ANTI-VACUITY. Every arm above passes on a scan that reads nothing, so the scan's
    // own reading is asserted against the claims in this file rather than against zero.
    // given: the walked carrier set
    const carriers = proofCarrierFiles(REPO_ROOT);

    // then:  it is non-empty and holds the file these claims are about
    expect(carriers.length, carriers.join(', ')).toBeGreaterThan(0);
    expect(carriers).toContain(PROOF_FILE_REL);

    // and:  the gates it finds are EXACTLY the declared list — a scan that found none,
    //       or found one somewhere else, goes red here
    expect(suiteSkipGates(PROOF_FILE_REL, PROOF_SOURCE).map((gate) => gate.title)).toEqual(
      DECLARED_GATES[PROOF_FILE_REL]
    );

    // and:  the required carriage is present unconditionally, by title
    expect(topLevelUnconditionalSuites(PROOF_FILE_REL, PROOF_SOURCE)).toEqual(
      expect.arrayContaining([...REQUIRED_UNGATED_LIST])
    );
  });
});

describe('Scenario: behavior — a gate put back is a finding', () => {
  it('when a whole-suite `skipIf` is put back on the precondition arm, should report the gate AND the lost carriage', () => {
    // given: the real proof, with the exact slice-① skip put back on its precondition
    // when:  the checker reads it
    const findings = findingsFor(withWholeSuiteSkipIf(PROOF_SOURCE));

    // then:  the gate is reported as undeclared, naming the suite it switches off…
    const undeclared = findings.filter((finding) => finding.rule === 'undeclared-skip-gate');
    expect(undeclared.map((finding) => finding.message).join('\n')).toContain(PRECONDITION_SUITE);
    expect(undeclared).toHaveLength(1);

    // …and the second half of the rule fires too: the carriage is no longer unconditional
    const lostCarriage = findings.filter((finding) => finding.rule === 'required-suite-is-gated');
    expect(lostCarriage.map((finding) => finding.message).join('\n')).toContain(PRECONDITION_SUITE);
    expect(lostCarriage).toHaveLength(1);
  });

  it('when ONE arm is switched off with `it.skip`, should report that gate — the same vanish, one layer down', () => {
    // given: the real proof, with layer A's main arm skipped
    // when:  the checker reads it
    const findings = findingsFor(withSkippedArm(PROOF_SOURCE));

    // then:  a single skipped arm is a finding: the evidence it carries disappears just
    //        as quietly as a whole suite's does
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe('undeclared-skip-gate');
    expect(findings[0]?.message).toContain(LAYER_A_FIRST_ARM);
  });

  it('when the proof directory holds no test file, should find nothing — which is why the walk was asserted above', () => {
    // given: a tree whose proof directory exists but carries no `.test.ts` file
    withFixtureTree(
      { 'tests/integration/readonly-surface/README.md': 'no test carriers here\n' },
      (root) => {
        // then:  an empty walk and a clean tree are indistinguishable from inside the
        //        checker, so "no findings" may never be read as "the proof is gated off"
        //        — the non-empty assertion above is what makes this arm's silence safe
        expect(proofCarrierFiles(root)).toEqual([]);
        expect(checkProofCarriers(root, DECLARED_GATES, REQUIRED_UNGATED)).toEqual([]);
      }
    );
  });
});

describe('Scenario: a11y — the refusal is specific enough to act on', () => {
  it('when a gate is undeclared, should name the file, the line, the gate and why it matters', () => {
    // given: the injected tree, and the line the guard put the gate on
    const injected = withWholeSuiteSkipIf(PROOF_SOURCE);
    const line = injected.split('\n').findIndex((text) => text.includes('describe.skipIf(')) + 1;

    // when:  the checker reads it
    const findings = findingsFor(injected);
    const message = describeProofFindings(findings);

    // then:  a reader can go straight to the site…
    expect(line).toBeGreaterThan(0);
    expect(message).toContain(`${PROOF_FILE_REL}:${line}`);
    expect(message).toContain('describe.skipIf');
    expect(message).toContain(PRECONDITION_SUITE);

    // …and is told the consequence, not just the fact
    expect(message).toContain('silent pass');
    expect(message).toContain('DECLARED_GATES');
  });
});
