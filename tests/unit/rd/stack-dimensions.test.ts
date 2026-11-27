// tests/unit/rd/stack-dimensions.test.ts
//
// Slice S2.2 — the declarative stack → audit-dimension table. These cases pin
// the three shipped profiles, the `generic` fallback with its named reason, and
// the two refusals the type-level promise rests on: a plan may not remove a
// dimension (`AUDIT_PLAN_REMOVAL_NOT_PERMITTED`), and `selected` must cover the
// request type's base (`AUDIT_PLAN_BASE_NOT_COVERED`).
//
// The base is also pinned to the templates it describes, so a template edit
// that adds or drops a dimension cannot leave `AUDIT_BASE_DIMENSIONS` claiming
// an older audit.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import type { RequestType } from '../../../src/services/artifacts/artifact-prerequisites.js';
import type { ArchetypeReport, ProjectArchetype } from '../../../src/services/scan/scan-types.js';
import {
  AUDIT_BASE_DIMENSIONS,
  AUDIT_PLAN_BASE_NOT_COVERED,
  AUDIT_PLAN_REMOVAL_NOT_PERMITTED,
  assertAuditPlanAddsOnly,
  baseAuditKindsFor,
  buildAuditPlan,
  dimensionKey,
  resolveStackProfile,
  splitDimensionKey,
  type AuditPlan
} from '../../../src/services/rd/stack-dimensions.js';

declareDimensions('tests/unit/rd/stack-dimensions.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const TEMPLATE_DIR = join(
  process.cwd(),
  'src',
  'services',
  'workspace',
  'templates',
  'project-scan'
);

function archetypeReport(overrides: {
  archetype: ProjectArchetype;
  frontendOnly?: boolean;
  integrationMode?: ArchetypeReport['integrationMode'];
  hasBin?: boolean;
}): ArchetypeReport {
  return {
    archetype: overrides.archetype,
    confidence: 'high',
    frontendOnly: overrides.frontendOnly ?? false,
    frontendOnlyReason: 'frontend-evidence=react',
    integrationMode: overrides.integrationMode ?? 'prd-only',
    integrationModeReason: 'backend-detected',
    signals: [],
    detected: {
      hasPackageJson: true,
      hasBackendFramework: overrides.integrationMode === 'full-stack',
      backendFrameworks: [],
      nestedServiceEvidence: [],
      hasNextServerActions: false,
      hasSwaggerOrProto: false,
      swaggerPaths: [],
      hasMonorepoConfig: false,
      monorepoConfigs: [],
      hasNextApiRoutes: false,
      srcFileCount: 1,
      backendDirsPresent: [],
      lockfileAgeDays: null,
      hasBin: overrides.hasBin ?? false,
      frontendEvidence: overrides.frontendOnly === true ? 'react' : null
    }
  };
}

function dimensionCount(template: string): number {
  const body = readFileSync(join(TEMPLATE_DIR, template), 'utf8');
  return body.split('\n').filter((line) => /^\d+\. \*\*/.test(line)).length;
}

describe('(render) the plan shape', () => {
  it('when a frontend feature request is planned, should publish base and added in one namespace', () => {
    // given: a frontend-only repository asking for a feature slice
    // when:  the plan is built
    // then:  base is the 14 template dimensions and added is exactly the four
    //        stack dimensions, never a removal
    const plan = buildAuditPlan('frontend', 'feature');
    expect(plan.profile).toBe('frontend');
    expect(plan.base).toEqual([
      ...AUDIT_BASE_DIMENSIONS.security.map((d) => dimensionKey('security', d)),
      ...AUDIT_BASE_DIMENSIONS.perf.map((d) => dimensionKey('perf', d))
    ]);
    expect(plan.added).toEqual(['security:xss', 'security:csp', 'perf:bundle', 'perf:cold-start']);
    expect(plan.removed).toEqual([]);
  });

  it('when a plan key is split, should answer the audit kind and dimension or nothing', () => {
    // given: one well-formed key and two malformed ones
    // when:  each is parsed
    // then:  only the well-formed key survives
    expect(splitDimensionKey('security:csp')).toEqual({ audit: 'security', dimension: 'csp' });
    expect(splitDimensionKey('docs:csp')).toBeNull();
    expect(splitDimensionKey('security:')).toBeNull();
  });
});

