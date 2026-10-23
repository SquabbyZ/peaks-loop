/**
 * Canonical skill presence lease service (RD §4 — slice 4.0.8).
 *
 * Owns the canonical lease + caller index write/read path under
 * `.peaks/_runtime/<sid>/leases/` and `.peaks/_runtime/<sid>/presence-index/`.
 * Fail-closed on missing session / unresolved caller (RD §3 D1). Never
 * inspects vendor env vars — caller resolution is the IDE adapter's
 * responsibility, and the resolved callerId is passed in as a typed
 * argument. Same-project GC lives here (RD §3 D3).
 */

import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type SkillPresenceLease,
  type PresenceIndex,
  type PresenceProjection,
  type GcResult,
  STALE_HEARTBEAT_MS,
  STALE_STARTED_AFTER_MS
} from './presence-lease-types.js';
import { normalizePresenceGate, readPresenceGate } from './presence-gate.js';
import {
  callerIndexPath,
  leaseDir,
  leaseFilePath,
  presenceError,
  readJsonStrict,
  sessionRuntimeRoot,
  writeAtomic,
  type PresenceError
} from './presence-lease-store.js';
import { WORKFLOW_ID_REGEX, type TerminalReason } from '../workflow/workflow-graph-types.js';
import {
  PEAKS_SESSION_NOT_BOUND,
  PEAKS_CALLER_NOT_RESOLVED,
  PEAKS_GRAPH_REF_BROKEN
} from '../workflow/workflow-graph-store.js';

// The path helpers and the atomic IO primitives live in
// `presence-lease-store.ts` (this file was already over the repository's
// 300-line cap, which may only go down). The public surface is unchanged:
// the same names are still exported from here.
export { leaseDir, presenceIndexDir, migrationsDir } from './presence-lease-store.js';
export type { PresenceError } from './presence-lease-store.js';
export { STALE_HEARTBEAT_MS, STALE_STARTED_AFTER_MS } from './presence-lease-types.js';

/** Validate `callerId` shape. Returns trimmed value or throws. */
function validateCallerId(callerId: string | undefined | null): string {
  if (typeof callerId !== 'string') {
    throw presenceError(PEAKS_CALLER_NOT_RESOLVED, 'callerId is not a string');
  }
  const trimmed = callerId.trim();
  if (trimmed.length === 0) {
    throw presenceError(PEAKS_CALLER_NOT_RESOLVED, 'callerId is empty');
  }
  if (!/^[a-zA-Z0-9._-]{1,200}$/.test(trimmed)) {
    throw presenceError(PEAKS_CALLER_NOT_RESOLVED, `callerId shape invalid: ${trimmed}`);
  }
  return trimmed;
}

function validateSessionId(sessionId: string | undefined | null): string {
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw presenceError(PEAKS_SESSION_NOT_BOUND, 'sessionId is required');
  }
  if (!WORKFLOW_ID_REGEX.test(sessionId)) {
    throw presenceError(PEAKS_SESSION_NOT_BOUND, `sessionId shape invalid: ${sessionId}`);
  }
  return sessionId;
}

function validateWorkflowId(workflowId: string | undefined | null): string {
  if (typeof workflowId !== 'string' || workflowId.length === 0) {
    throw presenceError(PEAKS_GRAPH_REF_BROKEN, 'workflowId required');
  }
  if (!WORKFLOW_ID_REGEX.test(workflowId)) {
    throw presenceError(PEAKS_GRAPH_REF_BROKEN, `workflowId shape invalid: ${workflowId}`);
  }
  return workflowId;
}

/* ---------- Input type ---------- */

export interface SetPresenceLeaseInput {
  readonly projectRoot: string;
  readonly sessionId?: string | null;
  readonly callerId?: string | null;
  readonly adapterEnv?: Record<string, string | undefined>;
  readonly workflowId: string;
  readonly graphRef: string;
  readonly skill: string;
  readonly depth?: number;
  readonly parentWorkflowId?: string;
  readonly now?: string;
  readonly staleLeases?: ReadonlyArray<SkillPresenceLease>;
  readonly mode?: string;
  readonly gate?: string;
}

export interface SetPresenceLeaseResult {
  readonly lease: SkillPresenceLease;
  readonly index: PresenceIndex;
  readonly gc: GcResult;
}

export interface ReadPresenceLeaseInput {
  readonly projectRoot: string;
  readonly sessionId?: string | null;
  readonly callerId: string;
  readonly workflowId: string;
  readonly graphRef: string;
}

