/**
 * Contract broadcast store — 2.7.0 slice-dag-dispatcher MVP (slice 1.2.a).
 *
 * When slice A finishes, A's public contract (exports / types / signatures)
 * is written to `.peaks/_runtime/<sessionId>/dispatch/contracts/<slice-id>.json`.
 * Downstream slices (B, C, D) have their dispatch prompt auto-injected with
 * the contract content for any ancestor slice already in `completed`.
 *
 * Why this exists:
 *   Reading the source code of A from B's prompt inflates the prompt by
 *   kilobytes. Contracts are a stable summary: just the public surface.
 *
 * Path layout (cross-platform safe):
 *   `<projectRoot>/.peaks/_runtime/<sessionId>/dispatch/contracts/<slice-id>.json`
 *
 * All paths are constructed with `path.join` (homedir + join style via
 * Node `path.join`) to keep Windows / macOS / Linux interop.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Public surface of a finished slice. */
export interface SliceContract {
  readonly sliceId: string;
  readonly sessionId: string;
  readonly completedAt: string;
  /** Public exports (function / class / const / var names). */
  readonly exports: readonly string[];
  /** Public type names. */
  readonly types: readonly string[];
  /** Public function / method signatures, e.g. `"validateDag(dag: SliceDag): void"`. */
  readonly publicSignatures: readonly string[];
  /** Optional: which downstream slice IDs the contract is broadcast-ready for. */
  readonly broadcastTo?: readonly string[];
  /** SHA-256 hash of the contract payload (key-sorted, JSON-canonicalized). */
  readonly contractHash: string;
}

export type WriteContractInput = Omit<SliceContract, 'completedAt' | 'contractHash'> & {
  readonly completedAt?: string;
};

/** Thrown when contract IO fails. */
export class ContractStoreError extends Error {
  readonly code = 'CONTRACT_STORE_ERROR' as const;
  constructor(message: string) {
    super(message);
    this.name = 'ContractStoreError';
  }
}

/** Slice 2026-06-23-audit-4th #A3: default TTL for slice contracts. */
export const CONTRACT_TTL_DAYS = 30;

/**
 * Slice 2026-06-23-audit-4th #A3: is this contract an orphan
 * (older than CONTRACT_TTL_DAYS or already GC'd)? Mirrors
 * `isOrphanChannel` and `isOrphanDispatchRecord` so a future
 * `peaks sub-agent cleanup` umbrella can run all three sweeps
 * (shared channel + dispatch record + contract) in one pass.
 */
export function isOrphanContract(opts: {
  projectRoot: string;
  sessionId: string;
  sliceId: string;
  now?: Date;
}): boolean {
  const path = contractPath(opts.projectRoot, opts.sessionId, opts.sliceId);
  if (!existsSync(path)) return true;
  const s = statSync(path);
  const now = opts.now ?? new Date();
  const ageMs = now.getTime() - s.mtimeMs;
  const ttlMs = CONTRACT_TTL_DAYS * 24 * 60 * 60 * 1000;
  return ageMs > ttlMs;
}

/** Resolve the contracts directory for a session. */
export function contractsDir(projectRoot: string, sessionId: string): string {
  return join(projectRoot, '.peaks', '_runtime', sessionId, 'dispatch', 'contracts');
}

/** Resolve a single contract file path. */
export function contractPath(projectRoot: string, sessionId: string, sliceId: string): string {
  return join(contractsDir(projectRoot, sessionId), `${sliceId}.json`);
}

/** Canonicalize a contract for hashing. Keys sorted; arrays preserved. */
function canonicalize(c: WriteContractInput | SliceContract): string {
  const obj: Record<string, unknown> = {
    sliceId: c.sliceId,
    sessionId: c.sessionId,
    exports: [...c.exports].sort(),
    types: [...c.types].sort(),
    publicSignatures: [...c.publicSignatures].sort()
  };
  if ('completedAt' in c && c.completedAt !== undefined) {
    obj.completedAt = c.completedAt;
  }
  if (c.broadcastTo !== undefined) {
    obj.broadcastTo = [...c.broadcastTo].sort();
  }
  return JSON.stringify(obj);
}

