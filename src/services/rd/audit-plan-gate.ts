/**
 * The executable half of the stack → dimension table: the handoff gate.
 *
 * `stack-dimensions.ts` decides which dimensions a stack ADDS. This module makes
 * that decision a gate: when THIS SESSION's dispatch record for the request
 * carries an `auditPlan`, every `added` dimension must be named in the audit
 * artifact its audit kind owns, or the `rd:qa-handoff` transition refuses.
 *
 * WHY THE RECORD AND NOT THE REQUEST. Requests that predate this slice have no
 * plan anywhere, and enforcing the table against them would retroactively lock
 * sessions mid-flight. The dispatch record is written when the plan is decided,
 * so its absence means "this request was dispatched before S2.2" and the gate
 * stays exactly as it was. A record that cannot be read carries no plan, and is
 * therefore also unchanged — the trigger is a plan that is there, never a
 * missing one.
 *
 * ABSENCE IS NOT THIS GATE'S REFUSAL. A missing audit artifact is already a
 * named failure of its own prerequisite row; reporting it again here would
 * double-count one gap. This gate only refuses a file that EXISTS and does not
 * name the dimension the stack added.
 *
 * The import of `artifact-prerequisites.ts` is static while that module imports
 * THIS one dynamically (inside `checkPrerequisites`), so the cycle is broken in
 * the same direction, and for the same reason, as the declared-gate-evidence
 * import.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  getPrerequisitesFor,
  type PrerequisiteCheckResult,
  type RequestType
} from '../artifacts/artifact-prerequisites.js';
import {
  resolvePrerequisiteAbsolutePathWithFallback,
  resolvePrerequisitePath,
  sessionRootsFor
} from '../artifacts/prerequisite-path-resolver.js';
import { REQUEST_ID_PATTERN } from '../artifacts/request-artifact-service.js';
import { isSinglePathSegment } from '../session/getSessionDir.js';
import {
  AUDIT_PLAN_DIMENSION_UNCOVERED,
  auditKindOfArtifact,
  isAuditPlan,
  splitDimensionKey,
  type AuditPlan
} from './stack-dimensions.js';
import type { DispatchRecord } from '../dispatch/dispatch-record-types.js';
import { upgradeRecord } from '../dispatch/dispatch-record-upgrade.js';

/** The directory `peaks sub-agent dispatch` writes its records into. */
const SUB_AGENTS_DIR = '.peaks/_sub_agents';

/** Bound on a read-failure reason, so a parse error cannot paste the record into a warning. */
const MAX_REASON_CHARS = 160;

export interface AuditPlanGateInput {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly requestId: string;
  readonly requestType: RequestType;
}

/**
 * A dispatch record the gate could not read into a plan. Named so the handoff
 * result can carry it as a warning instead of letting the failure read as "no
 * plan was ever recorded".
 */
export const AUDIT_PLAN_RECORD_UNREADABLE = 'AUDIT_PLAN_RECORD_UNREADABLE';

/** What the gate contributes to the handoff result: refusals plus read warnings. */
export type AuditPlanGateResult = Pick<PrerequisiteCheckResult, 'missing' | 'warnings'>;

/**
 * One `missing` entry per added dimension the artifact does not name, plus a
 * warning for every record the gate could not read. Both lists are empty when
 * the session never recorded a plan — the historical-request escape hatch is
 * the plan's absence, and it is silent on purpose.
 */
