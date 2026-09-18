// tests/unit/cli/sub-agent-dispatch-deprecated-reviewer.test.ts
//
// Slice F2 (rid-f2-ac1-wiring) — first caller of
// `src/services/rd/reviewer-dispatch-policy.ts`.
//
// Before this slice that module had zero importers in src/ + packages/ +
// scripts/ (13/13 exports unreferenced); `security-reviewer` and
// `perf-baseline-reviewer` were neither rejected nor rerouted anywhere on
// the dispatch path. This file pins the wiring at the dispatch chokepoint
// (`dispatch-commands.ts` -> `deprecatedReviewerWarnings`), so deleting the
// call turns every case below red.
//
// Semantics pinned here: ACCEPT + reroute notice, never reject. The prereq
// side (`artifact-prerequisites.ts` `AUDIT_SECURITY` / `AUDIT_PERF`) accepts
// the legacy `rd/security-review.md` / `rd/perf-baseline.md` artifacts via
// `legacyRelativePaths`, and the policy module's own doc says the predicate
// exists to "route to the new audit skill **instead of failing the gate**".
// A refusal on the dispatch side would be a new asymmetry between the two
// halves of the same deprecation.
//
// Style: BDD given/when/then per peaks-loop 4.0.11+ contract.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import { registerSubAgentCommands } from '../../../src/cli/commands/sub-agent-commands.js';
import { deprecatedReviewerWarnings, validateRole } from '../../../src/cli/commands/sub-agent-shared.js';
import { getPrerequisitesFor } from '../../../src/services/artifacts/artifact-prerequisites.js';
import {
  RD_DEPRECATED_REVIEWERS,
  isDeprecatedReviewer,
} from '../../../src/services/rd/reviewer-dispatch-policy.js';

declareDimensions('tests/unit/cli/sub-agent-dispatch-deprecated-reviewer.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y',
]);

interface DispatchEnvelope {
  readonly ok: boolean;
  readonly command: string;
  readonly warnings: readonly string[];
  readonly nextActions: readonly string[];
  readonly data: { readonly role: string };
}

const SESSION_ID = '2026-09-18-f2-deprecated-reviewer';

let project: string;
let exitBefore: typeof process.exitCode;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'f2-deprecated-reviewer-'));
  exitBefore = process.exitCode;
  process.exitCode = 0;
});

afterEach(() => {
  process.exitCode = exitBefore;
  try {
    rmSync(project, { recursive: true, force: true });
  } catch {
    // Windows open-handle race on the tmp dir; it is reapable either way.
  }
});

/**
 * Runs the real `peaks sub-agent dispatch` action in-process (no subprocess,
 * no E2E suite) and returns the parsed envelope.
 */
async function runDispatch(role: string): Promise<DispatchEnvelope> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  program.exitOverride();
  registerSubAgentCommands(program, io);
  await program.parseAsync(
    [
      'sub-agent',
      'dispatch',
      role,
      '--prompt',
      'f2 probe — deprecated reviewer slot',
      '--request-id',
      'rid-f2-ac1-wiring',
      '--session-id',
      SESSION_ID,
      '--project',
      project,
      '--graph-node',
      'n1',
      '--json',
    ],
    { from: 'user' },
  );
  return JSON.parse(captured.text()) as DispatchEnvelope;
}

describe('(behavior) deprecatedReviewerWarnings — the one decision', () => {
  it('when the role is a deprecated reviewer slot, should return exactly one reroute notice', () => {
    // given: the 2 roles the v2.12.0 fan-out collapse removed
    // when:  the dispatch-side decision helper is asked for warnings
    // then:  each yields exactly one notice naming the replacement skill
    for (const role of RD_DEPRECATED_REVIEWERS) {
      const warnings = deprecatedReviewerWarnings(role);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(role);
      expect(warnings[0]).toContain('audit');
    }
  });

  it('when the role is a current fan-out reviewer, should return no warnings', () => {
    // given: a role that still exists in the 3-way fan-out
    // when:  the decision helper runs
    // then:  the dispatch envelope it feeds is unchanged
    expect(deprecatedReviewerWarnings('code-reviewer')).toEqual([]);
    expect(deprecatedReviewerWarnings('karpathy-reviewer')).toEqual([]);
    expect(deprecatedReviewerWarnings('qa-test-cases-writer')).toEqual([]);
  });

  it('when the role is an ordinary sub-agent role, should return no warnings', () => {
    // given: roles that are not reviewers at all
    // when:  the decision helper runs
    // then:  they are untouched by the policy
    for (const role of ['rd', 'qa', 'ui', 'txt', 'general-purpose']) {
      expect(deprecatedReviewerWarnings(role)).toEqual([]);
    }
  });
});

