/**
 * Binding store — v2.16.0 multi-Claude-instance sentinel layer.
 *
 * Pre-v2.16.0 binding schema was a single-session record:
 *   { sessionId, createdAt, projectRoot }
 *
 * v2.16.0 schema is a multi-instance registry with conflict-detection
 * sentinel fields (ownerHint, pid, lastHeartbeat, instances Map).
 * See PRD `001-2026-06-29-v2-16-0-change-id-axis-removal` AC-8.
 *
 * The store keeps a one-shot migration from the legacy schema:
 * legacy single-session binding → v2.16.0 instances Map with one entry,
 * ownerHint sourced from env (PEAKS_OUTER_SESSION_ID fallback
 * CLAUDE_CODE_SESSION_ID fallback 'unknown').
 *
 * Each write produces an atomic writeFileSync — partial writes from
 * crashed processes are acceptable because re-read will re-validate
 * with the zod schema and either re-migrate or rebuild empty.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { copyFileSync, openSync, closeSync, constants as fsConstants } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';

export const InstanceRecordSchema = z.object({
  startedAt: z.string().datetime(),
  roles: z.array(z.string()).default([]),
  callerId: z.string().min(1),
  lastHeartbeat: z.string().datetime()
});

export const BindingSchema = z.object({
  ownerHint: z.string().min(1),
  pid: z.number().int().positive(),
  lastHeartbeat: z.string().datetime(),
  scope: z.string().min(1),
  instances: z.record(z.string(), InstanceRecordSchema)
});

export type InstanceRecord = z.infer<typeof InstanceRecordSchema>;
export type Binding = z.infer<typeof BindingSchema>;

const LEGACY_SESSION_FILE = '.session.json';
const CANONICAL_SESSION_FILE = join('_runtime', 'session.json');

function getCanonicalPath(projectRoot: string): string {
  return join(projectRoot, '.peaks', CANONICAL_SESSION_FILE);
}

function getLegacyPath(projectRoot: string): string {
  return join(projectRoot, '.peaks', LEGACY_SESSION_FILE);
}

function getCurrentOuterSessionId(): string {
  const peaks = process.env.PEAKS_OUTER_SESSION_ID;
  if (typeof peaks === 'string' && peaks.length > 0) return peaks;
  const claude = process.env.CLAUDE_CODE_SESSION_ID;
  if (typeof claude === 'string' && claude.length > 0) return claude;
  return 'unknown';
}

/**
 * Build the *real* caller identity for the current process.
 *
 * v2.18.0 P0 fix: `getCurrentOuterSessionId()` alone is not a
 * process-unique signal — two Claude Code windows on the same
 * host share the same `CLAUDE_CODE_SESSION_ID` (it is bound to
 * the IDE / app session, not the window), and a CI runner with
 * both env vars unset returns the literal `'unknown'` sentinel
 * for every process. Suffixing with `process.pid` makes the
 * callerId process-unique without changing the surface (no new
 * env var, no new schema field), preserving the AC-5 hard rule
 * that "one Claude instance keeps one sid across multiple
 * peaks-* skill activations" — a single process keeps a constant
 * pid across the whole run, including `/compact`.
 *
 * The `#` separator is safe here: `InstanceRecord.callerId` uses
 * `z.string().min(1)` (no regex), and the v2.16.0 binding schema
 * has no path-embedding constraint on callerId (unlike the
 * platform D1 `CALLER_ID_REGEX` which only applies to the CLI
 * surface in `caller-id-types.ts`).
 *
 * The resulting string is stored on `InstanceRecord.callerId`
 * AND on `Binding.ownerHint` (advisory metadata; kept for
 * back-compat reads of the v2.16.0 schema).
 */
