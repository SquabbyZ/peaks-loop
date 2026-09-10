import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_FILE_SIZE_THRESHOLD = 800;

/**
 * Paths exempt from the file-size cap because they are whole-cloth tool
 * output, not source a human maintains. `.peaks/**` is Peaks-Loop's own state
 * store and holds three derived indexes already over the cap
 * (`memory/index.json`, `lint/baseline.json`, `retrospective/index.json`);
 * exempting only `memory/` would leave the other two false positives intact.
 * No source module lives there, and its largest hand-authored file is under
 * 500 lines. Lockfiles are regenerated on every install. Declared once, here
 * — do not add special-cases in the scan loop.
 */
export const GENERATED_ARTIFACT_PATTERNS: readonly string[] = [
  '.peaks/**',
  '**/pnpm-lock.yaml',
  '**/package-lock.json',
  '**/yarn.lock'
];

/**
 * Glob → RegExp for the shapes above only, in a single split pass (chained
 * string replaces would re-expand the `.*` they had just produced). The
 * directory-wildcard prefix matches zero directories, so a root-level
 * lockfile still counts.
 */
function generatedPatternToRegExp(pattern: string): RegExp {
  const body = pattern
    .split(/(\*\*\/|\*\*|\*)/)
    .map((part) => {
      if (part === '**/') return '(?:.*/)?';
      if (part === '**') return '.*';
      if (part === '*') return '[^/]*';
      return part.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return new RegExp(`^${body}$`);
}

export function isGeneratedArtifact(file: string): boolean {
  const normalized = file.replace(/\\/g, '/');
  return GENERATED_ARTIFACT_PATTERNS.some((pattern) => generatedPatternToRegExp(pattern).test(normalized));
}

export type FileSizeViolation = {
  file: string;
  lines: number;
};

export type FileSizeScanResult = {
  ok: boolean;
  threshold: number;
  checkedFiles: number;
  /** Generated artifacts skipped by GENERATED_ARTIFACT_PATTERNS. Reported so
   *  the exemption is auditable rather than a silent skip. */
  exemptFiles: string[];
  /** Files that appeared in `git diff` but no longer exist on disk (e.g.
   *  deleted in the working tree). Pre-#015 the scan crashed on these via
   *  ENOENT; now they are reported here as informational data. */
  deletedFiles: string[];
  violations: FileSizeViolation[];
};

export type FileSizeScanOptions = {
  projectRoot: string;
  /** Compare working tree against this ref. Default 'HEAD'. */
  baseRef?: string;
  /** Line count threshold. Default 800. */
  threshold?: number;
};

function getChangedFiles(projectRoot: string, baseRef: string): string[] {
  try {
    // --diff-filter=AM keeps only Added + Modified entries. Deleted files
    // (--diff-filter=D) are intentionally excluded: they have no on-disk
    // body to count, and a refactor that deletes large files is exactly
    // when the gate should NOT block. Slice #015 fix.
    const trackedRaw = execFileSync('git', ['-C', projectRoot, 'diff', '--name-only', '--diff-filter=AM', baseRef], { encoding: 'utf8' });
    const tracked = trackedRaw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const untrackedRaw = execFileSync('git', ['-C', projectRoot, 'ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' });
    const untracked = untrackedRaw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return Array.from(new Set([...tracked, ...untracked]));
  } catch {
    return [];
  }
}

function countLines(filePath: string): number {
  const content = readFileSync(filePath, 'utf8');
  return content.split(/\r?\n/).length;
}

export function scanFileSize(options: FileSizeScanOptions): FileSizeScanResult {
  const baseRef = options.baseRef ?? 'HEAD';
  const threshold = options.threshold ?? DEFAULT_FILE_SIZE_THRESHOLD;
  const files = getChangedFiles(options.projectRoot, baseRef);
  const violations: FileSizeViolation[] = [];
  const deletedFiles: string[] = [];
  const exemptFiles: string[] = [];
  let checkedFiles = 0;

  for (const file of files) {
    if (isGeneratedArtifact(file)) {
      exemptFiles.push(file);
      continue;
    }
    const absolute = join(options.projectRoot, file);
    // Pre-#015: readFileSync threw ENOENT for files that appear in
    // `git diff --name-only` but no longer exist on disk (e.g. a refactor
    // that deletes source files). That aborted the entire
    // `peaks request transition rd → implemented` flow with
    // `code: PREREQUISITES_MISSING`. Now we skip missing paths — a
    // deleted file has no lines to count. Belt-and-braces: the
    // `getChangedFiles` filter above already excludes `--diff-filter=D`,
    // but a manually-passed `baseRef` (tests) or a path that was
    // untracked-then-deleted still flows through here, so the
    // existsSync guard stays as a second line of defense.
    if (!existsSync(absolute)) {
      try {
        const st = statSync(absolute);
        if (!st.isFile()) continue;
      } catch {
        deletedFiles.push(file);
        continue;
      }
    }
    checkedFiles += 1;
    const lines = countLines(absolute);
    if (lines > threshold) {
      violations.push({ file, lines });
    }
  }

  return {
    ok: violations.length === 0,
    threshold,
    checkedFiles,
    exemptFiles,
    deletedFiles,
    violations
  };
}