describe('(behavior) the three profiles and the generic fallback', () => {
  function expectProfile(report: ArchetypeReport, profile: string, added: string[]): void {
    const resolved = resolveStackProfile(report);
    const plan = buildAuditPlan(resolved.profile, 'feature');
    expect(resolved.profile).toBe(profile);
    expect(plan.added).toEqual(added);
    expect(plan.removed).toEqual([]);
  }

  it('when the report describes a frontend stack, should add exactly its dimensions', () => {
    // given: a frontend-only report
    // when:  the profile and plan are derived
    // then:  the profile matches and the browser dimensions are the additions
    expectProfile(
      archetypeReport({ archetype: 'legacy-frontend', frontendOnly: true }),
      'frontend',
      ['security:xss', 'security:csp', 'perf:bundle', 'perf:cold-start']
    );
  });

  it('when the report describes a cli stack, should add exactly its dimensions', () => {
    // given: a published-CLI report
    // when:  the profile and plan are derived
    // then:  the process-boundary dimensions are the additions
    expectProfile(archetypeReport({ archetype: 'cli', hasBin: true }), 'cli', [
      'security:path-traversal',
      'security:command-injection',
      'security:fs-trust'
    ]);
  });

  it('when the report describes a backend stack, should add exactly its dimensions', () => {
    // given: a full-stack report
    // when:  the profile and plan are derived
    // then:  the server dimensions are the additions
    expectProfile(
      archetypeReport({ archetype: 'legacy-fullstack', integrationMode: 'full-stack' }),
      'backend',
      ['security:owasp', 'security:sql-injection', 'security:authz']
    );
  });

  it('when no stack signal is present, should answer generic with a named reason', () => {
    // given: a library-shaped report with no frontend, backend, or bin signal
    // when:  the profile is derived
    // then:  the reason names all three absences and the plan adds nothing
    const resolved = resolveStackProfile(archetypeReport({ archetype: 'greenfield' }));
    const plan = buildAuditPlan(resolved.profile, 'feature');
    expect(resolved.profile).toBe('generic');
    expect(resolved.reason).toContain('no-frontend-evidence');
    expect(plan.added).toEqual([]);
    expect(plan.base.length).toBeGreaterThan(0);
  });

  it('when the archetype report is unavailable, should answer generic rather than guess', () => {
    // given: no report at all
    // when:  the profile is derived
    // then:  the fallback is named
    expect(resolveStackProfile(null)).toEqual({
      profile: 'generic',
      reason: 'archetype-unavailable'
    });
  });

  it('when a plan removes a dimension, should refuse it by name', () => {
    // given: a valid plan with one dimension moved into `removed`
    // when:  the plan is validated against its own base
    // then:  the refusal names the code, not a silent waiver
    const plan: AuditPlan = { ...buildAuditPlan('frontend', 'feature'), removed: ['security:xss'] };
    expect(() => assertAuditPlanAddsOnly(plan, plan.base)).toThrow(
      AUDIT_PLAN_REMOVAL_NOT_PERMITTED
    );
  });

  it('when a plan fails to cover a required base dimension, should refuse it by name', () => {
    // given: a plan that selected one dimension, and a required base of two
    // when:  the plan is validated against the required base
    // then:  the coverage arm refuses with its own code
    const plan = buildAuditPlan('frontend', 'feature');
    const required = ['security:xss', 'security:not-in-this-plan'];
    expect(() => assertAuditPlanAddsOnly(plan, required)).toThrow(AUDIT_PLAN_BASE_NOT_COVERED);
  });
});

describe('(integration) the base comes from the request type table', () => {
  const expected: ReadonlyArray<[RequestType, string[]]> = [
    ['feature', ['security', 'perf']],
    ['bugfix', ['security', 'perf']],
    ['refactor', ['security', 'perf']],
    ['config', ['security']],
    ['docs', []],
    ['chore', []]
  ];

  it('when each request type is measured, should require exactly its own audits', () => {
    // given: each request type's own rd:qa-handoff prerequisite table
    // when:  the base audit kinds are derived
    // then:  a plan cannot add a dimension to an audit the type never asks for
    for (const [requestType, kinds] of expected) {
      expect(baseAuditKindsFor(requestType)).toEqual(kinds);
    }
  });

  it('when a config request is planned for a frontend stack, should add only security dimensions', () => {
    // given: config's table has a security review and no perf audit
    // when:  the plan is built
    // then:  the perf additions are scoped out, not silently demanded
    const plan = buildAuditPlan('frontend', 'config');
    expect(plan.added).toEqual(['security:xss', 'security:csp']);
    expect(plan.base.every((key) => key.startsWith('security:'))).toBe(true);
  });
});

describe('(a11y) the base describes the shipped templates', () => {
  it('when the fixed templates are read, should match the base dimension counts', () => {
    // given: the two bootstrap templates and the base constant
    // when:  both are counted
    // then:  the table describes today's template, not an older one
    expect(AUDIT_BASE_DIMENSIONS.security).toHaveLength(dimensionCount('security-template.md'));
    expect(AUDIT_BASE_DIMENSIONS.perf).toHaveLength(dimensionCount('perf-template.md'));
    expect(dimensionCount('security-template.md')).toBe(8);
    expect(dimensionCount('perf-template.md')).toBe(6);
  });
});
