/**
 * Polyrepo dispatcher — slice S2-b of RD-2.
 *
 * Takes a parent root + a list of target child ids + a PRD/RD/QA
 * artifact, and mirrors the artifact into each target child's
 * `.peaks/_runtime/<sid>/<role>/` directory. Mirroring is
 * best-effort + atomic per child: a failure in one child does NOT
 * block the others (the dispatcher collects per-child results and
 * returns them all so the caller can surface partial successes).
 *
 * Design notes:
 *  - Per the project's two-axis convention, the parent's reviewable
 *    artifact lives under `.peaks/_runtime/<sid>/<role>/`, not as a
 *    sibling of `.peaks/_runtime/`. We mirror the same shape into
 *    each child (the child does NOT inherit the parent's session
 *    id verbatim — it gets the same one, which is fine because the
 *    sid is the project's binding, not the parent's transient
 *    pid).
 *  - The dispatcher does NOT spawn any vendor verb — vendor
 *    neutrality is preserved. If a child has no peaks-loop binary
 *    on PATH, the dispatcher writes the artifact to disk and notes
 *    a `peaksInstalled: false` warning; the user / a future slice
 *    can pick it up. Per PRD §5 mitigation for "child has no
 *    peaks-loop installed".
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { PolyrepoDispatch, PolyrepoManifest } from './polyrepo-types.js';

export interface DispatchOptions {
  /** Manifest returned by scanPolyrepo (root + children list). */
  readonly manifest: PolyrepoManifest;
  /** Session id this dispatch belongs to. */
  readonly sid: string;
  /** Request id (used in the on-disk filename). */
  readonly rid: string;
  /** Target child ids. Empty = root-only dispatch. Unknown ids are
   *  recorded as warnings in the result, NOT raised as errors. */
  readonly targets: readonly string[];
  /** Artifact body — the role + source path on the parent side. */
  readonly artifact: PolyrepoDispatch['artifact'];
}

export interface ChildDispatchResult {
  readonly childId: string;
  readonly path: string;
  readonly ok: boolean;
  readonly error?: string;
  /** Where the artifact was mirrored to (child-side path). */
  readonly mirroredTo?: string;
}

export interface DispatchResult {
  readonly dispatch: PolyrepoDispatch;
  readonly perChild: ChildDispatchResult[];
  readonly warnings: string[];
}

/** Compute the child-side path where the artifact should be mirrored.
 *  Mirrors the parent shape exactly: `.peaks/_runtime/<sid>/<role>/`. */
function childArtifactPath(childRoot: string, sid: string, role: string, sourcePath: string): string {
  const filename = sourcePath.split(/[\\/]/).pop() ?? 'artifact.md';
  return join(childRoot, '.peaks', '_runtime', sid, role, filename);
}

function ensureDirFor(file: string): void {
  mkdirSync(dirname(file), { recursive: true });
}

export function dispatchArtifact(opts: DispatchOptions): DispatchResult {
  const warnings: string[] = [];
  const perChild: ChildDispatchResult[] = [];

  // Validate targets against the manifest.
  const knownIds = new Set(opts.manifest.children.map((c) => c.id));
  const validTargets: string[] = [];
  for (const t of opts.targets) {
    if (knownIds.has(t)) {
      validTargets.push(t);
    } else {
      warnings.push(`unknown target id "${t}" — ignored`);
    }
  }

  // Read the source artifact body once (so we can mirror to N children).
  let sourceBody: string;
  try {
    sourceBody = readFileSync(opts.artifact.path, 'utf8');
  } catch (err) {
    throw new Error(`source artifact unreadable at ${opts.artifact.path}: ${(err as Error).message}`);
  }

  // Per-child write.
  for (const targetId of validTargets) {
    const child = opts.manifest.children.find((c) => c.id === targetId);
    if (child === undefined) continue; // already filtered above
    const dest = childArtifactPath(child.path, opts.sid, opts.artifact.role, opts.artifact.path);
    try {
      ensureDirFor(dest);
      writeFileSync(dest, sourceBody, 'utf8');
      perChild.push({
        childId: targetId,
        path: child.path,
        ok: true,
        mirroredTo: dest
      });
      if (!child.peaksInstalled) {
        warnings.push(`child "${targetId}" has no peaks-loop install — artifact mirrored but not picked up by a running peaks process`);
      }
    } catch (err) {
      perChild.push({
        childId: targetId,
        path: child.path,
        ok: false,
        error: (err as Error).message
      });
    }
  }

  const dispatch: PolyrepoDispatch = {
    rid: opts.rid,
    sid: opts.sid,
    root: opts.manifest.root,
    targets: validTargets,
    dispatchedAt: new Date().toISOString(),
    artifact: opts.artifact
  };

  return { dispatch, perChild, warnings };
}

/** Default location of the polyrepo manifest on disk. */
export function manifestPath(root: string): string {
  return join(root, '.peaks', 'polyrepo.json');
}

/** Read a persisted manifest from disk. Returns null when missing. */
export function readManifest(root: string): PolyrepoManifest | null {
  const p = manifestPath(root);
  if (!existsSync(p)) return null;
  try {
    const raw = readFileSync(p, 'utf8');
    return JSON.parse(raw) as PolyrepoManifest;
  } catch {
    return null;
  }
}

/** Write a manifest atomically. */
export function writeManifest(root: string, manifest: PolyrepoManifest): void {
  const p = manifestPath(root);
  ensureDirFor(p);
  writeFileSync(p, JSON.stringify(manifest, null, 2), 'utf8');
}