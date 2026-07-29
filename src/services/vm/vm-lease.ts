/**
 * vm-lease — pure-function lease store for `peaks vm spawn`.
 *
 * Slice 2026-07-29-worktree-l2-extended Part 35 (L4 VM runtime).
 * Parallels the design of `worktree-lease.ts` (Part 1) and
 * `container-lease.ts` (Part 12). The L4 VM isolation mode
 * (`--isolation vm` in dispatch) needs its own lease surface
 * so the PreToolUse gate can grant `docker`-class operations
 * to sub-agents that own a VM lease.
 *
 * Hypervisor support:
 *   - kvm:     virsh create + virsh destroy (Linux KVM via libvirt)
 *   - hyperkit: hvftool create + hvftool stop (macOS HyperKit)
 *   - hyperv:  hvc create + hvc stop (Windows Hyper-V via the
 *     Hyper-V cmdlets; the operator wires the entry shim)
 *
 * Each hypervisor has its own spawn pattern; the lease file
 * records which hypervisor was used so `peaks vm release`
 * can dispatch to the right cleanup command.
 */
import { randomBytes } from 'node:crypto';
import { posix as path } from 'node:path';

export type VmHypervisor = 'kvm' | 'hyperkit' | 'hyperv';
export const VM_HYPERVISORS: ReadonlyArray<VmHypervisor> = Object.freeze([
  'kvm', 'hyperkit', 'hyperv'
]);

export const DEFAULT_TTL_BY_ROLE: Readonly<Record<string, number>> = Object.freeze({
  rd: 30 * 60 * 1_000,
  qa: 15 * 60 * 1_000,
  ui: 60 * 60 * 1_000,
  sc: 30 * 60 * 1_000,
  prd: 15 * 60 * 1_000,
  general: 30 * 60 * 1_000
}) as Readonly<Record<string, number>>;

export const DEFAULT_TTL_MS = DEFAULT_TTL_BY_ROLE.rd;
export const DEFAULT_VM_IMAGE = 'peaks-base:22-slim';

export type VmLeaseStatus = 'active' | 'released' | 'expired' | 'gc';

export interface VmLease {
  readonly leaseId: string;
  readonly rid: string;
  readonly role: string;
  /** Host path mounted into the VM working dir. */
  readonly path: string;
  /** Hypervisor the VM runs under (kvm | hyperkit | hyperv). */
  readonly hypervisor: VmHypervisor;
  /** VM image name (e.g. 'peaks-base:22-slim'). */
  readonly image: string;
  /** VM domain id reported by virsh / hvftool / hvc. */
  readonly vmId: string;
  /** Unix epoch ms when the lease was created. */
  readonly createdAt: number;
  /** Unix epoch ms when the lease expires. */
  readonly expiresAt: number;
  /** Operator-supplied purpose text (audit log). */
  readonly purpose: string;
  readonly status: VmLeaseStatus;
  readonly consumedBySubAgents: ReadonlyArray<string>;
}

export type VmLeaseDraft = Omit<VmLease, 'status' | 'consumedBySubAgents'>;

export function vmLeaseStoreDir(sessionRuntimeDir: string): string {
  return joinPath(sessionRuntimeDir, 'vm-leases');
}

export function vmLeaseFilePath(sessionRuntimeDir: string, leaseId: string): string {
  return joinPath(vmLeaseStoreDir(sessionRuntimeDir), `${leaseId}.json`);
}

export function generateVmLeaseId(): string {
  return randomBytes(8).toString('hex');
}

export function ttlForVmRole(role: string): number {
  const normalized = role.toLowerCase();
  const candidate: number | undefined = DEFAULT_TTL_BY_ROLE[normalized];
  const fallback: number = DEFAULT_TTL_BY_ROLE['rd'] ?? 30 * 60 * 1_000;
  return candidate ?? fallback;
}

export function finalizeVmLease(draft: VmLeaseDraft): VmLease {
  return { ...draft, status: 'active', consumedBySubAgents: [] };
}

export function markVmReleased(lease: VmLease): VmLease {
  return { ...lease, status: 'released' };
}

export function markVmExpired(lease: VmLease): VmLease {
  return { ...lease, status: 'expired' };
}

export function markVmGc(lease: VmLease): VmLease {
  return { ...lease, status: 'gc' };
}

export function recordVmConsumption(lease: VmLease, subAgentId: string): VmLease {
  if (lease.consumedBySubAgents.includes(subAgentId)) return lease;
  return { ...lease, consumedBySubAgents: [...lease.consumedBySubAgents, subAgentId] };
}

export function isVmLeaseActive(lease: VmLease, now: number = Date.now()): boolean {
  return lease.status === 'active' && lease.expiresAt > now;
}

export function serializeVmLease(lease: VmLease): string {
  return JSON.stringify(lease, null, 2) + '\n';
}

export function deserializeVmLease(raw: string): VmLease {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('vm lease file must contain a JSON object');
  }
  const obj = parsed as Record<string, unknown>;
  const required: ReadonlyArray<keyof VmLease> = [
    'leaseId', 'rid', 'role', 'path', 'hypervisor', 'image', 'vmId',
    'createdAt', 'expiresAt', 'purpose', 'status', 'consumedBySubAgents'
  ];
  for (const k of required) {
    if (!(k in obj)) throw new Error(`vm lease missing field: ${k}`);
  }
  if (!VM_HYPERVISORS.includes(obj.hypervisor as VmHypervisor)) {
    throw new Error(`vm lease hypervisor invalid: ${String(obj.hypervisor)}`);
  }
  if (typeof obj.leaseId !== 'string') throw new Error('leaseId missing');
  if (typeof obj.rid !== 'string') throw new Error('rid missing');
  if (typeof obj.role !== 'string') throw new Error('role missing');
  if (typeof obj.path !== 'string') throw new Error('path missing');
  if (typeof obj.image !== 'string') throw new Error('image missing');
  if (typeof obj.vmId !== 'string') throw new Error('vmId missing');
  if (typeof obj.createdAt !== 'number') throw new Error('createdAt missing');
  if (typeof obj.expiresAt !== 'number') throw new Error('expiresAt missing');
  if (typeof obj.purpose !== 'string') throw new Error('purpose missing');
  if (typeof obj.status !== 'string') throw new Error('status missing');
  if (!Array.isArray(obj.consumedBySubAgents)) throw new Error('consumedBySubAgents missing');
  return {
    leaseId: obj.leaseId,
    rid: obj.rid,
    role: obj.role,
    path: obj.path,
    hypervisor: obj.hypervisor as VmHypervisor,
    image: obj.image,
    vmId: obj.vmId,
    createdAt: obj.createdAt,
    expiresAt: obj.expiresAt,
    purpose: obj.purpose,
    status: obj.status as VmLeaseStatus,
    consumedBySubAgents: obj.consumedBySubAgents as ReadonlyArray<string>
  };
}

function joinPath(...segments: ReadonlyArray<string>): string {
  if (segments.length === 0) return '';
  const normalized = segments.map((s) => s.replace(/\\/g, '/'));
  let acc: string = normalized[0] as string;
  for (let i = 1; i < normalized.length; i++) {
    acc = path.join(acc, normalized[i] as string);
  }
  return acc;
}
