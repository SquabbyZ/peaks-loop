// src/cli/commands/vm-command-shared.ts
//
// What `peaks vm` verbs share: the option shapes, the session-id resolution and
// the role-aware TTL. Split out of `vm-commands.ts`; every resolution order and
// default is unchanged.

import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';
import { ttlForVmRole, type VmHypervisor } from '../../services/vm/vm-lease.js';

export type VmOptions = {
  session?: string;
  project?: string;
  json?: boolean;
};

export type SpawnOptions = VmOptions & {
  rid: string;
  role: string;
  purpose: string;
  hypervisor?: VmHypervisor;
  image?: string;
  ttl?: string;
  mount?: string;
};

export type ReleaseOptions = VmOptions & {
  leaseId: string;
};

/** `--session`, else `PEAKS_SESSION_ID`, else the project's bound session, else `unknown-sid`. */
export function resolveVmSessionId(projectRoot: string, session: string | undefined): string {
  return (
    session ?? process.env.PEAKS_SESSION_ID ?? getCurrentSessionId(projectRoot) ?? 'unknown-sid'
  );
}

/** `<projectRoot>/.peaks/_runtime/<sessionId>` — trailing separators collapsed. */
export function joinPathSession(projectRoot: string, sessionId: string): string {
  return `${projectRoot.replace(/[\\/]+$/, '')}/.peaks/_runtime/${sessionId}`;
}

export function resolveTtlMs(raw: string | undefined, role: string): number {
  if (typeof raw !== 'string' || raw.length === 0) return ttlForVmRole(role);
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return ttlForVmRole(role);
  return parsed;
}