/** Hash a contract payload. */
export function hashContract(c: WriteContractInput | SliceContract): string {
  return createHash('sha256').update(canonicalize(c)).digest('hex');
}

/**
 * Persist a slice's public contract. Returns the absolute path on disk.
 * Idempotent: re-writing the same contract overwrites in place.
 */
export function writeContract(
  projectRoot: string,
  sessionId: string,
  input: WriteContractInput
): { path: string; contract: SliceContract } {
  if (!projectRoot || !sessionId) {
    throw new ContractStoreError('projectRoot and sessionId are required');
  }
  if (!input.sliceId || input.sliceId.length === 0) {
    throw new ContractStoreError('sliceId is required');
  }
  if (!Array.isArray(input.exports) || !Array.isArray(input.types) || !Array.isArray(input.publicSignatures)) {
    throw new ContractStoreError('exports, types, publicSignatures must be arrays');
  }
  const completedAt = input.completedAt ?? new Date().toISOString();
  const partial = { ...input, completedAt };
  const contractHash = hashContract(partial);
  const contract: SliceContract = {
    sliceId: input.sliceId,
    sessionId,
    completedAt,
    exports: [...input.exports],
    types: [...input.types],
    publicSignatures: [...input.publicSignatures],
    ...(input.broadcastTo !== undefined ? { broadcastTo: [...input.broadcastTo] } : {}),
    contractHash
  };
  const dir = contractsDir(projectRoot, sessionId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const path = contractPath(projectRoot, sessionId, input.sliceId);
  writeFileSync(path, JSON.stringify(contract, null, 2) + '\n', 'utf8');
  return { path, contract };
}

/** Read a contract from disk. Returns null if missing. */
export function readContract(
  projectRoot: string,
  sessionId: string,
  sliceId: string
): SliceContract | null {
  const path = contractPath(projectRoot, sessionId, sliceId);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8');
    return JSON.parse(raw) as SliceContract;
  } catch (err) {
    throw new ContractStoreError(`failed to parse contract at ${path}: ${(err as Error).message}`);
  }
}

/** List all contracts for a session. */
export function listContracts(projectRoot: string, sessionId: string): readonly SliceContract[] {
  const dir = contractsDir(projectRoot, sessionId);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const out: SliceContract[] = [];
  for (const f of files) {
    const sliceId = f.replace(/\.json$/, '');
    const c = readContract(projectRoot, sessionId, sliceId);
    if (c !== null) out.push(c);
  }
  // Stable order: by sliceId
  return out.sort((a, b) => (a.sliceId < b.sliceId ? -1 : a.sliceId > b.sliceId ? 1 : 0));
}

/**
 * Format a prompt-injection block from a set of contracts. The block is a
 * stable, human-readable summary suitable for splicing into a downstream
 * slice's dispatch prompt.
 */
export function formatContractInjection(contracts: readonly SliceContract[]): string {
  if (contracts.length === 0) return '';
  const blocks: string[] = ['## Ancestor slice contracts (do not import source — use this surface)'];
  for (const c of contracts) {
    blocks.push(
      '',
      `### slice ${c.sliceId} (completed ${c.completedAt}, hash=${c.contractHash.slice(0, 12)})`,
      `- exports: ${c.exports.length === 0 ? '(none)' : c.exports.join(', ')}`,
      `- types: ${c.types.length === 0 ? '(none)' : c.types.join(', ')}`,
      '- publicSignatures:',
      ...(c.publicSignatures.length === 0
        ? ['  - (none)']
        : c.publicSignatures.map((s) => `  - \`${s}\``))
    );
  }
  return blocks.join('\n');
}
