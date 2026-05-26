import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { isDirectory } from '../../shared/fs.js';

export type WorkspaceInitOptions = {
  projectRoot: string;
  sessionId: string;
};

export type WorkspaceInitReport = {
  sessionId: string;
  sessionRoot: string;
  created: string[];
  alreadyExisted: string[];
};

const SUBDIRECTORIES: ReadonlyArray<string> = [
  'prd/source',
  'prd/requests',
  'ui/requests',
  'rd/requests',
  'qa/test-cases',
  'qa/test-reports',
  'qa/requests',
  'sc',
  'txt',
  'system'
];

const SESSION_ID_PATTERN = /^\d{4}-\d{2}-\d{2}-[a-z][a-z0-9-]*[a-z0-9]$/;

const PROHIBITED_SUFFIXES: ReadonlyArray<string> = ['session', 'work', 'task', 'test', 'temp', 'tmp'];

export class InvalidSessionIdError extends Error {
  readonly code = 'INVALID_SESSION_ID';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSessionIdError';
  }
}

export function validateSessionId(sessionId: string): void {
  if (/^\d+$/.test(sessionId)) {
    throw new InvalidSessionIdError(`Session id "${sessionId}" is numeric-only. Use the format YYYY-MM-DD-<kebab-slug> with a 2-5 word topic description.`);
  }
  if (/^\d{8}T\d{6}$/.test(sessionId) || /^\d{8}$/.test(sessionId)) {
    throw new InvalidSessionIdError(`Session id "${sessionId}" looks like a bare timestamp. Use YYYY-MM-DD-<kebab-slug>.`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(sessionId)) {
    throw new InvalidSessionIdError(`Session id "${sessionId}" is a bare date. Append a 2-5 word topic slug (e.g. "${sessionId}-add-user-auth").`);
  }
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new InvalidSessionIdError(`Session id "${sessionId}" must match YYYY-MM-DD-<kebab-slug>, all lowercase, dashes only.`);
  }
  const suffix = sessionId.slice(11); // strip "YYYY-MM-DD-"
  if (PROHIBITED_SUFFIXES.includes(suffix)) {
    throw new InvalidSessionIdError(`Session id suffix "${suffix}" is a generic placeholder. Use a real topic slug (e.g. "add-user-auth", "v3-indicator-model").`);
  }
}

export async function initWorkspace(options: WorkspaceInitOptions): Promise<WorkspaceInitReport> {
  validateSessionId(options.sessionId);
  const sessionRoot = join(options.projectRoot, '.peaks', options.sessionId);
  const created: string[] = [];
  const alreadyExisted: string[] = [];
  if (await isDirectory(sessionRoot)) {
    alreadyExisted.push('.');
  } else {
    await mkdir(sessionRoot, { recursive: true });
    created.push('.');
  }
  for (const sub of SUBDIRECTORIES) {
    const full = join(sessionRoot, sub);
    if (await isDirectory(full)) {
      alreadyExisted.push(sub);
    } else {
      await mkdir(full, { recursive: true });
      created.push(sub);
    }
  }
  return { sessionId: options.sessionId, sessionRoot, created, alreadyExisted };
}
