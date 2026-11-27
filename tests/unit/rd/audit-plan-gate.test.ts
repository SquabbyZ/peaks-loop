// tests/unit/rd/audit-plan-gate.test.ts
//
// Slice S2.2 — the executable side of the stack → dimension table.
//
// When this session's dispatch record for a request carries an `auditPlan`,
// every dimension the stack profile ADDED must be named in the audit artifact
// its audit kind owns, or the `rd:qa-handoff` gate refuses by name. Two arms
// matter as much as the refusal:
//   - a session with NO plan is byte-for-byte unchanged (the historical-request
//     escape hatch is the plan's absence, and it must never retro-lock work),
//   - an artifact that does name every added dimension is not refused merely
//     because a plan exists.
// The records are written through the real `writeInitialDispatchRecord`, so the
// plan is read back through the writer's own upgrade path rather than through a
// fixture that could agree with a broken reader.

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { checkPrerequisites } from '../../../src/services/artifacts/artifact-prerequisites.js';
import { writeInitialDispatchRecord } from '../../../src/services/dispatch/dispatch-record-writer.js';
import {
  AUDIT_PLAN_DIMENSION_UNCOVERED,
  buildAuditPlan,
  type AuditPlan
} from '../../../src/services/rd/stack-dimensions.js';
import {
  AUDIT_PLAN_RECORD_UNREADABLE,
  auditPlanCoverageViolations
} from '../../../src/services/rd/audit-plan-gate.js';

declareDimensions('tests/unit/rd/audit-plan-gate.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const SESSION_ID = 's2-2-audit-plan-gate';
const RID = 'rid-audit-plan';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 's2-2-audit-plan-gate-'));
});

afterEach(() => {
  try {
    rmSync(project, { recursive: true, force: true });
  } catch {
    // Windows open-handle race on the tmp dir; it is reapable either way.
  }
});

function writeArtifact(relativePath: string, body: string): void {
  const absolute = join(project, '.peaks', '_runtime', SESSION_ID, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, body, 'utf8');
}

function recordPlan(plan: AuditPlan): void {
  writeInitialDispatchRecord({
    projectRoot: project,
    sessionId: SESSION_ID,
    requestId: RID,
    role: 'rd',
    prompt: 'S2.2 gate fixture',
    toolCall: { name: 'Task', args: {}, toolCallVersion: '2.0.0' },
    batchId: 'batch-s2-2',
    auditPlan: plan
  });
}

/** A frontend plan whose security additions are the two the artifact must name. */
function securityPlan(): AuditPlan {
  return { ...buildAuditPlan('frontend', 'feature'), added: ['security:xss', 'security:csp'] };
}

function gateCall(requestType: 'feature' | 'docs') {
  return auditPlanCoverageViolations({
    projectRoot: project,
    sessionId: SESSION_ID,
    requestId: RID,
    requestType
  });
}

async function gateOn(requestType: 'feature' | 'docs') {
  return (await gateCall(requestType)).missing;
}

function handoffGate() {
  return checkPrerequisites({
    projectRoot: project,
    sessionId: SESSION_ID,
    role: 'rd',
    newState: 'qa-handoff',
    requestType: 'feature',
    requestId: RID,
    emitEvents: false
  });
}

const SECURITY_ARTIFACT = `audit/security-${RID}.md`;
const PERF_ARTIFACT = `audit/perf-${RID}.md`;

describe('(behavior) the coverage refusal', () => {
  it('when the artifact names one added dimension, should refuse the other by name', async () => {
    // given: a plan adding xss + csp, and an artifact that names only xss
    // when:  the gate reads the session's plan
    // then:  exactly one refusal, naming the artifact and the missing dimension
    recordPlan(securityPlan());
    writeArtifact(SECURITY_ARTIFACT, '# Security audit\n\n## Verdict\n\ndimension: xss\n');
    const violations = await gateOn('feature');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.path).toBe(SECURITY_ARTIFACT);
    expect(violations[0]?.description).toContain(AUDIT_PLAN_DIMENSION_UNCOVERED);
    expect(violations[0]?.description).toContain('csp');
  });

  it('when the artifact names every added dimension, should not refuse', async () => {
    // given: the same plan, and an artifact naming both dimensions
    // when:  the gate reads the session's plan
    // then:  coverage is coverage, however the artifact spells it
    recordPlan(securityPlan());
    writeArtifact(SECURITY_ARTIFACT, '# Security audit\n\n## Verdict\n\n### xss\n\n### CSP\n');
    expect(await gateOn('feature')).toEqual([]);
  });

  it('when the plan adds a perf dimension, should look in the perf artifact', async () => {
    // given: a plan adding perf:bundle and a perf audit that does not name it
    // when:  the gate runs
    // then:  the refusal points at the perf artifact
    recordPlan({ ...buildAuditPlan('frontend', 'feature'), added: ['perf:bundle'] });
    writeArtifact(PERF_ARTIFACT, '# Performance audit\n\n## Baseline\n\n| metric | x |\n');
    const violations = await gateOn('feature');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.path).toBe(PERF_ARTIFACT);
    expect(violations[0]?.description).toContain('bundle');
  });
});

