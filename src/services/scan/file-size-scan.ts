import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_FILE_SIZE_THRESHOLD = 800;

export type FileSizeViolation = {
  file: string;
  lines: number;
};

export type FileSizeScanResult = {
  ok: boolean;
  threshold: number;
  checkedFiles: number;
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
    const trackedRaw = execFileSync('git', ['-C', projectRoot, 'diff', '--name-only', baseRef], { encoding: 'utf8' });
    const tracked = trackedRaw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const untrackedRaw = execFileSync('git', ['-C', projectRoot, 'ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' });
    const untracked = untrackedRaw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return Array.from(new Set([...tracked, ...untracked]));
  } catch {
    return [];
  }
}

function countLines(filePath: string): number {
  try {
    const content = readFileSync(filePath, 'utf8');
    return content.split(/\r?\n/).length;
  } catch {
    return 0;
  }
}

export function scanFileSize(options: FileSizeScanOptions): FileSizeScanResult {
  const baseRef = options.baseRef ?? 'HEAD';
  const threshold = options.threshold ?? DEFAULT_FILE_SIZE_THRESHOLD;
  const files = getChangedFiles(options.projectRoot, baseRef);
  const violations: FileSizeViolation[] = [];

  for (const file of files) {
    const absolute = join(options.projectRoot, file);
    const lines = countLines(absolute);
    if (lines > threshold) {
      violations.push({ file, lines });
    }
  }

  return {
    ok: violations.length === 0,
    threshold,
    checkedFiles: files.length,
    violations
  };
}