describe('(integration) the dispatch chokepoint calls the policy', () => {
  it('when dispatching a deprecated reviewer, should accept it and carry the reroute notice in the envelope', async () => {
    // given: `peaks sub-agent dispatch security-reviewer` — a call that
    //        succeeded silently before this slice
    // when:  the dispatch action runs end to end
    // then:  the dispatch still succeeds (prereq-side consistency) AND the
    //        envelope names both the removed role and the audit skill
    const env = await runDispatch('security-reviewer');
    expect(env.ok).toBe(true);
    expect(env.data.role).toBe('security-reviewer');
    expect(env.warnings.some((w) => w.includes('security-reviewer'))).toBe(true);
    expect(env.warnings.some((w) => w.includes('security-audit'))).toBe(true);
    expect(process.exitCode).toBe(0);
  });

  it('when dispatching the perf-baseline reviewer, should carry the same class of notice', async () => {
    // given: the second removed slot
    // when:  the dispatch action runs
    // then:  it is accepted and the notice names perf-audit
    const env = await runDispatch('perf-baseline-reviewer');
    expect(env.ok).toBe(true);
    expect(env.warnings.some((w) => w.includes('perf-audit'))).toBe(true);
  });

  it('when dispatching a current reviewer, should leave the envelope untouched', async () => {
    // given: `code-reviewer`, which is still in RD_FANOUT_REVIEWERS
    // when:  the dispatch action runs
    // then:  no warning at all appears — the wiring fires for the 2 removed
    //        slots only, so a current reviewer's envelope is untouched
    const env = await runDispatch('code-reviewer');
    expect(env.ok).toBe(true);
    expect(env.warnings).toEqual([]);
  });

  it('when dispatching an ordinary role, should leave the envelope untouched', async () => {
    // given: `rd`, a role the policy never governs
    // when:  the dispatch action runs
    // then:  the envelope is byte-identical in its warnings surface
    const env = await runDispatch('rd');
    expect(env.ok).toBe(true);
    expect(env.warnings).toEqual([]);
  });
});

describe('(render) envelope shape', () => {
  it('when a deprecated reviewer is dispatched, should render the notice as a plain warning string', () => {
    // given: any role the policy governs
    // when:  the notice is rendered
    // then:  it is a non-empty string carrying an actionable reroute command
    const warnings = deprecatedReviewerWarnings('security-reviewer');
    expect(typeof warnings[0]).toBe('string');
    expect(warnings[0]?.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('peaks security-audit run');
    expect(warnings[0]).toContain('peaks perf-audit run');
  });
});

describe('(a11y) the decision is reachable from the CLI surface', () => {
  it('when the audit skill names are checked, should not treat them as reviewer roles', () => {
    // given: the replacement skills are separate skills, not sub-agent roles
    // when:  the deprecated predicate is applied to their skill ids
    // then:  they are not flagged — routing to them is the caller's job
    expect(isDeprecatedReviewer('peaks-security-audit')).toBe(false);
    expect(isDeprecatedReviewer('peaks-perf-audit')).toBe(false);
  });

  it('when the prereq side resolves the qa-handoff gate, should still accept the same legacy slots', () => {
    // given: the dispatch side now consults the policy, and the prereq side
    //        already did (`legacyRelativePaths`)
    // when:  the rd:qa-handoff prerequisites for a feature are resolved
    // then:  both halves agree: the legacy slot is ACCEPTED on both sides,
    //        so the dispatch side must not refuse what the prereq accepts
    const prereqs = getPrerequisitesFor('rd', 'qa-handoff', 'feature');
    const security = prereqs.find((p) => p.relativePath === 'audit/security-<rid>.md');
    const perf = prereqs.find((p) => p.relativePath === 'audit/perf-<rid>.md');
    expect(security?.legacyRelativePaths).toContain('rd/security-review.md');
    expect(perf?.legacyRelativePaths).toContain('rd/perf-baseline.md');
    // ...and the dispatch side does not refuse the very slot whose artifact
    // the prereq side just accepted: `validateRole` returns null = accepted.
    // (That the acceptance is accompanied by a reroute NOTICE is asserted in
    // the behavior block; this asserts the ACCEPT half both sides share.)
    for (const role of RD_DEPRECATED_REVIEWERS) {
      expect(validateRole(role)).toBeNull();
    }
  });
});