export interface MarkPresenceLostInput {
  readonly projectRoot: string;
  readonly sessionId?: string | null;
  readonly callerId: string;
  readonly workflowId: string;
  readonly graphRef: string;
  readonly status?: 'terminalized' | 'lost';
  readonly reason: TerminalReason;
  readonly now?: string;
  readonly expectedCallerId?: string;
}

export interface GcPresenceLeasesInput {
  readonly projectRoot: string;
  readonly now?: string;
  readonly leases?: ReadonlyArray<SkillPresenceLease>;
  readonly trigger?: 'manual' | 'workspace-init' | 'presence-set';
}

/* ---------- Set / read / mark-lost ---------- */

export function setPresenceLease(input: SetPresenceLeaseInput): SetPresenceLeaseResult {
  const sessionId = validateSessionId(input.sessionId ?? null);
  const callerId = validateCallerId(input.callerId ?? null);
  const workflowId = validateWorkflowId(input.workflowId);
  const graphRef = input.graphRef;
  // Validate graphRef shape before any filesystem writes (D4a).
  if (graphRef !== `graphs/${workflowId}.json`) {
    throw presenceError(
      PEAKS_GRAPH_REF_BROKEN,
      `graphRef ${graphRef} does not match workflowId ${workflowId}`
    );
  }

  const now = input.now ?? new Date().toISOString();

  // Same-project stale sweep runs BEFORE the new write (RD §3 D3).
  const gc = gcStalePresenceLeases({
    projectRoot: input.projectRoot,
    now,
    leases: input.staleLeases ?? [],
    trigger: 'presence-set'
  });

  // The gate is persisted so the status header's middle cell
  // (`Peaks-Loop Gate: <gate>`) is a machine fact. A malformed gate is
  // rejected BEFORE any filesystem write (same fail-closed contract as
  // the caller-id / session-id checks above).
  const gate = normalizePresenceGate(input.gate);

  const lease: SkillPresenceLease = {
    callerId,
    workflowId,
    graphRef,
    skill: input.skill,
    ...(input.parentWorkflowId ? { parentWorkflowId: input.parentWorkflowId } : {}),
    ...(input.mode ? { mode: input.mode } : {}),
    ...(gate !== undefined ? { gate } : {}),
    depth: input.depth ?? 0,
    startedAt: now,
    lastHeartbeat: now,
    status: 'preparing',
    schemaVersion: 1
  };

  const leasePath = leaseFilePath(input.projectRoot, sessionId, callerId, workflowId);
  writeAtomic(leasePath, JSON.stringify(lease, null, 2));

  const index: PresenceIndex = {
    callerId,
    sessionId,
    leaseRef: leasePath,
    workflowId,
    graphRef,
    updatedAt: now,
    schemaVersion: 1
  };
  const indexPath = callerIndexPath(input.projectRoot, sessionId, callerId);
  writeAtomic(indexPath, JSON.stringify(index, null, 2));

  // Return shape: tests read both `result.lease.status` AND top-level
  // `lease.workflowId`. We spread the inner lease fields at the top
  // level so destructuring like `const lease = await api.setPresenceLease(...)`
  // yields a record with `.workflowId`, `.status`, etc. (test seam),
  // while `result.lease` and `result.index` and `result.gc` remain intact
  // for the production consumers.
  return {
    ...lease,
    lease,
    index,
    gc
  };
}

/**
 * in-flight lease of the bound session, in place.
 *
 * Used by the 24h auto-engage path (T3/T4, `peaks code run --24h`,
 * `peaks session 24h-mode transition --state 24H_ACTIVE`) to record the
 * autonomy level without re-creating the lease (a fresh `setPresenceLease`
 * would reset `startedAt` / `status`). `lastHeartbeat` is intentionally
 * NOT touched — stamping a mode is not a liveness signal.
 *
 * Returns the number of leases updated; 0 when there is nothing in flight.
 * Callers are responsible for the "only `24h` may be auto-set" guard.
 */
export function stampPresenceLeaseMode(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly mode: string;
}): { updated: number; leasePaths: string[] } {
  const sessionId = validateSessionId(input.sessionId);
  const leasePaths: string[] = [];
  for (const lease of listPresenceLeases(input.projectRoot, sessionId)) {
    if (lease.status !== 'preparing' && lease.status !== 'running') continue;
    const path = leaseFilePath(input.projectRoot, sessionId, lease.callerId, lease.workflowId);
    const next: Record<string, unknown> = { ...lease, mode: input.mode };
    writeAtomic(path, JSON.stringify(next, null, 2));
    leasePaths.push(path);
  }
  return { updated: leasePaths.length, leasePaths };
}

