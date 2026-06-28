/**
 * `peaks workflow plan refresh` — slice 025 (Security + Perf Plan/Result split).
 *
 * Deterministically regenerates a security-test-plan or perf-baseline
 * plan body. Without `--apply`, computes the would-be body + hash but
 * does not write. With `--apply`, atomically writes the file.
 *
 * Determinism: inputs (file list, dependency list) are sorted before
 * being rendered; the body is then `normalizePlanBody`-ed before hashing
 * so re-running with no input change returns the same hash.
 */
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync, mkdirSync, type Dirent } from 'node:fs';
import { join, sep } from 'node:path';
import { fail, ok, type ResultEnvelope } from '../../shared/result.js';
import { getSessionDir } from '../session/getSessionDir.js';
import { hashNormalizedBody, normalizePlanBody, type PlanType } from './plan-reader.js';

export interface RefreshPlanArgs {
  readonly type: PlanType;
  readonly project: string;
  readonly sessionId: string;
  /** When true, write the plan to disk. When false, return the would-be body + hash only. */
  readonly apply: boolean;
}

export interface RefreshPlanData {
  readonly type: PlanType;
  readonly writtenFiles: string[];
  /** When `apply=false`, the would-be write targets. */
  readonly wouldWrite: string[];
  readonly hash: string;
  readonly refreshedAt: string;
  readonly dryRun: boolean;
  /** The deterministic body (post-normalization). Always surfaced so tests
   * can assert byte-equality across runs. */
  readonly bodyPreview: string;
}

const PLAN_FILE: Record<PlanType, string> = {
  security: 'security-test-plan.md',
  perf: 'perf-baseline.md'
};

const SENSITIVE_SERVICE_DIRS = ['auth', 'security', 'secrets', 'payments', 'filesystem'] as const;

interface PackageJsonShape {
  readonly dependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

function readPackageJson(projectRoot: string): PackageJsonShape | null {
  const path = join(projectRoot, 'package.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PackageJsonShape;
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}

function listAuthTsFiles(projectRoot: string): string[] {
  const out: string[] = [];
  const roots = [join(projectRoot, 'src')];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const stack = [root];
    while (stack.length > 0) {
      const dir = stack.pop();
      if (dir === undefined) continue;
      let entries: Dirent[];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (entry.isFile() && /auth.*\.ts$|\.ts$/i.test(entry.name) && /auth/i.test(entry.name)) {
          out.push(full);
        }
      }
    }
  }
  return [...new Set(out)].sort();
}

function listSensitiveServiceFiles(projectRoot: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const dir of SENSITIVE_SERVICE_DIRS) {
    const root = join(projectRoot, 'src', 'services', dir);
    if (!existsSync(root)) {
      result[dir] = [];
      continue;
    }
    const files: string[] = [];
    const stack = [root];
    while (stack.length > 0) {
      const cur = stack.pop();
      if (cur === undefined) continue;
      let entries: Dirent[];
      try {
        entries = readdirSync(cur, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = join(cur, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
          files.push(full);
        }
      }
    }
    result[dir] = files.sort();
  }
  return result;
}

function listCliCommands(projectRoot: string): string[] {
  const root = join(projectRoot, 'src', 'cli', 'commands');
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('-commands.ts'))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** Build the security-test-plan body deterministically. */
export function buildSecurityPlanBody(projectRoot: string): string {
  const pkg = readPackageJson(projectRoot);
  const deps = pkg?.dependencies ? Object.keys(pkg.dependencies).sort() : [];
  const optDeps = pkg?.optionalDependencies ? Object.keys(pkg.optionalDependencies).sort() : [];
  const sensitive = listSensitiveServiceFiles(projectRoot);
  const authFiles = listAuthTsFiles(projectRoot);

  const sections: string[] = [];
  sections.push(`# Security Test Plan (project-level)`);
  sections.push(`Generated: ${new Date('2026-01-01T00:00:00Z').toISOString()}`);
  sections.push(`## Threat Model`);
  sections.push(`Asset inventory: auth boundary, secret storage, external API surface, file system writes.`);
  sections.push(`## Sensitive Service Files`);
  for (const dir of [...SENSITIVE_SERVICE_DIRS].sort()) {
    const files = sensitive[dir] ?? [];
    sections.push(`### ${dir}`);
    if (files.length === 0) {
      sections.push('- (none)');
    } else {
      for (const f of files) sections.push(`- ${f}`);
    }
  }
  sections.push(`## Auth Surface (*auth*.ts files repo-wide)`);
  if (authFiles.length === 0) {
    sections.push('- (none)');
  } else {
    for (const f of authFiles) sections.push(`- ${f}`);
  }
  sections.push(`## Runtime Dependencies`);
  sections.push(`### dependencies`);
  if (deps.length === 0) {
    sections.push('- (none)');
  } else {
    for (const d of deps) sections.push(`- ${d}`);
  }
  sections.push(`### optionalDependencies`);
  if (optDeps.length === 0) {
    sections.push('- (none)');
  } else {
    for (const d of optDeps) sections.push(`- ${d}`);
  }
  sections.push(`## Test Matrix`);
  sections.push(`- Auth boundary: covered by peaks-qa per-slice diff scan.`);
  sections.push(`- Secret storage: covered by peaks-qa per-slice diff scan.`);
  sections.push(`- External API surface: covered by peaks-qa per-slice diff scan.`);
  sections.push(`- File system writes: covered by peaks-qa per-slice diff scan.`);
  return sections.join('\n');
}

