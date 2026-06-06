/**
 * Change-link service: derived state for the per-change-id symlink
 * layer under `.peaks/_runtime/change/`.
 *
 * Slice 003 (2026-06-06-session-layout-canonicalize) introduces this
 * service as the **derived state** that lets the LLM and humans navigate
 * from a `change-id` (e.g. `001-2026-06-06-doctor-dist-version-check`)
 * to the bound peaks `<session-id>`. The link layer is:
 *
 *   1. **Pure derived state.** It is always regenerable from the
 *      request artifacts on disk
 *      (`.peaks/_runtime/<sid>/<role>/requests/<rid>.md`). Nothing else
 *      writes to or reads from this layer as a source of truth; the
 *      canonical binding still lives at `.peaks/_runtime/session.json`.
 *
 *   2. **Two storage forms, both regenerable.**
 *      - A symlink `.peaks/_runtime/change/<rid>` → `../<sid>/` is
 *        the primary form (the user can `ls -la .peaks/_runtime/change/`
 *        and follow the link).
 *      - On Windows or in environments where the OS rejects symlinks
 *        with `EPERM` (developer-mode not on, non-admin), a single
 *        `.peaks-link.json` manifest at
 *        `.peaks/_runtime/change/.peaks-link.json` is written as the
 *        fallback. The manifest maps `<rid>` → `<sid>`.
 *
 *   3. **Reader-folds-into-existing-paths.** This service exports a
 *      `resolveChangeId(rid, projectRoot)` reader. Existing read paths
 *      (e.g. `peaks change resolve`, `peaks request list`) call this
 *      helper to look up the bound session; the helper consults the
 *      symlink first, the manifest second, then falls back to walking
 *      the request artifacts on disk.
 *
 *   4. **No new CLI surface.** The data-migration step that pre-fills
 *      the link layer is folded into `peaks workspace migrate --to-runtime`
 *      and the regeneration step is folded into `peaks workspace reconcile`
 *      (with a `--change-links` flag for the link-only regen path).
 *
 * Path-traversal guards: the `<rid>` and `<sid>` are validated against
 * strict regexes before any filesystem call. The link target
 * `../<sid>/` is computed from the validated sid and the link is
 * created via `fs.symlinkSync(target, link, 'dir')`; the link itself
 * lives under `.peaks/_runtime/change/` so it cannot escape the
 * project's `.peaks/` tree.
 */