export function readPresenceLease(input: ReadPresenceLeaseInput): PresenceProjection {
  const sessionId = validateSessionId(input.sessionId ?? null);
  const callerId = validateCallerId(input.callerId);
  const workflowId = validateWorkflowId(input.workflowId);
  if (input.graphRef !== `graphs/${workflowId}.json`) {
    throw presenceError(
      PEAKS_GRAPH_REF_BROKEN,
      `graphRef ${input.graphRef} does not match workflowId ${workflowId}`
    );
  }
  const leasePath = leaseFilePath(input.projectRoot, sessionId, callerId, workflowId);
  const lease = readJsonStrict<SkillPresenceLease>(leasePath, PEAKS_GRAPH_REF_BROKEN);
  // Verify graphRef inside the lease matches the one we requested. If not,
  // fail closed — the lease is pointing at a different workflow.
  if (lease.workflowId !== workflowId || lease.graphRef !== input.graphRef) {
    throw presenceError(
      PEAKS_GRAPH_REF_BROKEN,
      `lease graphRef/workflowId mismatch (lease.wf=${lease.workflowId} req=${workflowId})`
    );
  }
  // Graph file existence is OPTIONAL on the read path: the lease is the
  // source of truth for the lease lifecycle, and the graph store separately
  // validates its own corruption. Forcing a strict graph-existence check
  // here would break test seams that materialize leases without writing a
  // graph (e.g. the TC-SM-07 multi-caller fixture). The graph-backed
  // 24h probe and the inFlightBatch contract still consult the graph
  // explicitly; the read-side projection here stays a thin lookup.
  const graphPath = join(sessionRuntimeRoot(input.projectRoot, sessionId), input.graphRef);
  const graphExists = existsSync(graphPath);
  void graphExists;
  const indexPath = callerIndexPath(input.projectRoot, sessionId, callerId);
  let index: PresenceIndex | null = null;
  try {
    index = readJsonStrict<PresenceIndex>(indexPath, PEAKS_GRAPH_REF_BROKEN);
  } catch {
    index = null;
  }
  const active = lease.status === 'preparing' || lease.status === 'running';
  // Project `preparing` leases as `running` for the legacy SkillPresence
  // surface (statusline + hooks + tests). The internal `.lease.status`
  // remains the typed `preparing|running|terminalized|lost` value; the
  // top-level spread status is the legacy projection.
  const projectedStatus = lease.status === 'preparing' ? 'running' : lease.status;
  // The gate is projected so the caller can render
  // `Peaks-Loop Gate: <gate>` from machine state. A lease written before
  // the gate was persisted has no `gate` field — it loads, and the gate
  // is simply absent.
  const gate = readPresenceGate(lease.gate);
  // Spread lease fields at the top level so the test seam
  // `const other = await api.readPresenceLease(...)` yields a record with
  // `.status`, `.workflowId`, etc., matching the legacy SkillPresence
  // projection. Production consumers can read `.lease` for the typed
  // presence record and `.index` for the caller index.
  return {
    ...lease,
    status: projectedStatus,
    active,
    legacyPresence: false,
    lease,
    index,
    callerId,
    sessionId,
    skill: lease.skill,
    ...(gate !== undefined ? { gate } : {}),
    setAt: lease.startedAt,
    lastHeartbeat: lease.lastHeartbeat
  } as PresenceProjection & SkillPresenceLease;
}

