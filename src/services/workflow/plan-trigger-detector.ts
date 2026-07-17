/**
 * `peaks workflow plan detect-trigger` — slice 025 (Security + Perf
 * Plan/Result split).
 *
 * Compares the current project state (filesystem + package.json) to the
 * last-refresh fingerprint and returns whether a plan refresh is
 * warranted. Five trigger rules, locked decision 1 excludes
 * devDependencies.
 *
 * The slice's "diff" is supplied as a `SliceDiff` object; when not
 * supplied, the detector scans the project directly (the same scan the
 * refresh plan performs).
 */

import { existsSync, readFileSync, readdirSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import { fail, ok, type ResultEnvelope } from 'peaks-loop-shared/result';

export type TriggerReason =
  | 'new-dependency'
  | 'auth-surface-added'
  | 'hot-path-added'
  | 'manual-override'
  | 'no-change'
  | 'no-triggering-change';

/** F-1 (slice 025 security): canonical request-id shape. */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface DetectTriggerArgs {
  readonly project: string;
  readonly rid: string;
  readonly sessionId: string;
  /** Optional slice diff — when provided, takes precedence over a fresh
   * filesystem scan. Shape mirrors the `peaks request diff <rid> --json`
   * output's `packageJson` field. */
  readonly diff?: SliceDiff | null;
  /** When true, the caller is the slice workflow with `--refresh` set.
   * Forces triggered=true. Per PRD trigger table. */
  readonly manualOverride?: boolean;
}

export interface SliceDiff {
  readonly packageJson?: {
    readonly dependencies?: { readonly added?: readonly string[]; readonly removed?: readonly string[]; readonly changed?: readonly string[] };
    readonly optionalDependencies?: { readonly added?: readonly string[]; readonly removed?: readonly string[]; readonly changed?: readonly string[] };
    readonly devDependencies?: { readonly added?: readonly string[]; readonly removed?: readonly string[]; readonly changed?: readonly string[] };
  };
  readonly newFiles?: readonly string[];
  readonly changedFiles?: readonly string[];
}

export interface DetectTriggerData {
  readonly triggered: boolean;
  readonly reason: TriggerReason;
}

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

function isAuthFile(path: string): boolean {
  return /auth.*\.ts$|\.ts$/i.test(path) && /auth/i.test(path);
}

function isHotPathFile(path: string): boolean {
  return /router\.ts$|commands\/.*-commands\.ts$/i.test(path);
}

function isSensitiveServiceFile(path: string): boolean {
  if (!/^src\/services\/(auth|security|secrets|payments|filesystem)\//.test(path)) return false;
  return /\.ts$/.test(path);
}

function freshScan(projectRoot: string): SliceDiff {
  const pkg = readPackageJson(projectRoot);
  const newFiles: string[] = [];
  const root = join(projectRoot, 'src');
  if (existsSync(root)) {
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
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
          // For the purposes of trigger detection, every TS file is a
          // candidate; the gate logic decides which class it falls into.
          newFiles.push(full);
        }
      }
    }
  }
  return {
    packageJson: {
      dependencies: { added: Object.keys(pkg?.dependencies ?? {}), removed: [], changed: [] },
      optionalDependencies: { added: Object.keys(pkg?.optionalDependencies ?? {}), removed: [], changed: [] },
      devDependencies: { added: Object.keys(pkg?.devDependencies ?? {}), removed: [], changed: [] }
    },
    newFiles: newFiles.sort(),
    changedFiles: []
  };
}

function anyAddedDeps(diff: SliceDiff): boolean {
  const dep = diff.packageJson?.dependencies?.added ?? [];
  const opt = diff.packageJson?.optionalDependencies?.added ?? [];
  return dep.length > 0 || opt.length > 0;
}

function findNewAuthFile(diff: SliceDiff): string | null {
  for (const f of diff.newFiles ?? []) {
    if (isAuthFile(f)) return f;
  }
  return null;
}

function findNewSensitiveServiceFile(diff: SliceDiff): string | null {
  for (const f of diff.newFiles ?? []) {
    if (isSensitiveServiceFile(f)) return f;
  }
  return null;
}

function findNewHotPathFile(diff: SliceDiff): string | null {
  for (const f of diff.newFiles ?? []) {
    if (isHotPathFile(f)) return f;
  }
  return null;
}

export function detectTrigger(args: DetectTriggerArgs): ResultEnvelope<DetectTriggerData> {
  // F-1 (slice 025 security): reject traversal/separator payloads at
  // the service boundary so every caller (CLI, skill, integration test)
  // gets the same rejection shape.
  if (!REQUEST_ID_PATTERN.test(args.rid)) {
    return fail('workflow.plan.detect-trigger', 'INVALID_RID', 'request id must match [A-Za-z0-9][A-Za-z0-9._-]*', {
      triggered: false,
      reason: 'no-triggering-change'
    } satisfies DetectTriggerData);
  }
  if (args.manualOverride === true) {
    return ok('workflow.plan.detect-trigger', { triggered: true, reason: 'manual-override' } satisfies DetectTriggerData);
  }
  const diff = args.diff ?? freshScan(args.project);
  // Rule 1: new top-level dependency in `dependencies` or `optionalDependencies`
  // (devDependencies explicitly excluded per locked decision 1).
  if (anyAddedDeps(diff)) {
    return ok('workflow.plan.detect-trigger', { triggered: true, reason: 'new-dependency' } satisfies DetectTriggerData);
  }
  // Rule 2: new file under src/services/{auth,security,secrets,payments,filesystem}/
  if (findNewSensitiveServiceFile(diff) !== null) {
    return ok('workflow.plan.detect-trigger', { triggered: true, reason: 'auth-surface-added' } satisfies DetectTriggerData);
  }
  // Rule 3: new *auth*.ts file anywhere in src/
  if (findNewAuthFile(diff) !== null) {
    return ok('workflow.plan.detect-trigger', { triggered: true, reason: 'auth-surface-added' } satisfies DetectTriggerData);
  }
  // Rule 4: new endpoint / route registration
  if (findNewHotPathFile(diff) !== null) {
    return ok('workflow.plan.detect-trigger', { triggered: true, reason: 'hot-path-added' } satisfies DetectTriggerData);
  }
  return ok('workflow.plan.detect-trigger', { triggered: false, reason: 'no-triggering-change' } satisfies DetectTriggerData);
}
