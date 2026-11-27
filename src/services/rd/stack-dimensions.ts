/**
 * The declarative stack → audit-dimension table.
 *
 * The security audit template fixes 8 dimensions and the perf audit template
 * fixes 6, whatever the project is. A React app and a CLI are then audited for
 * the same surface, and the dimension that actually matters for the stack
 * (`csp` for a browser, `command-injection` for a CLI) is a footnote inside a
 * broader category. This module is the reviewable table that ADDS dimensions on
 * top of the fixed set.
 *
 * THE TABLE CAN ONLY ADD. There is deliberately no `remove` field: a profile
 * cannot waive a dimension the request type already requires, and
 * `assertAuditPlanAddsOnly` refuses a plan whose `removed` is non-empty by name
 * (`AUDIT_PLAN_REMOVAL_NOT_PERMITTED`). A plan is published as the dispatch
 * envelope's `data.auditPlan` and persisted on the dispatch record, so the
 * handoff gate can read it back (see `audit-plan-gate.ts`).
 *
 * WHERE THE INPUTS COME FROM. The profile is derived from `scanArchetype`'s
 * existing report — no new probe, no hand-filled file. The base is the set of
 * audit artifacts the request type's OWN prerequisite table demands today (read
 * through `getPrerequisitesFor`), so a type that needs no perf audit is never
 * handed perf dimensions it has nowhere to write.
 */
import { getPrerequisitesFor, type RequestType } from '../artifacts/artifact-prerequisites.js';
import type { ArchetypeReport } from '../scan/scan-types.js';

/** The stack classes this table speaks. `generic` adds nothing. */
export type StackProfile = 'frontend' | 'cli' | 'backend' | 'generic';

export const STACK_PROFILES: ReadonlyArray<StackProfile> = [
  'frontend',
  'cli',
  'backend',
  'generic'
];

/** The two audit artifacts that carry named dimensions. */
export type AuditKind = 'security' | 'perf';

/** One dimension the profile adds to one audit artifact. */
export interface AuditDimension {
  readonly audit: AuditKind;
  readonly dimension: string;
}

/**
 * THE TABLE. Profile → dimensions the stack ADDS, per audit kind. No entry can
 * remove one; the type has no field for it.
 */
export const STACK_AUDIT_ADDITIONS: Readonly<Record<StackProfile, readonly AuditDimension[]>> = {
  frontend: [
    { audit: 'security', dimension: 'xss' },
    { audit: 'security', dimension: 'csp' },
    { audit: 'perf', dimension: 'bundle' },
    { audit: 'perf', dimension: 'cold-start' }
  ],
  cli: [
    { audit: 'security', dimension: 'path-traversal' },
    { audit: 'security', dimension: 'command-injection' },
    { audit: 'security', dimension: 'fs-trust' }
  ],
  backend: [
    { audit: 'security', dimension: 'owasp' },
    { audit: 'security', dimension: 'sql-injection' },
    { audit: 'security', dimension: 'authz' }
  ],
  generic: []
};

/**
 * The dimensions the fixed templates already mandate, per audit kind. These are
 * the ids `base` publishes; `tests/unit/rd/stack-dimensions.test.ts` pins each
 * list's length to its template, so a template edit cannot silently leave the
 * base describing an older audit.
 */
export const AUDIT_BASE_DIMENSIONS: Readonly<Record<AuditKind, readonly string[]>> = {
  security: [
    'authentication-and-authorization',
    'secrets-management',
    'input-validation',
    'path-traversal-and-filesystem-trust',
    'sql-nosql-injection',
    'xss-and-content-injection',
    'dependency-supply-chain',
    'external-api-surface'
  ],
  perf: [
    'cpu-bound-path-latency',
    'io-throughput',
    'memory-allocation',
    'concurrency-model',
    'bundle-and-artifact-size',
    'cold-start-cost'
  ]
};

/** The plan published as `data.auditPlan` and stored on the dispatch record. */
export interface AuditPlan {
  readonly profile: StackProfile;
  readonly base: readonly string[];
  readonly added: readonly string[];
  /** Always empty by construction; a non-empty value is refused, never obeyed. */
  readonly removed: readonly string[];
}

/** Named refusals, so a caller can act on the code rather than on prose. */
export const AUDIT_PLAN_REMOVAL_NOT_PERMITTED = 'AUDIT_PLAN_REMOVAL_NOT_PERMITTED';
export const AUDIT_PLAN_BASE_NOT_COVERED = 'AUDIT_PLAN_BASE_NOT_COVERED';
export const AUDIT_PLAN_DIMENSION_UNCOVERED = 'AUDIT_PLAN_DIMENSION_UNCOVERED';

/** `security:xss` — one namespace for the set assertion and the gate. */
export function dimensionKey(audit: AuditKind, dimension: string): string {
  return `${audit}:${dimension}`;
}

/** The inverse of `dimensionKey`; `null` when the key is malformed. */
export function splitDimensionKey(key: string): AuditDimension | null {
  const separator = key.indexOf(':');
  if (separator <= 0) return null;
  const audit = key.slice(0, separator);
  const dimension = key.slice(separator + 1);
  if (audit !== 'security' && audit !== 'perf') return null;
  if (dimension.length === 0) return null;
  return { audit, dimension };
}

