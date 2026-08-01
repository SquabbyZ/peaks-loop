import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const DISPATCH_PROVENANCE_ENV = 'PEAKS_SUB_AGENT_DISPATCH_PROVENANCE';
const PROVENANCE_DIR = 'dispatch-provenance';

export type DispatchProvenance = {
  readonly schemaVersion: 1;
  readonly token: string;
  readonly sessionId: string;
  readonly requestId: string;
  readonly leaseId: string;
  readonly isolation: 'worktree';
  readonly issuedAt: string;
};

export function createDispatchProvenanceToken(input: {
  readonly sessionId: string;
  readonly requestId: string;
  readonly leaseId: string;
}): string {
  return createHash('sha256')
    .update(`${input.sessionId}|${input.requestId}|${input.leaseId}`)
    .digest('hex')
    .slice(0, 32);
}

export function dispatchProvenanceFilePath(
  projectRoot: string,
  sessionId: string,
  token: string,
): string {
  return join(projectRoot, '.peaks', '_runtime', sessionId, PROVENANCE_DIR, `${token}.json`);
}

export function writeDispatchProvenance(input: {
  readonly projectRoot: string;
  readonly record: DispatchProvenance;
}): void {
  const path = dispatchProvenanceFilePath(input.projectRoot, input.record.sessionId, input.record.token);
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, `${JSON.stringify(input.record, null, 2)}\n`, 'utf8');
  renameSync(tempPath, path);
}

export function readDispatchProvenance(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly token: string;
}): DispatchProvenance | null {
  if (!/^[a-f0-9]{32}$/.test(input.token)) return null;
  const path = dispatchProvenanceFilePath(input.projectRoot, input.sessionId, input.token);
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed === null || typeof parsed !== 'object') return null;
    const value = parsed as Record<string, unknown>;
    if (
      value.schemaVersion !== 1 ||
      value.token !== input.token ||
      value.sessionId !== input.sessionId ||
      typeof value.requestId !== 'string' ||
      typeof value.leaseId !== 'string' ||
      value.isolation !== 'worktree' ||
      typeof value.issuedAt !== 'string'
    ) {
      return null;
    }
    return parsed as DispatchProvenance;
  } catch {
    return null;
  }
}
