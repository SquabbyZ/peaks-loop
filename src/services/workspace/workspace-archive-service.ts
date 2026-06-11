import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { join, sep } from 'node:path';
import { assertValidSessionId } from './sid-naming-guard.js';

export interface ArchivePlan {
  sid: string;
  sourcePath: string;
  targetPath: string;
  sourceExists: boolean;
}

export interface ArchiveOptions {
  sid: string;
  apply: boolean;
}

export interface ArchiveResult {
  moved: string[];
  skipped: { sid: string; reason: string }[];
}

const ARCHIVE_ROOT = '_archive';
const RUNTIME_DIR = '_runtime';

function toPosix(p: string): string {
  return p.split(sep).join('/');
}

export function planArchive(projectRoot: string, sid: string): ArchivePlan {
  assertValidSessionId(sid);
  const yyyyMm = sid.slice(0, 7);
  const sourcePath = join(projectRoot, '.peaks', RUNTIME_DIR, sid);
  const targetPath = join(projectRoot, '.peaks', ARCHIVE_ROOT, yyyyMm, sid);
  return {
    sid,
    sourcePath: toPosix(sourcePath),
    targetPath: toPosix(targetPath),
    sourceExists: existsSync(sourcePath),
  };
}

export function archiveSession(projectRoot: string, options: ArchiveOptions): ArchiveResult {
  const plan = planArchive(projectRoot, options.sid);
  if (!plan.sourceExists) {
    return { moved: [], skipped: [{ sid: options.sid, reason: 'source does not exist' }] };
  }
  if (!options.apply) {
    return { moved: [], skipped: [{ sid: options.sid, reason: 'dry-run' }] };
  }
  mkdirSync(join(plan.targetPath, '..'), { recursive: true });
  renameSync(plan.sourcePath, plan.targetPath);
  return { moved: [options.sid], skipped: [] };
}