/** The audit kind a prerequisite artifact belongs to, or `null` for the rest. */
export function auditKindOfArtifact(relativePath: string): AuditKind | null {
  if (relativePath.startsWith('audit/security') || relativePath.startsWith('rd/security-review')) {
    return 'security';
  }
  if (relativePath.startsWith('audit/perf')) return 'perf';
  return null;
}

export interface StackProfileResolution {
  readonly profile: StackProfile;
  readonly reason: string;
}

/**
 * Derive the stack profile from the archetype report, reusing the report's own
 * derived fields (`frontendOnly` / `integrationMode` / `archetype`) so this is
 * not a second answer to "does this repository have a backend?".
 *
 * Order matters and is stated: a frontend-only repository is `frontend`; a
 * repository with a backend is `backend` (its server surface is the larger
 * risk); a published CLI is `cli`; anything else is `generic`, and the reason
 * names what was missing.
 */
export function resolveStackProfile(report: ArchetypeReport | null): StackProfileResolution {
  if (report === null) return { profile: 'generic', reason: 'archetype-unavailable' };
  if (report.frontendOnly) {
    return { profile: 'frontend', reason: `frontendOnly=${report.frontendOnlyReason}` };
  }
  if (report.integrationMode === 'full-stack') {
    return { profile: 'backend', reason: `integrationMode=${report.integrationModeReason}` };
  }
  if (report.archetype === 'cli') return { profile: 'cli', reason: 'archetype=cli' };
  if (report.detected.hasBin) {
    return { profile: 'cli', reason: 'bin-without-frontend-evidence' };
  }
  return { profile: 'generic', reason: 'no-frontend-evidence, no-backend-evidence, no-bin' };
}

/**
 * The audit kinds this request type must produce today, read from its own
 * prerequisite table. `config` has only a security review; `docs` / `chore`
 * have no handoff rows at all, so they carry no audit dimensions.
 */
export function baseAuditKindsFor(requestType: RequestType): readonly AuditKind[] {
  const kinds: AuditKind[] = [];
  for (const row of getPrerequisitesFor('rd', 'qa-handoff', requestType)) {
    const kind = auditKindOfArtifact(row.relativePath);
    if (kind !== null && !kinds.includes(kind)) kinds.push(kind);
  }
  return kinds;
}

/**
 * Build and validate the plan. Additions whose audit kind the request type does
 * not require are left out: there is no artifact to name them in, so publishing
 * them would demand a file the table never asked for. That is scoping, not
 * removal — the table's own entries are never dropped for a required audit.
 */
export function buildAuditPlan(profile: StackProfile, requestType: RequestType): AuditPlan {
  const baseKinds = baseAuditKindsFor(requestType);
  const base = baseKinds.flatMap((kind) =>
    AUDIT_BASE_DIMENSIONS[kind].map((dimension) => dimensionKey(kind, dimension))
  );
  const added = STACK_AUDIT_ADDITIONS[profile]
    .filter((entry) => baseKinds.includes(entry.audit))
    .map((entry) => dimensionKey(entry.audit, entry.dimension));
  const plan: AuditPlan = { profile, base, added, removed: [] };
  assertAuditPlanAddsOnly(plan, base);
  return plan;
}

/**
 * `selected ⊇ requiredBase`, and nothing removed. `requiredBase` is passed in
 * (not read off the plan) so the coverage arm can fail: a plan whose own `base`
 * was filtered must not certify itself, and a hand-authored plan is judged
 * against the table rather than against its own claim.
 *
 * The removal half is the type-level promise made executable: a plan that tries
 * to waive a dimension is refused by name, never obeyed.
 */
export function assertAuditPlanAddsOnly(plan: AuditPlan, requiredBase: readonly string[]): void {
  if (plan.removed.length > 0) {
    throw namedError(
      AUDIT_PLAN_REMOVAL_NOT_PERMITTED,
      `the audit plan for profile "${plan.profile}" removes ${plan.removed.join(', ')} — a profile may only add dimensions`
    );
  }
  const selected = new Set([...plan.base, ...plan.added]);
  const uncovered = requiredBase.filter((dimension) => !selected.has(dimension));
  if (uncovered.length > 0) {
    throw namedError(
      AUDIT_PLAN_BASE_NOT_COVERED,
      `the audit plan does not cover required dimensions: ${uncovered.join(', ')}`
    );
  }
}

/** Shape guard for a plan read back off disk; anything else reads as no plan. */
export function isAuditPlan(value: unknown): value is AuditPlan {
  if (typeof value !== 'object' || value === null) return false;
  const plan = value as Record<string, unknown>;
  if (typeof plan.profile !== 'string') return false;
  if (!(STACK_PROFILES as ReadonlyArray<string>).includes(plan.profile)) return false;
  return stringList(plan.base) && stringList(plan.added) && stringList(plan.removed);
}

function stringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function namedError(code: string, message: string): Error & { code: string } {
  const error = new Error(`${code}: ${message}`) as Error & { code: string };
  error.code = code;
  return error;
}
