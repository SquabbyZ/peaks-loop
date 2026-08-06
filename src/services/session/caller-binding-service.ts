/**
 * Caller-Binding Service (slice 020 — caller-keyed session binding).
 *
 * Each caller has its own on-disk binding file at
 * `.peaks/_runtime/callers/<callerId>.json`. This service is the
 * single read/write surface for that file. Legacy single-file bindings
 * (`.peaks/_runtime/session.json` and `.peaks/.session.json`) remain
 * readable for one minor release (M1 / M4); the read path falls back
 * to them with a `legacy-fallback-used: true` flag.
 *
 * M2: legacy bindings resolve into a synthetic callerId of the form
 * `legacy-<8hex-of-sha256(outerSessionId)>`, with `claudeSessionId`
 * and `projectRoot` as fallback hash inputs. The synthetic id is
 * permanent and recognisable by the `legacy-` prefix.
 *
 * See `.peaks/_runtime/2026-06-09-session-8bfe7d/prd/source/caller-id-contract.md`
 * for the freeze-in contract.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { atomicWriteJson } from '../ide/shared/atomic-json.js';
import { CALLER_ID_REGEX, type CallerBinding } from './caller-id-types.js';
import { getSessionDir } from './getSessionDir.js';

/**
 * On-disk location of the per-caller binding file. P4 invariant:
 * the `callers/<callerId>.json` lives at `.peaks/_runtime/callers/`,
 * the same root as the per-peak session dirs.
 */
export function getCallerBindingFile(projectRoot: string, callerId: string): string {
  if (!CALLER_ID_REGEX.test(callerId)) {
    // Defensive: a malformed callerId should never make it to disk.
    // The caller is expected to validate via `resolveCallerId` first.
    throw new Error(`getCallerBindingFile: invalid callerId "${callerId}"`);
  }
  return join(projectRoot, '.peaks', '_runtime', 'callers', `${callerId}.json`);
}

/**
 * On-disk location of the per-(peak, caller) active-skill file. D6:
 * one file per (peakSessionId, callerId) pair; two callers bound to
 * the same peak session never clobber each other.
 */
export function getActiveSkillFileForCaller(
  projectRoot: string,
  peakSessionId: string,
  callerId: string
): string {
  if (!CALLER_ID_REGEX.test(callerId)) {
    throw new Error(`getActiveSkillFileForCaller: invalid callerId "${callerId}"`);
  }
  return join(getSessionDir(projectRoot, peakSessionId), `active-skill-${callerId}.json`);
}

/**
 * Resolve a stable, deterministic callerId for a legacy single-file
 * binding (M2). The hash input priority is:
 *
 *   1. `outerSessionId` (slice 018 stamped this on the per-peak
 *      session.json for sessions created after the slice shipped).
 *   2. `claudeSessionId` (legacy field name on pre-018 presence
 *      files; honour the read side so v1.2.x data does not lose its
 *      binding).
 *   3. `projectRoot` (truly anonymous case: pre-018 sessions that
 *      never recorded an outer / claude id).
 *
 * The synthetic id is `legacy-<first 8 hex chars of sha256(input)>`.
 * 32 bits of entropy is enough for typical on-disk state
 * (R1: <100 legacy peak sessions per project; the test asserts
 * uniqueness across 1000 synthetic ids).
 */
export function synthesiseLegacyCallerId(input: string): string {
  const hash = createHash('sha256').update(input, 'utf8').digest('hex').slice(0, 8);
  return `legacy-${hash}`;
}

/**
 * Read a per-caller binding file. Returns `null` if the file does
 * not exist, is malformed, or is for a different project (M1 back-compat
 * read returns the legacy file but only after the per-caller file is
 * absent).
 */