function getCurrentCallerId(): string {
  const envSignal = getCurrentOuterSessionId();
  return `${envSignal}#${process.pid}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function backupCorruptFile(projectRoot: string): void {
  const canonical = getCanonicalPath(projectRoot);
  if (!existsSync(canonical)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `${canonical}.bak.${stamp}`;
  try {
    copyFileSync(canonical, backup);
  } catch (err) {
    // best-effort backup; do not block rebuild. Surface a warning so
    // silent-warning-detector does not flag this branch.
    process.stderr.write(`[binding-store] backup ${canonical} → ${backup} failed: ${String(err)}\n`);
  }
}

/**
 * Read the project-level binding.
 *
 * Returns null if no binding exists. Returns a migrated v2.16.0 binding
 * when legacy schema is detected (one-shot auto-migration; original
 * legacy file is NOT deleted — caller decides retention policy).
 *
 * On schema violation (corrupt JSON or missing required field), the file
 * is backed up as `<path>.bak.<ISO>` and null is returned. The next
 * write call will recreate the binding from scratch.
 */
export function readBinding(projectRoot: string): Binding | null {
  const canonical = getCanonicalPath(projectRoot);
  const legacy = getLegacyPath(projectRoot);
  const pathToRead = existsSync(canonical) ? canonical : existsSync(legacy) ? legacy : null;
  if (pathToRead === null) return null;

  let raw: string;
  try {
    raw = readFileSync(pathToRead, 'utf8');
  } catch (err) {
    // IO failure is indistinguishable from "no binding" to the caller;
    // log the cause for forensics and return null so ensureSession can
    // rebuild from scratch.
    process.stderr.write(`[binding-store] read ${pathToRead} failed: ${String(err)}\n`);
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    backupCorruptFile(projectRoot);
    return null;
  }

  // v2.16.0 schema hit.
  const validated = BindingSchema.safeParse(parsed);
  if (validated.success) {
    return validated.data;
  }

  // Legacy schema (single-session): auto-migrate to one-instance registry.
  const legacyShape = parsed as { sessionId?: unknown; createdAt?: unknown; projectRoot?: unknown };
  if (
    typeof legacyShape.sessionId === 'string' &&
    typeof legacyShape.createdAt === 'string' &&
    typeof legacyShape.projectRoot === 'string'
  ) {
    // Auto-migrate marks lastHeartbeat as `now` (not `createdAt`) so the
    // migrated instance does NOT immediately appear stale to AC-10.
    // Legacy bindings date from the pre-v2.16.0 single-session era;
    // their createdAt predates the binding sentinel concept entirely.
    const migratedAt = nowIso();
    const binding: Binding = {
      ownerHint: getCurrentCallerId(),
      pid: process.pid,
      lastHeartbeat: migratedAt,
      scope: legacyShape.projectRoot,
      instances: {
        [legacyShape.sessionId]: {
          startedAt: legacyShape.createdAt,
          roles: [],
          callerId: getCurrentCallerId(),
          lastHeartbeat: migratedAt
        }
      }
    };
    return binding;
  }

  // Unrecognised shape: back up and return null.
  backupCorruptFile(projectRoot);
  return null;
}

/**
 * Persist the binding atomically. Caller passes the full binding object;
 * the store does NOT merge — pass the result of `readBinding` (or
 * `withInstance`) and modify in place.
 */
export function writeBinding(projectRoot: string, binding: Binding): void {
  const canonical = getCanonicalPath(projectRoot);
  const dir = dirname(canonical);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const validated = BindingSchema.parse(binding);
  writeFileSync(canonical, JSON.stringify(validated, null, 2), 'utf8');
}

/**
 * Register a Claude instance by `callerId`. Idempotent: if an instance
 * with the given callerId already exists, refresh its `lastHeartbeat`
 * and return its sid. Otherwise pick the next free sid slot (creating
 * a new session id under `instances`) and return it.
 *
 * This is the D2 Claude-instance-level binding primitive — a single
 * Claude instance keeps one sid across multiple peaks-* skill
 * activations; binding.instances[<sid>].roles accumulates the skill
 * names (peaks-code → peaks-rd → peaks-qa in the same Claude run).
 *
 * The caller is responsible for actually creating the session dir via
 * `initWorkspace` and storing per-session meta via `setSessionMeta`.
 */
export function registerInstance(
  projectRoot: string,
  opts: { callerId: string; roles?: string[]; existingSid?: string }
): { binding: Binding; sid: string } {
  const existing = readBinding(projectRoot);
  // v2.18.0 P0 fix: an empty callerId now defaults to the
  // process-unique `getCurrentCallerId()` (env signal + pid),
  // NOT the bare `'unknown'` sentinel. This prevents two
  // no-callerId callers from sharing a sid via the sentinel
  // collision that v2.17.0 had.
  const callerId = opts.callerId.length > 0 ? opts.callerId : getCurrentCallerId();
  const roles = opts.roles ?? [];
  const now = nowIso();

  if (existing) {
    // Resume path: caller is an already-known instance.
    if (opts.existingSid) {
      const inst = existing.instances[opts.existingSid];
      if (inst) {
        const mergedRoles = Array.from(new Set([...inst.roles, ...roles]));
        const next: Binding = {
          ...existing,
          lastHeartbeat: now,
          instances: {
            ...existing.instances,
            [opts.existingSid]: { ...inst, roles: mergedRoles, lastHeartbeat: now }
          }
        };
        writeBinding(projectRoot, next);
        return { binding: next, sid: opts.existingSid };
      }
    }

    // Auto-resume: caller already has an instance in this scope —
    // append roles and refresh heartbeat instead of creating a new
    // sid. This is the AC-5 Claude-instance-level hard rule: a
    // single Claude caller keeps one sid across multiple peaks-*
    // skill activations.
    const existingSidForCaller = Object.entries(existing.instances).find(
      ([, inst]) => inst.callerId === callerId
    )?.[0];
    if (existingSidForCaller) {
      const inst = existing.instances[existingSidForCaller]!;
      const mergedRoles = Array.from(new Set([...inst.roles, ...roles]));
      const next: Binding = {
        ...existing,
        lastHeartbeat: now,
        instances: {
          ...existing.instances,
          [existingSidForCaller]: { ...inst, roles: mergedRoles, lastHeartbeat: now }
        }
      };
      writeBinding(projectRoot, next);
      return { binding: next, sid: existingSidForCaller };
    }

    // New caller joining an existing scope.
    const sid = generateSid();
    const next: Binding = {
      ...existing,
      lastHeartbeat: now,
      instances: {
        ...existing.instances,
        [sid]: {
          startedAt: now,
          roles,
          callerId,
          lastHeartbeat: now
        }
      }
    };
    writeBinding(projectRoot, next);
    return { binding: next, sid };
  }

  // First binding in this scope.
  const sid = opts.existingSid ?? generateSid();
  const binding: Binding = {
    ownerHint: callerId,
    pid: process.pid,
    lastHeartbeat: now,
    scope: projectRoot,
    instances: {
      [sid]: {
        startedAt: now,
        roles,
        callerId,
        lastHeartbeat: now
      }
    }
  };
  writeBinding(projectRoot, binding);
  return { binding, sid };
}

/**
 * Touch the `lastHeartbeat` for a specific instance. Used by the
 * Doctor periodic loop (AC-10) and by the Skill presence `startup`
 * gate.
 */
export function heartbeat(projectRoot: string, sid: string): Binding | null {
  const existing = readBinding(projectRoot);
  if (!existing) return null;
  const inst = existing.instances[sid];
  if (!inst) return null;
  const now = nowIso();
  const next: Binding = {
    ...existing,
    lastHeartbeat: now,
    instances: {
      ...existing.instances,
      [sid]: { ...inst, lastHeartbeat: now }
    }
  };
  writeBinding(projectRoot, next);
  return next;
}

/**
 * Drop an instance entry from the binding. Used when the last peaks-*
 * skill on a Claude instance exits (AC-7: all skills inactive →
 * no record). Returns the updated binding (or null if no instances
 * remain and the caller wants to delete the binding entirely).
 */
export function dropInstance(projectRoot: string, sid: string): Binding | null {
  const existing = readBinding(projectRoot);
  if (!existing) return null;
  if (!existing.instances[sid]) return existing;
  const { [sid]: _removed, ...rest } = existing.instances;
  void _removed;
  if (Object.keys(rest).length === 0) return null;
  const next: Binding = { ...existing, instances: rest, lastHeartbeat: nowIso() };
  writeBinding(projectRoot, next);
  return next;
}

/**
 * Drop stale instances (lastHeartbeat older than `ttlMs`). Returns
 * the list of dropped sid values so the caller can log them. Used
 * by AC-10 Doctor.
 */
export function dropStale(projectRoot: string, ttlMs: number): { binding: Binding | null; dropped: string[] } {
  const existing = readBinding(projectRoot);
  if (!existing) return { binding: null, dropped: [] };
  const cutoff = Date.now() - ttlMs;
  const dropped: string[] = [];
  const kept: Record<string, InstanceRecord> = {};
  for (const [sid, inst] of Object.entries(existing.instances)) {
    const t = Date.parse(inst.lastHeartbeat);
    if (Number.isFinite(t) && t < cutoff) {
      dropped.push(sid);
    } else {
      kept[sid] = inst;
    }
  }
  if (dropped.length === 0) return { binding: existing, dropped };
  if (Object.keys(kept).length === 0) return { binding: null, dropped };
  const next: Binding = { ...existing, instances: kept, lastHeartbeat: nowIso() };
  writeBinding(projectRoot, next);
  return { binding: next, dropped };
}

/**
 * Look up the active sid for a Claude caller. Returns null if this
 * caller has never registered or its instance was dropped.
 *
 * The caller is typically the outer-session-id (PEAKS_OUTER_SESSION_ID
 * with CLAUDE_CODE_SESSION_ID fallback) — same string used as
 * `ownerHint` and `callerId`.
 */
export function findSidByCaller(projectRoot: string, callerId: string): string | null {
  const existing = readBinding(projectRoot);
  if (!existing) return null;
  for (const [sid, inst] of Object.entries(existing.instances)) {
    if (inst.callerId === callerId) return sid;
  }
  return null;
}

function generateSid(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 8);
  return `${yyyy}-${mm}-${dd}-session-${rand}`;
}

// ---------------------------------------------------------------------------
// v2.18.2 — legacy v2.16.0 / v2.17.0 callerId migration
//
// The v2.18.0 P0 fix introduced `${envSignal}#${process.pid}` as the
// canonical callerId shape. Pre-v2.18.0 binding files stored callerIds
// WITHOUT the pid suffix (raw env signal, or the bare `'unknown'`
// sentinel). On read, `BindingSchema.safeParse` accepts the legacy
// shape (`callerId: z.string().min(1)` is permissive), so legacy
// bindings are still loadable — but `findSidByCaller` will not match
// the new pid-suffixed lookups, and `registerInstance` auto-resume will
// create a duplicate instance for the same Claude process.
//
// `rebuildBindingFromLegacy` rewrites the on-disk binding in-place so
// every existing instance gets the pid suffix. It is invoked explicitly
// by `peaks doctor --rebuild-binding` (slice 2026-06-29-v2-18-2
// PATCH scope, follow-up issue #1) rather than on-read, to keep the
// read path side-effect-free and to make the migration user-observable.
//
// The pid used for the suffix is the binding's stored `pid` field (the
// pid of the process that originally registered the instance), NOT
// `process.pid` — preserving the original instance identity across the
// rewrite. Instances with `callerId = 'unknown'` (CI fallback, no
// identity to preserve) are skipped and reported in `errors` so a
// future slice can decide what to do with them.
// ---------------------------------------------------------------------------

export type RebuildResult = {
  rewritten: number;
  preserved: number;
  errors: string[];
  /** True when no legacy entries were present and the file is unchanged. */
  noop: boolean;
};

function acquireRebuildLock(projectRoot: string): { fd: number; path: string } | null {
  const lockPath = join(projectRoot, '.peaks', '_runtime', '.rebuild-binding.lock');
  const dir = dirname(lockPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  try {
    // O_EXCL (`wx` in Node): atomic create-or-fail. If the lock file
    // already exists, another `rebuildBindingFromLegacy` invocation
    // holds it. The holder is expected to release it via
    // `closeSync` + `unlinkSync` (see `releaseRebuildLock`).
    const fd = openSync(lockPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL);
    return { fd, path: lockPath };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') return null;
    throw err;
  }
}

function releaseRebuildLock(lock: { fd: number; path: string } | null): void {
  if (lock === null) return;
  try {
    closeSync(lock.fd);
  } catch (err) {
    // best-effort close; surface to stderr so silent-warning-detector
    // does not flag the empty-catch. The next acquireRebuildLock will
    // still detect the stale lock via EEXIST and treat it as held,
    // which is the safer default.
    process.stderr.write(`[binding-store] close rebuild lock ${lock.path} failed: ${String(err)}\n`);
  }
  try {
    // unlinkSync is best-effort; a stale lock will be detected by
    // existsSync on the next acquire and treated as a held lock
    // (returning null), which is the safer default.
    unlinkSync(lock.path);
  } catch (err) {
    process.stderr.write(`[binding-store] unlink rebuild lock ${lock.path} failed: ${String(err)}\n`);
  }
}

export function rebuildBindingFromLegacy(projectRoot: string): RebuildResult {
  const lock = acquireRebuildLock(projectRoot);
  if (lock === null) {
    return {
      rewritten: 0,
      preserved: 0,
      errors: ['another peaks doctor --rebuild-binding is in progress (lock held)'],
      noop: true
    };
  }
  try {
    const binding = readBinding(projectRoot);
    if (binding === null) {
      // No binding to rebuild — idempotent no-op.
      return { rewritten: 0, preserved: 0, errors: [], noop: true };
    }

    const errors: string[] = [];
    let rewritten = 0;
    let preserved = 0;
    const nextInstances: Record<string, InstanceRecord> = {};

    for (const [sid, inst] of Object.entries(binding.instances)) {
      if (inst.callerId.includes('#')) {
        // Already in the v2.18.0+ shape — keep as-is.
        nextInstances[sid] = inst;
        preserved += 1;
        continue;
      }
      if (inst.callerId === 'unknown') {
        // No identity to preserve — keep the instance as-is and
        // report. Re-encoding `unknown#${pid}` would be a
        // misleading claim about process-uniqueness (any two no-env
        // processes share the `unknown` signal). Counts as
        // `preserved` because the entry is unchanged on disk.
        nextInstances[sid] = inst;
        preserved += 1;
        errors.push(`sid ${sid}: callerId="unknown" has no pid suffix source — skipped`);
        continue;
      }
      nextInstances[sid] = { ...inst, callerId: `${inst.callerId}#${binding.pid}` };
      rewritten += 1;
    }

    if (rewritten === 0) {
      return { rewritten: 0, preserved, errors, noop: true };
    }

    const next: Binding = {
      ...binding,
      // Refresh ownerHint to the canonical v2.18.0+ shape so the
      // advisory metadata is consistent with the rewritten instances.
      ownerHint: binding.ownerHint.includes('#')
        ? binding.ownerHint
        : `${binding.ownerHint}#${binding.pid}`,
      lastHeartbeat: nowIso(),
      instances: nextInstances
    };

    // Atomic write: temp + rename, so a crash mid-write cannot leave
    // a partial binding on disk.
    const canonical = getCanonicalPath(projectRoot);
    const dir = dirname(canonical);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmpPath = `${canonical}.tmp.${process.pid}`;
    const validated = BindingSchema.parse(next);
    writeFileSync(tmpPath, JSON.stringify(validated, null, 2), 'utf8');
    try {
      renameSync(tmpPath, canonical);
    } catch (renameErr) {
      // Clean up the tmp file and surface the rename error.
      try {
        unlinkSync(tmpPath);
      } catch (cleanupErr) {
        process.stderr.write(`[binding-store] cleanup tmp ${tmpPath} after rename failure failed: ${String(cleanupErr)}\n`);
      }
      throw renameErr;
    }
    return { rewritten, preserved, errors, noop: false };
  } finally {
    releaseRebuildLock(lock);
  }
}