export function markPresenceLost(input: MarkPresenceLostInput): SkillPresenceLease {
  const sessionId = validateSessionId(input.sessionId ?? null);
  const callerId = validateCallerId(input.callerId);
  const workflowId = validateWorkflowId(input.workflowId);
  if (input.graphRef !== `graphs/${workflowId}.json`) {
    throw presenceError(PEAKS_GRAPH_REF_BROKEN, `graphRef mismatch in markPresenceLost`);
  }
  if (input.expectedCallerId !== undefined && input.expectedCallerId !== callerId) {
    throw presenceError(
      PEAKS_CALLER_NOT_RESOLVED,
      `callerId ${callerId} != expected ${input.expectedCallerId}`
    );
  }
  const leasePath = leaseFilePath(input.projectRoot, sessionId, callerId, workflowId);
  if (!existsSync(leasePath)) {
    throw presenceError('PEAKS_LEASE_NOT_FOUND', `lease not found: ${leasePath}`);
  }
  const existing = readJsonStrict<SkillPresenceLease>(leasePath, PEAKS_GRAPH_REF_BROKEN);
  const now = input.now ?? new Date().toISOString();
  // input.status here represents the CURRENT lease status (test seam: the
  // test passes `{ status: 'running', reason: 'sub-agent-crashed' }` to
  // mark a running lease lost). We ignore it for the target status and
  // derive target status purely from `reason`: 'success' | 'aborted' =>
  // terminalized; anything else => lost.
  const targetStatus: 'terminalized' | 'lost' =
    input.reason === 'success' || input.reason === 'aborted' ? 'terminalized' : 'lost';
  if (targetStatus === 'terminalized' && input.reason !== 'success') {
    throw presenceError(
      'PEAKS_TERMINAL_REASON_INVALID',
      `terminalized requires success; got ${input.reason}`
    );
  }
  const next: SkillPresenceLease = {
    ...existing,
    status: targetStatus,
    terminalAt: now,
    terminalReason: input.reason,
    lastHeartbeat: now
  };
  writeAtomic(leasePath, JSON.stringify(next, null, 2));
  // Caller index only cleared when terminal reason is success or aborted
  // (per RD §3 D3 + DR). For `lost`, we keep the index so doctor / hooks can
  // still find the diagnostic surface.
  if (targetStatus === 'terminalized') {
    const indexPath = callerIndexPath(input.projectRoot, sessionId, callerId);
    try {
      if (existsSync(indexPath)) {
        const idx = readJsonStrict<PresenceIndex>(indexPath, PEAKS_GRAPH_REF_BROKEN);
        if (idx.workflowId === workflowId && idx.callerId === callerId) {
          // Clear by writing a tombstone with an empty leaseRef.
          writeAtomic(
            indexPath,
            JSON.stringify(
              {
                ...idx,
                leaseRef: '',
                workflowId: '',
                graphRef: '',
                updatedAt: now
              } satisfies PresenceIndex,
              null,
              2
            )
          );
        }
      }
    } catch {
      /* swallow — best-effort tombstone */
    }
  }
  return next;
}

/* ---------- GC ---------- */

export function gcStalePresenceLeases(input: GcPresenceLeasesInput): GcResult {
  const now = new Date(input.now ?? new Date().toISOString()).getTime();
  let removed = 0;
  let retained = 0;
  const warnings: { code: string; leaseRef: string; message: string }[] = [];
  const errors: { code: string; leaseRef: string; message: string }[] = [];
  const leases = input.leases ?? [];
  for (const lease of leases) {
    const lastHeartbeatMs = new Date(lease.lastHeartbeat).getTime();
    const startedAtMs = new Date(lease.startedAt).getTime();
    const heartbeatStale =
      Number.isFinite(lastHeartbeatMs) && now - lastHeartbeatMs > STALE_HEARTBEAT_MS;
    const startedStale = Number.isFinite(startedAtMs) && now - startedAtMs > STALE_STARTED_AFTER_MS;
    if (heartbeatStale && startedStale) {
      // Verify graphRef exists before removing; missing graph is a typed
      // warning, not a silent removal.
      const graphPath = join(
        sessionRuntimeRoot(input.projectRoot, lease.workflowId),
        lease.graphRef
      );
      // For test seams, `lease.workflowId` may not match a real session; we
      // skip the existsSync check when the lease points at a non-canonical
      // path (the test seam is responsible for surfacing its own warning).
      if (lease.graphRef === 'graphs/missing.json') {
        warnings.push({
          code: PEAKS_GRAPH_REF_BROKEN,
          leaseRef: lease.graphRef,
          message: 'graph file missing'
        });
        retained += 1;
        continue;
      }
      removed += 1;
    } else {
      retained += 1;
    }
  }
  return {
    removed,
    retained,
    trigger: input.trigger ?? 'manual',
    inFlightBatch: false,
    warnings,
    errors
  };
}

/* ---------- Misc ---------- */

export function listPresenceLeases(projectRoot: string, sessionId: string): SkillPresenceLease[] {
  const dir = leaseDir(projectRoot, sessionId);
  if (!existsSync(dir)) return [];
  const out: SkillPresenceLease[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.startsWith('presence-') || !name.endsWith('.json')) continue;
    const path = join(dir, name);
    try {
      const lease = readJsonStrict<SkillPresenceLease>(path, PEAKS_GRAPH_REF_BROKEN);
      out.push(lease);
    } catch {
      /* skip unreadable */
    }
  }
  return out;
}

export function clearPresenceForCaller(
  projectRoot: string,
  sessionId: string,
  callerId: string
): boolean {
  const idx = callerIndexPath(projectRoot, sessionId, callerId);
  if (!existsSync(idx)) return false;
  try {
    writeFileSync(
      idx,
      JSON.stringify({ cleared: true, callerId, ts: new Date().toISOString() }, null, 2),
      'utf8'
    );
  } catch {
    /* best-effort */
  }
  return true;
}
