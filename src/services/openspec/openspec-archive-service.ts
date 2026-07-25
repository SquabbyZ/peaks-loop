import { mkdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isDirectory } from 'peaks-loop-shared/fs';

import { validateChangeId } from './artifact-boundary.js';
import type { OpenSpecScanOptions } from './openspec-scan-service.js';

export type OpenSpecArchiveOptions = OpenSpecScanOptions & {
  apply?: boolean;
  archiveDirName?: string;
};

export type OpenSpecArchiveResult = {
  changeId: string;
  from: string;
  to: string;
  applied: boolean;
};

function defaultOpenSpecRoot(): string {
  return join(process.cwd(), 'openspec');
}

export async function archiveOpenSpecChange(
  changeId: string,
  options: OpenSpecArchiveOptions = {}
): Promise<OpenSpecArchiveResult | null> {
  const changeIdResult = validateChangeId(changeId);
  if (!changeIdResult.ok) {
    throw new Error(`changeId ${changeId} does not match [A-Za-z0-9][A-Za-z0-9._-]*`);
  }

  const openspecRoot = options.openspecRoot ?? defaultOpenSpecRoot();
  const archiveDir = options.archiveDirName ?? 'archive';
  const from = join(openspecRoot, 'changes', changeId);
  const to = join(openspecRoot, 'changes', archiveDir, changeId);

  if (!(await isDirectory(from))) {
    return null;
  }

  if (options.apply !== true) {
    return { changeId, from, to, applied: false };
  }

  if (await isDirectory(to)) {
    throw new Error(`Refusing to archive: target already exists at ${to}`);
  }

  await mkdir(dirname(to), { recursive: true });
  await rename(from, to);

  return { changeId, from, to, applied: true };
}