export async function auditPlanCoverageViolations(
  input: AuditPlanGateInput
): Promise<AuditPlanGateResult> {
  // The session id is joined into a filesystem path below, so it is checked
  // before the join; an unsafe id is not a plan and does not become a refusal.
  if (!isSinglePathSegment(input.sessionId)) return { missing: [], warnings: [] };
  if (!REQUEST_ID_PATTERN.test(input.requestId)) return { missing: [], warnings: [] };
  const { plan, warnings } = readSessionPlan(input);
  if (plan === null) return { missing: [], warnings };

  const requirements = getPrerequisitesFor('rd', 'qa-handoff', input.requestType);
  const roots = sessionRootsFor(input.projectRoot, input.sessionId);
  const violations: PrerequisiteCheckResult['missing'] = [];
  for (const key of plan.added) {
    const dimension = splitDimensionKey(key);
    if (dimension === null) continue;
    const row = requirements.find(
      (candidate) => auditKindOfArtifact(candidate.relativePath) === dimension.audit
    );
    if (row === undefined) continue;
    const relative = resolvePrerequisitePath(row, input.requestId);
    const absolute = await resolvePrerequisiteAbsolutePathWithFallback(
      roots.canonical,
      roots.legacy,
      row,
      input.requestId
    );
    if (absolute === null) continue;
    if (artifactNamesDimension(absolute, dimension.dimension)) continue;
    violations.push({
      kind: 'body',
      path: relative,
      description: `${AUDIT_PLAN_DIMENSION_UNCOVERED}: the ${plan.profile} profile adds ${dimension.audit} dimension "${dimension.dimension}", which ${relative} does not name`
    });
  }
  return { missing: violations, warnings };
}

/** Case-insensitive on purpose: a heading, a `dimension:` line, or prose all count. */
function artifactNamesDimension(absolute: string, dimension: string): boolean {
  let body: string;
  try {
    body = readFileSync(absolute, 'utf8');
  } catch {
    // A file the gate cannot read is not evidence that it names the dimension.
    return false;
  }
  return body.toLowerCase().includes(dimension.toLowerCase());
}

/** One record's outcome: a plan, a record with none, or a reason it was unreadable. */
type RecordPlanRead =
  | { readonly kind: 'plan'; readonly createdAt: string; readonly plan: AuditPlan }
  | { readonly kind: 'no-plan' }
  | { readonly kind: 'unreadable'; readonly reason: string };

/**
 * The most recent dispatch record for this request that carries a plan, plus a
 * warning for every record that could not be read. Older records for the same
 * rid are superseded by a later dispatch — the plan is policy for the work that
 * followed it.
 */
function readSessionPlan(input: AuditPlanGateInput): {
  plan: AuditPlan | null;
  warnings: PrerequisiteCheckResult['warnings'];
} {
  const dir = join(input.projectRoot, SUB_AGENTS_DIR, input.sessionId);
  if (!existsSync(dir)) return { plan: null, warnings: [] };
  const prefix = `dispatch-${input.requestId}-`;
  let latest: { createdAt: string; plan: AuditPlan } | null = null;
  const warnings: PrerequisiteCheckResult['warnings'] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.startsWith(prefix) || !entry.endsWith('.json')) continue;
    const found = readRecordPlan(join(dir, entry));
    if (found.kind === 'unreadable') {
      warnings.push({
        path: [SUB_AGENTS_DIR, input.sessionId, entry].join('/'),
        code: AUDIT_PLAN_RECORD_UNREADABLE,
        message: `the dispatch record could not be read as an audit plan, so the gate treated the request as dispatched without one: ${found.reason}`
      });
      continue;
    }
    if (found.kind === 'no-plan') continue;
    if (latest === null || found.createdAt >= latest.createdAt) {
      latest = { createdAt: found.createdAt, plan: found.plan };
    }
  }
  return { plan: latest?.plan ?? null, warnings };
}

/** One record's `auditPlan`, through the writer's own upgrade reader. */
function readRecordPlan(recordPath: string): RecordPlanRead {
  let record: DispatchRecord;
  try {
    record = upgradeRecord(JSON.parse(readFileSync(recordPath, 'utf8')) as unknown);
  } catch (err) {
    // Unparseable or unsupported record: no plan, and the reason travels with
    // the read so the caller can report it rather than swallow it here. Bounded
    // like every other reader's reason, so a parse error cannot paste the whole
    // record into the envelope.
    return {
      kind: 'unreadable',
      reason: (err instanceof Error ? err.message : String(err)).slice(0, MAX_REASON_CHARS)
    };
  }
  if (!isAuditPlan(record.auditPlan) || record.auditPlan.added.length === 0) {
    return { kind: 'no-plan' };
  }
  return { kind: 'plan', createdAt: record.createdAt, plan: record.auditPlan };
}