export function getCallerBinding(projectRoot: string, callerId: string): CallerBinding | null {
  const bindingPath = getCallerBindingFile(projectRoot, callerId);
  if (!existsSync(bindingPath)) {
    return null;
  }
  try {
    const raw = readFileSync(bindingPath, 'utf8');
    const parsed = JSON.parse(raw) as CallerBinding;
    if (typeof parsed.callerId !== 'string' || parsed.callerId !== callerId) {
      return null;
    }
    if (typeof parsed.peakSessionId !== 'string' || parsed.peakSessionId.length === 0) {
      return null;
    }
    if (typeof parsed.projectRoot !== 'string' || parsed.projectRoot.length === 0) {
      return null;
    }
    return parsed;
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}

/**
 * Write or update a per-caller binding file. The caller is responsible
 * for the binding object (callerId must match the file stem, peakSessionId
 * must be a valid session id, projectRoot is canonicalized). Idempotent:
 * re-writing the same callerId overwrites the file.
 *
 * Slice 2026-08-06-session-cacde8-A.5b: writes via `atomicWriteJson`
 * (temp-file-then-rename) so a power-loss mid-write cannot leave the
 * caller-binding file in a half-truncated state. `atomicWriteJson`
 * owns its own `mkdirSync(dir, { recursive: true })`, so the inline
 * mkdir block is removed. The previous `writeFileSync` path was a
 * documented 4.0.14 carry-forward micro-fix from QA's issue #1.
 */
export function setCallerBinding(
  projectRoot: string,
  callerId: string,
  binding: CallerBinding
): void {
  if (binding.callerId !== callerId) {
    throw new Error(
      `setCallerBinding: binding.callerId "${binding.callerId}" does not match callerId "${callerId}"`
    );
  }
  const bindingPath = getCallerBindingFile(projectRoot, callerId);
  const payload: CallerBinding = {
    ...binding,
    projectRoot: resolve(binding.projectRoot)
  };
  atomicWriteJson(bindingPath, payload);
}

/**
 * Enumerate the per-caller binding files under
 * `.peaks/_runtime/callers/`. Returns the parsed bindings plus the
 * raw filenames (so callers can list orphan / legacy files without
 * re-reading).
 */
export function listCallerBindings(projectRoot: string): CallerBinding[] {
  const dir = join(projectRoot, '.peaks', '_runtime', 'callers');
  if (!existsSync(dir)) return [];
  let names: string[];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    names = entries.filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => e.name);
  } catch {
    return [];
  }
  const out: CallerBinding[] = [];
  for (const name of names) {
    const callerId = name.replace(/\.json$/, '');
    if (!CALLER_ID_REGEX.test(callerId)) continue;
    const binding = getCallerBinding(projectRoot, callerId);
    if (binding !== null) {
      out.push(binding);
    }
  }
  return out;
}

/**
 * Slice 4.0.8 (RD §6 migration): on a `presence:set` sweep, the
 * legacy per-caller `active-skill-<callerId>.json` files are
 * migrated into the canonical `presence-index/<callerId>.json` +
 * `leases/presence-<caller>-<workflow>.json` layout. This function
 * is invoked by `reconcileWorkspace` during the migration window;
 * the canonical `setPresenceLease` is the new write path so
 * post-migration `presence:set` calls route through the lease
 * service directly. The legacy on-disk shape is preserved here as
 * a read-only input (it remains the source of truth for pre-4.0.8
 * callers that haven't migrated yet).
 */
export function reconcileLegacyCallerPresence(input: {
  projectRoot: string;
  callerId: string;
  peakSessionId: string;
}): { migrated: boolean; reason: 'already-canonical' | 'missing-legacy' | 'success' | 'io-error'; error?: string } {
  const legacyPath = getActiveSkillFileForCaller(input.projectRoot, input.peakSessionId, input.callerId);
  if (!existsSync(legacyPath)) {
    return { migrated: false, reason: 'missing-legacy' };
  }
  // The canonical index lives at `<sessionDir>/presence-index/<callerId>.json`;
  // a successful `setPresenceLease` would have written it already. We don't
  // auto-write here (the canonical write path is the lease service); this
  // function only reports the migration status. The caller decides whether
  // to write the canonical record (via `setPresenceLease`) or to leave the
  // legacy file in place.
  try {
    const raw = readFileSync(legacyPath, 'utf8');
    const parsed = JSON.parse(raw) as { skill?: unknown; mode?: unknown; gate?: unknown };
    if (typeof parsed.skill !== 'string') {
      return { migrated: false, reason: 'io-error', error: 'legacy file malformed' };
    }
    return { migrated: true, reason: 'success' };
  } catch (err) {
    return { migrated: false, reason: 'io-error', error: (err as Error).message };
  }
}