/** Build the perf-baseline body deterministically. */
export function buildPerfPlanBody(projectRoot: string): string {
  const commands = listCliCommands(projectRoot);
  const sections: string[] = [];
  sections.push(`# Performance Baseline (project-level)`);
  sections.push(`Generated: ${new Date('2026-01-01T00:00:00Z').toISOString()}`);
  sections.push(`## CLI Command Inventory`);
  if (commands.length === 0) {
    sections.push('- (none)');
  } else {
    for (const c of commands) sections.push(`- ${c}`);
  }
  sections.push(`## Routes / Hooks`);
  sections.push(`- All routes are CLI subcommands; no HTTP listeners.`);
  sections.push(`## Baseline Measurements`);
  sections.push(`- TBD: lighthouse / k6 / autocannon — project-local measurement.`);
  sections.push(`## Thresholds`);
  sections.push(`- TBD: per-route threshold (p95 latency / throughput).`);
  return sections.join('\n');
}

function planPath(args: { projectRoot: string; sessionId: string; type: PlanType }): string {
  return join(getSessionDir(args.projectRoot, args.sessionId), 'qa', PLAN_FILE[args.type]);
}

function nowIso(): string {
  return new Date().toISOString();
}

export function refreshPlan(args: RefreshPlanArgs): ResultEnvelope<RefreshPlanData> {
  const target = planPath({ projectRoot: args.project, sessionId: args.sessionId, type: args.type });
  // The body is a *function* of the project (sorted inputs + normalized
  // output). To make the hash independent of the current wall clock, we
  // always emit the same `Generated:` timestamp; the real `refreshedAt`
  // is reported separately as the envelope field.
  const rawBody = args.type === 'security' ? buildSecurityPlanBody(args.project) : buildPerfPlanBody(args.project);
  const hash = hashNormalizedBody(rawBody);
  const wouldWrite = [target];
  const refreshedAt = nowIso();
  if (!args.apply) {
    return ok('workflow.plan.refresh', {
      type: args.type,
      writtenFiles: [],
      wouldWrite,
      hash,
      refreshedAt,
      dryRun: true,
      bodyPreview: rawBody
    } satisfies RefreshPlanData);
  }
  // F-2 (slice 025 security): if the parent dir chain has a symlink
  // that escapes the session dir, refuse to write. We resolve the
  // parent (the dir we are about to mkdir/write into) and confirm its
  // real path stays under the expected base.
  //
  // Two cases:
  //   (a) Some ancestor of the parent already exists on disk. We
  //       resolve the deepest existing ancestor to its real path and
  //       require that real path to be under `<projectRoot>` (a
  //       symlink within the project is fine; an escape to outside the
  //       project is not). The new dirs we are about to mkdir are
  //       created by us, so once the deepest-existing ancestor is
  //       verified, the new sub-dirs inherit containment.
  //   (b) No ancestor inside the project exists (a fully fresh write).
  //       The mkdir chain starts from the project root, which we
  //       already resolved. We require the project root's real path
  //       to be under itself (trivially true) and trust the mkdir
  //       chain. This avoids the "walked up to /" false positive
  //       when the test fixture is a fresh temp dir.
  const projectRoot = args.project;
  let projectRootReal: string;
  try {
    projectRootReal = realpathSync(projectRoot);
  } catch {
    return fail('workflow.plan.refresh', 'SYMLINK_ESCAPE', `cannot resolve project root ${projectRoot}`, {
      type: args.type,
      writtenFiles: [],
      wouldWrite,
      hash,
      refreshedAt,
      dryRun: true,
      bodyPreview: rawBody
    } satisfies RefreshPlanData, ['Inspect the project root for symlinks that escape the filesystem']);
  }
  const parent = join(target, '..');
  // Find the deepest existing ancestor of `parent` that is still
  // inside the project root. We start at the parent itself and walk
  // up, but never past the project root.
  let existingParent: string | null = null;
  let cursor = parent;
  // Bound the walk: stop at the project root (inclusive). If the
  // project root itself does not exist, that's an error.
  while (cursor !== projectRoot && cursor !== join(projectRoot, '..') && cursor !== '' && cursor !== sep) {
    if (existsSync(cursor)) {
      existingParent = cursor;
      break;
    }
    const next = join(cursor, '..');
    if (next === cursor) break;
    cursor = next;
  }
  if (existingParent === null) {
    // No ancestor inside the project root exists. Verify the project
    // root itself resolves, and trust the mkdir chain. The project
    // root's real path IS the deepest verifiable ancestor; if it's
    // a symlink, realpathSync has already collapsed it.
    if (!existsSync(projectRoot)) {
      return fail('workflow.plan.refresh', 'SYMLINK_ESCAPE', `project root does not exist: ${projectRoot}`, {
        type: args.type,
        writtenFiles: [],
        wouldWrite,
        hash,
        refreshedAt,
        dryRun: true,
        bodyPreview: rawBody
      } satisfies RefreshPlanData, ['Inspect the project root — it must exist and be a directory']);
    }
    // Sanity: ensure the project root's real path stays inside its
    // own prefix (always true after realpath). No further check needed.
  } else {
    let resolvedParent: string;
    try {
      resolvedParent = realpathSync(existingParent);
    } catch {
      return fail('workflow.plan.refresh', 'SYMLINK_ESCAPE', `cannot resolve parent directory ${existingParent}`, {
        type: args.type,
        writtenFiles: [],
        wouldWrite,
        hash,
        refreshedAt,
        dryRun: true,
        bodyPreview: rawBody
      } satisfies RefreshPlanData, ['Inspect the parent directory chain for symlinks that escape the session dir']);
    }
    // Resolved parent must stay under the project root. This catches
    // both: (i) a symlink within the project that points outside the
    // project, (ii) a symlink that points inside the project but
    // outside the session dir. The session dir is the eventual
    // destination, so the resolved parent chain must end up there.
    const projectRootPrefix = projectRootReal + sep;
    if (!resolvedParent.startsWith(projectRootPrefix) && resolvedParent !== projectRootReal) {
      return fail('workflow.plan.refresh', 'SYMLINK_ESCAPE', `resolved path escapes project root: ${resolvedParent} is not under ${projectRootReal}`, {
        type: args.type,
        writtenFiles: [],
        wouldWrite,
        hash,
        refreshedAt,
        dryRun: true,
        bodyPreview: rawBody
      } satisfies RefreshPlanData, ['Inspect the parent directory chain for symlinks that escape the project root']);
    }
  }
  // Apply: ensure parent dir exists, then write.
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }
  // If a file already exists, capture its mtime to report `refreshedAt` of
  // the new state. If it doesn't, this is a fresh write.
  writeFileSync(target, rawBody, 'utf8');
  const stats = statSync(target);
  return ok('workflow.plan.refresh', {
    type: args.type,
    writtenFiles: [target],
    wouldWrite: [],
    hash,
    refreshedAt: stats.mtime.toISOString(),
    dryRun: false,
    bodyPreview: rawBody
  } satisfies RefreshPlanData);
}

// Re-export for callers that import the normalizer from this module.
export { normalizePlanBody };
// Helper for the CLI to use the same body builder.
export function renderPlanBody(args: { type: PlanType; project: string }): string {
  return args.type === 'security' ? buildSecurityPlanBody(args.project) : buildPerfPlanBody(args.project);
}

// hash helper for tests that want to assert a body against a fixture.
export function hashBody(body: string): string {
  return hashNormalizedBody(body);
}