describe('(integration) the dispatch record is the switch', () => {
  it('when no dispatch record carries a plan, should leave the request unchanged', async () => {
    // given: an artifact that names neither dimension, and no dispatch record
    // when:  the gate runs
    // then:  a session without a plan gets no new demand at all
    writeArtifact(SECURITY_ARTIFACT, '# Security audit\n\n## Verdict\n');
    expect(await gateOn('feature')).toEqual([]);
  });

  it('when the record exists, should read the plan back off disk', async () => {
    // given: an artifact naming only xss, read before and after the record exists
    // when:  the gate runs with no record, then with one
    // then:  the record is the only difference, and it is what turns the gate on
    writeArtifact(SECURITY_ARTIFACT, '# Security audit\n\n## Verdict\n\ndimension: xss\n');
    const withoutPlan = await gateOn('feature');
    recordPlan(securityPlan());
    const withPlan = await gateOn('feature');
    expect(withoutPlan).toEqual([]);
    expect(withPlan.map((entry) => entry.path)).toEqual([SECURITY_ARTIFACT]);
  });

  it('when the plan only adds dimensions the request type never audits, should not refuse', async () => {
    // given: a docs request (no rd:qa-handoff rows) and a plan adding security:csp
    // when:  the gate runs
    // then:  no artifact is demanded for an audit the type does not require
    recordPlan({ ...buildAuditPlan('frontend', 'docs'), added: ['security:csp'] });
    expect(await gateOn('docs')).toEqual([]);
  });

  it('when the handoff gate runs, should surface the refusal as a missing entry', async () => {
    // given: the plan, an artifact that names only xss, and no other handoff evidence
    // when:  the rd:qa-handoff prerequisite check runs
    // then:  the named refusal is carried on the same result the transition throws on
    recordPlan(securityPlan());
    writeArtifact(SECURITY_ARTIFACT, '# Security audit\n\n## Verdict\n\ndimension: xss\n');
    const result = await handoffGate();
    expect(
      result.missing.some((entry) => entry.description.includes(AUDIT_PLAN_DIMENSION_UNCOVERED))
    ).toBe(true);
  });
});

describe('(integration) an unreadable record is reported, not swallowed', () => {
  it('when the record cannot be parsed, should warn instead of refusing', async () => {
    // given: a dispatch record the gate cannot parse, and an artifact naming nothing
    // when:  the gate reads the session's plan
    // then:  no refusal, and the reason arrives as a named warning
    recordPlan(securityPlan());
    writeArtifact(SECURITY_ARTIFACT, '# Security audit\n\n## Verdict\n');
    const dir = join(project, '.peaks', '_sub_agents', SESSION_ID);
    for (const name of readdirSync(dir)) {
      if (name.startsWith(`dispatch-${RID}-`)) {
        writeFileSync(join(dir, name), '{ not json', 'utf8');
      }
    }
    const result = await gateCall('feature');
    expect(result.missing).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.code).toBe(AUDIT_PLAN_RECORD_UNREADABLE);
  });
});

describe('(render) the same gate, without a plan', () => {
  it('when the record carries no plan, should not add the coverage entry', async () => {
    // given: identical artifacts, but the dispatch record carries no plan
    // when:  the handoff gate runs
    // then:  no coverage entry — the pre-S2.2 behaviour is untouched
    writeArtifact(SECURITY_ARTIFACT, '# Security audit\n\n## Verdict\n\ndimension: xss\n');
    writeInitialDispatchRecord({
      projectRoot: project,
      sessionId: SESSION_ID,
      requestId: RID,
      role: 'rd',
      prompt: 'S2.2 gate fixture — no plan',
      toolCall: { name: 'Task', args: {}, toolCallVersion: '2.0.0' },
      batchId: 'batch-s2-2'
    });
    const result = await handoffGate();
    expect(
      result.missing.some((entry) => entry.description.includes(AUDIT_PLAN_DIMENSION_UNCOVERED))
    ).toBe(false);
  });
});

describe('(a11y) the refusal is a named, readable sentence', () => {
  it('when a dimension is uncovered, should name the profile and the artifact in prose', async () => {
    // given: a plan adding xss + csp and an artifact naming neither
    // when:  the gate runs
    // then:  a human can act on the sentence without reading the code
    recordPlan(securityPlan());
    writeArtifact(SECURITY_ARTIFACT, '# Security audit\n\n## Verdict\n');
    const [violation] = await gateOn('feature');
    expect(violation?.description).toContain('frontend profile');
    expect(violation?.description).toContain(SECURITY_ARTIFACT);
    expect(violation?.description).toContain('AUDIT_PLAN_DIMENSION_UNCOVERED');
  });
});