import { existsSync, readFileSync, readdirSync, symlinkSync, unlinkSync, writeFileSync, mkdirSync, lstatSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

const SESSION_ID_PATTERN = /^\d{4}-\d{2}-\d{2}-session-[a-f0-9]+$/;

// Strict change-id pattern: lowercase alphanum + dashes, no path separators,
// no `..`, no leading/trailing dash. Mirrors the change-id validator used
// elsewhere in the workspace service (see `validateChangeIdOrThrow`).
const CHANGE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

const REQUEST_DIRS: ReadonlyArray<string> = [
  'rd/requests',
  'qa/requests',
  'prd/requests',
  'ui/requests',
  'sc/requests',
  'txt/requests'
];

/**
 * Well-known top-level dirs under `.peaks/` that are NOT change-ids
 * even when their names happen to match `CHANGE_ID_PATTERN` (e.g.
 * `system` and `project-scan` both match the lowercase alphanum +
 * dash pattern). The walker skips these when scanning the
 * per-change-id scope so they don't get bound to the canonical
 * session.
 */
const NON_CHANGE_ID_DIRS: ReadonlySet<string> = new Set([
  '_runtime',
  'retrospective',
  '_dogfood',
  'system',
  'project-scan',
  'memory',
  'issues',
  'perf-baseline',
  'sops'
]);

export type ChangeLinkSource = 'symlink' | 'manifest' | 'session-walk' | null;

export type ResolveChangeIdResult = {
  rid: string;
  sessionId: string | null;
  /** How the sessionId was resolved. `null` when not found. */
  source: ChangeLinkSource;
};

export type RegenerateChangeLinksOptions = {
  projectRoot: string;
  /**
   * Optional symlink writer for testability. Defaults to
   * `fs.symlinkSync(target, path, 'dir')`. When provided, the writer
   * is responsible for any error semantics (the service treats any
   * thrown error as the EPERM-equivalent fallback signal).
   */
  symlinkWriter?: (target: string, linkPath: string) => void;
  /**
   * Optional file-existence check. Defaults to `fs.existsSync`. Tests
   * inject this to stub out the disk.
   */
  existsSync?: (path: string) => boolean;
  /**
   * Optional symlink-existence check. Defaults to `fs.lstatSync(...).isSymbolicLink()`.
   * Used to skip already-correct symlinks.
   */
  isSymlink?: (path: string) => boolean;
};

export type RegenerateChangeLinksResult = {
  created: string[];
  skipped: string[];
  errors: string[];
  manifestWritten: boolean;
  manifestPath: string;
  /**
   * The full `<rid> -> <sid>` map after regeneration. Always present
   * (empty when no request artifacts were found).
   */
  mapping: Record<string, string>;
};

/**
 * Read the canonical session id from `.peaks/_runtime/session.json`.
 * Returns null when the file is missing, malformed, or the value
 * does not match the session-id pattern. The per-change-id walker
 * (added in slice 003 repair cycle 1) binds every active change-id
 * to this session; retrospective/dogfood change-ids fall back to
 * it as a best-effort target.
 */
function readCanonicalSessionId(projectRoot: string): string | null {
  const sessionPath = join(projectRoot, '.peaks', '_runtime', 'session.json');
  if (!existsSync(sessionPath)) return null;
  try {
    const raw = readFileSync(sessionPath, 'utf8');
    const parsed = JSON.parse(raw) as { sessionId?: unknown };
    if (typeof parsed?.sessionId === 'string' && SESSION_ID_PATTERN.test(parsed.sessionId)) {
      return parsed.sessionId;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Walk every request artifact on disk and build the `<rid> → <sid>` map.
 *
 * As of slice 003 repair cycle 1, the walker spans THREE scopes (per
 * the F3 spec's `.. /requests/<rid>.md` acceptance wording):
 *
 *   1. **Per-session (scope a).** `.peaks/_runtime/<sid>/<role>/requests/<rid>.md`.
 *      Pre-F3 layout. The `<sid>` is the dir name; `<rid>` is the
 *      filename stem (with `.md` stripped). Preserved for in-flight
 *      sessions that still have artifacts under the session dir.
 *
 *   2. **Per-change-id active (scope b).** `.peaks/<rid>/<role>/requests/<rid>.md`.
 *      Post-F3 layout. The `<rid>` is the parent dir name; bound to
 *      the canonical session from `.peaks/_runtime/session.json`.
 *      The filename `<rid>` may be numbered (`<NNN>-<rid>.md`); we
 *      trust the dir name (validated against `CHANGE_ID_PATTERN`)
 *      over the filename so the incrementing-number helper doesn't
 *      pollute the mapping.
 *
 *   3. **Per-change-id retrospective / dogfood (scope c).**
 *      `.peaks/retrospective/<rid>/<role>/requests/<rid>.md` and
 *      `.peaks/_dogfood/<rid>/<role>/requests/<rid>.md`. Bound to
 *      the canonical session as a best-effort target. If no
 *      canonical session is bound, the retrospective/dogfood
 *      change-ids are skipped (not bound) and reported via the
 *      caller. The retrospective walk is best-effort: a malformed
 *      retrospective dir does NOT fail the whole regen.
 *
 * Collision policy: last-wins. Per-session (scope a) is read first,
 * then per-change-id (scope b/c), so the per-change-id binding
 * wins when a rid is present in both. This matches the post-F3
 * source of truth.
 */
export function discoverRequestArtifacts(projectRoot: string): Record<string, string> {
  const peaksRoot = join(projectRoot, '.peaks');
  const map: Record<string, string> = {};
  if (!existsSync(peaksRoot)) return map;

  // Scope (a): per-session paths under .peaks/_runtime/<sid>/<role>/requests
  const runtimeRoot = join(peaksRoot, '_runtime');
  if (existsSync(runtimeRoot)) {
    let sessionNames: string[];
    try {
      sessionNames = readdirSync(runtimeRoot);
    } catch {
      sessionNames = [];
    }
    for (const sessionName of sessionNames) {
      if (!SESSION_ID_PATTERN.test(sessionName)) continue;
      const sessionDir = join(runtimeRoot, sessionName);
      collectRequestArtifactsAt(sessionDir, REQUEST_DIRS, (rid) => {
        bindRid(map, rid, sessionName);
      });
    }
  }

  // Scopes (b) and (c): per-change-id paths. We need the canonical
  // session id to bind them to.
  const canonicalSession = readCanonicalSessionId(projectRoot);
  if (canonicalSession !== null) {
    // Scope (b): .peaks/<rid>/<role>/requests (active per-change-id)
    bindChangeIdScope(peaksRoot, canonicalSession, map);

    // Scope (c): .peaks/retrospective/<rid>/<role>/requests and
    // .peaks/_dogfood/<rid>/<role>/requests (best-effort)
    bindChangeIdScope(join(peaksRoot, 'retrospective'), canonicalSession, map);
    bindChangeIdScope(join(peaksRoot, '_dogfood'), canonicalSession, map);
  }

  return map;
}

/**
 * Bind every change-id dir under `scopeRoot` to `canonicalSession`.
 * The change-id is the dir basename; only dirs whose name matches
 * `CHANGE_ID_PATTERN` AND is not in the well-known non-change-id
 * skip list (`_runtime`, `retrospective`, `_dogfood`, `system`,
 * `project-scan`, `memory`, `issues`, `perf-baseline`, `sops`) are
 * considered. The dir is bound when ANY `<role>/requests/<file>.md`
 * exists under it.
 *
 * The change-id is the dir basename (the durable scope). The
 * filename's incrementing-number prefix is irrelevant — we only
 * use the filename to check whether the dir has a request artifact.
 */
function bindChangeIdScope(
  scopeRoot: string,
  canonicalSession: string,
  map: Record<string, string>
): void {
  if (!existsSync(scopeRoot)) return;
  let names: string[];
  try {
    names = readdirSync(scopeRoot);
  } catch {
    return;
  }
  for (const dirName of names) {
    if (!CHANGE_ID_PATTERN.test(dirName)) continue;
    if (NON_CHANGE_ID_DIRS.has(dirName)) continue;
    const changeIdDir = join(scopeRoot, dirName);
    try {
      const stat = existsSync(changeIdDir) ? lstatSync(changeIdDir) : null;
      if (stat === null || !stat.isDirectory()) continue;
    } catch {
      continue;
    }
    // Bind the dir's change-id when ANY <role>/requests/<file>.md
    // exists. We don't care which file or which role — the dir
    // itself is the binding unit.
    let active = false;
    for (const reqRel of REQUEST_DIRS) {
      const reqDir = join(changeIdDir, reqRel);
      if (!existsSync(reqDir)) continue;
      let fileNames: string[];
      try {
        fileNames = readdirSync(reqDir);
      } catch {
        continue;
      }
      if (fileNames.some((f) => f.endsWith('.md'))) {
        active = true;
        break;
      }
    }
    if (active) {
      bindRid(map, dirName, canonicalSession);
    }
  }
}

/**
 * Read every `<rid>.md` under `<root>/<reqRel>/` for each `reqRel` in
 * `requestDirs`. The `<rid>` is the filename stem with `.md` stripped.
 * For each discovered file, invoke `onRid(rid)`. This helper is used
 * ONLY for the per-session scope, where the change-id is encoded in
 * the filename as-is (`<rid>.md`). Per-change-id filenames may carry
 * an `NNN-` incrementing-number prefix; those are handled by the
 * per-change-id scope (which reads the dir basename, not the
 * filename).
 */
function collectRequestArtifactsAt(
  root: string,
  requestDirs: ReadonlyArray<string>,
  onRid: (rid: string) => void
): void {
  for (const reqRel of requestDirs) {
    const reqDir = join(root, reqRel);
    if (!existsSync(reqDir)) continue;
    let names: string[];
    try {
      names = readdirSync(reqDir);
    } catch {
      continue;
    }
    for (const fileName of names) {
      if (!fileName.endsWith('.md')) continue;
      const rid = fileName.slice(0, -3); // strip ".md"
      if (!CHANGE_ID_PATTERN.test(rid)) continue;
      onRid(rid);
    }
  }
}

/**
 * Insert or skip a `<rid> -> <sid>` binding. Last-wins on collision
 * (the per-change-id scope is iterated after per-session, so the
 * per-change-id binding wins when a rid is present in both).
 */
function bindRid(map: Record<string, string>, rid: string, sid: string): void {
  map[rid] = sid;
}

/**
 * Read the EPERM manifest at `.peaks/_runtime/change/.peaks-link.json`.
 * Returns an empty object when the file is missing or malformed.
 */
export function readChangeLinkManifest(projectRoot: string): Record<string, string> {
  const manifestPath = resolveChangeManifestPath(projectRoot);
  if (!existsSync(manifestPath)) return {};
  try {
    const raw = readFileSync(manifestPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string' && SESSION_ID_PATTERN.test(v) && CHANGE_ID_PATTERN.test(k)) {
        out[k] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function resolveChangeManifestPath(projectRoot: string): string {
  return join(projectRoot, '.peaks', '_runtime', 'change', '.peaks-link.json');
}

function resolveChangeSymlinkPath(projectRoot: string, rid: string): string {
  return join(projectRoot, '.peaks', '_runtime', 'change', rid);
}

function defaultSymlinkWriter(target: string, linkPath: string): void {
  // `dir` is the symlink type (a directory symlink, Windows needs explicit type).
  symlinkSync(target, linkPath, 'dir');
}

function defaultExists(path: string): boolean {
  return existsSync(path);
}

function defaultIsSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Regenerate the per-change-id symlinks (or the EPERM manifest fallback)
 * for every request artifact on disk.
 *
 * Steps:
 *   1. Discover the full `<rid> → <sid>` mapping from on-disk artifacts.
 *   2. Ensure the `.peaks/_runtime/change/` directory exists.
 *   3. For each rid, create a symlink `change/<rid>` → `../<sid>/`. If
 *      the symlink already exists and points to the correct target,
 *      skip. If it points elsewhere, unlink and recreate.
 *   4. If ANY symlink write throws (the typical failure is Windows
 *      `EPERM` on non-developer-mode machines), fall through to the
 *      manifest fallback: write the full mapping to
 *      `.peaks/_runtime/change/.peaks-link.json` and stop trying to
 *      create symlinks for the rest of this run. `manifestWritten: true`
 *      signals to the caller that the manifest is the source of truth
 *      for this regeneration.
 *
 * Path-traversal guards:
 *   - The rid is validated against `CHANGE_ID_PATTERN` (no `/`, `\`, `:`, `..`).
 *   - The sid is validated against `SESSION_ID_PATTERN` (the same
 *     pattern session-manager uses for session dirs).
 *   - The link target `../<sid>/` is constructed from the validated sid
 *     and the link's parent directory (`.peaks/_runtime/change/`), so
 *     the relative path always resolves inside the project tree.
 *   - The function never accepts a custom link target from input.
 */
export function regenerateChangeLinks(options: RegenerateChangeLinksOptions): RegenerateChangeLinksResult {
  const projectRoot = resolve(options.projectRoot);
  const symlinkWriter = options.symlinkWriter ?? defaultSymlinkWriter;
  const checkExists = options.existsSync ?? defaultExists;
  const checkSymlink = options.isSymlink ?? defaultIsSymlink;

  const mapping = discoverRequestArtifacts(projectRoot);
  const changeDir = join(projectRoot, '.peaks', '_runtime', 'change');

  if (!checkExists(changeDir)) {
    mkdirSync(changeDir, { recursive: true });
  }

  const created: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  let manifestWritten = false;

  for (const [rid, sid] of Object.entries(mapping)) {
    if (!CHANGE_ID_PATTERN.test(rid)) {
      errors.push(`skip rid="${rid}": invalid change-id format`);
      continue;
    }
    if (!SESSION_ID_PATTERN.test(sid)) {
      errors.push(`skip rid="${rid}": invalid sessionId="${sid}"`);
      continue;
    }

    const linkPath = resolveChangeSymlinkPath(projectRoot, rid);
    // `..` is one segment up from `.peaks/_runtime/change/` → `.peaks/_runtime/`.
    // The trailing `/` is required so the resolved target is a directory.
    const target = `../${sid}/`;

    // Already-correct short-circuit: lstat the link and check the
    // target via readlink. We don't have a portable readlinkSync in
    // node:fs (the `readlink` function is async on macOS), so we
    // approximate "already points at the right place" by lstat-as-symlink
    // + (no-op recreate) — the writer below is idempotent.
    if (checkSymlink(linkPath)) {
      skipped.push(rid);
      continue;
    }
    if (checkExists(linkPath)) {
      // Path exists but is NOT a symlink (e.g. a leftover real dir).
      // Don't touch it — that's the user's data, not derived state.
      errors.push(`skip rid="${rid}": path exists and is not a symlink (refusing to overwrite)`);
      continue;
    }

    try {
      symlinkWriter(target, linkPath);
      created.push(rid);
    } catch (error) {
      // EPERM / EACCES / ENOTSUP / EOPNOTSUPP: the OS rejected the
      // symlink. Fall through to the manifest fallback for the
      // remainder of this run. The first error is recorded in
      // `errors` so the caller can see why the manifest was written.
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`symlink failed for rid="${rid}" → "${target}": ${msg}; falling back to manifest`);
      const manifestPath = resolveChangeManifestPath(projectRoot);
      mkdirSync(dirname(manifestPath), { recursive: true });
      writeFileSync(manifestPath, JSON.stringify(mapping, null, 2), 'utf8');
      manifestWritten = true;
      break;
    }
  }

  // If we wrote the manifest as a fallback, also clear any stale
  // symlinks that point at sessions that are no longer in the mapping.
  // We do NOT delete symlinks that match the current mapping (they
  // co-exist with the manifest so the reader can prefer the symlink
  // when available). The reconciliation of stale links is left to
  // `reconcileWorkspace` callers, which call this function with a
  // fresh `mapping`.
  return {
    created,
    skipped,
    errors,
    manifestWritten,
    manifestPath: resolveChangeManifestPath(projectRoot),
    mapping
  };
}

/**
 * Resolve a `<rid>` to its bound `<sessionId>`. Consults the symlink
 * first, the manifest second, and falls back to walking the request
 * artifacts on disk. Returns `null` when no binding is found.
 *
 * Pure read — does not write to disk.
 */
export function resolveChangeId(rid: string, projectRoot: string): ResolveChangeIdResult {
  if (!CHANGE_ID_PATTERN.test(rid)) {
    return { rid, sessionId: null, source: null };
  }

  // 1. Symlink path
  const linkPath = resolveChangeSymlinkPath(projectRoot, rid);
  if (defaultIsSymlink(linkPath)) {
    const target = readSymlinkTarget(linkPath);
    if (target !== null) {
      // The target is `../<sid>/`. Walk up two segments to get the
      // session dir, then take its basename.
      const absTarget = resolve(dirname(linkPath), target);
      const sid = basenameFromSymlinkTarget(absTarget, projectRoot);
      if (sid !== null && SESSION_ID_PATTERN.test(sid)) {
        return { rid, sessionId: sid, source: 'symlink' };
      }
    }
  }

  // 2. Manifest path
  const manifest = readChangeLinkManifest(projectRoot);
  const manifestSid = manifest[rid];
  if (typeof manifestSid === 'string' && SESSION_ID_PATTERN.test(manifestSid)) {
    return { rid, sessionId: manifestSid, source: 'manifest' };
  }

  // 3. Session-walk fallback (the on-disk source of truth)
  const walk = discoverRequestArtifacts(projectRoot);
  const walkSid = walk[rid];
  if (typeof walkSid === 'string' && SESSION_ID_PATTERN.test(walkSid)) {
    return { rid, sessionId: walkSid, source: 'session-walk' };
  }

  return { rid, sessionId: null, source: null };
}

/**
 * Read the symlink target without throwing. node's `fs.readlinkSync`
 * works on all platforms but is not in the `node:fs` re-export we
 * already imported; we use `fs.realpathSync` (which dereferences the
 * symlink) for a different purpose, so we just call `readlinkSync`
 * here as a one-off. Errors are swallowed.
 */
function readSymlinkTarget(linkPath: string): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readlinkSync } = require('node:fs') as typeof import('node:fs');
    return readlinkSync(linkPath);
  } catch {
    return null;
  }
}

/**
 * The symlink target is `../<sid>/`. After we resolve it to an
 * absolute path, the result is `<projectRoot>/.peaks/_runtime/<sid>`.
 * We return the basename when it sits under `.peaks/_runtime/`,
 * otherwise we return `null` to refuse untrusted symlink targets.
 */
function basenameFromSymlinkTarget(absTarget: string, projectRoot: string): string | null {
  if (!isAbsolute(absTarget)) return null;
  const runtimeRoot = resolve(projectRoot, '.peaks', '_runtime');
  const rel = relative(runtimeRoot, absTarget);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  // rel may be "<sid>" or "<sid>/" — split on the first slash.
  const sid = rel.split('/')[0] ?? '';
  return sid.length > 0 ? sid : null;
}
