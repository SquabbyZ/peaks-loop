import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deserializeLease,
  finalizeLease,
  isLeaseActive,
  isLeaseGcEligible,
  leaseFilePath,
  leaseStoreDir,
  listLeasesSync,
  markReleased,
  recordConsumption,
  renewLease,
  serializeLease,
  ttlForRole
} from '../../worktree/worktree-lease.js';
import type { WorktreeLeaseDraft } from '../../worktree/worktree-lease.js';
import type { GuardContext, GuardRunResult } from '../types.js';
import {
  combineProbes,
  fail,
  missingSourceFiles,
  pass,
  probe,
  requireBaselineRow
} from './_shared.js';

const NOW = 1_700_000_000_000;

const DRAFT: WorktreeLeaseDraft = {
  leaseId: '0123456789abcdef',
  rid: '2026-09-15-s1-gate-contracts-honest',
  role: 'rd',
  path: 'C:/tmp/worktrees/0123456789abcdef',
  branch: 'peaks/guard-J12',
  createdAt: NOW - 1000,
  expiresAt: NOW + 60_000,
  purpose: 'J12 guard probe'
};

/**
 * Behavioural probe of the lease lifecycle.
 *
 * The previous version passed if one of four worktree/dispatch files mentioned
 * both "lease" and "release" — `worktree-lease.ts` satisfies that from its own
 * filename.
 *
 * Here the real pure module is driven: a fresh lease must be active, releasing
 * twice must be a no-op, a duplicate consumption must not append, an in-flight
 * lease must never be gc-eligible, and a persisted lease must survive a
 * serialize/deserialize round trip.
 */
export async function runJ12Contract(ctx: GuardContext): Promise<GuardRunResult> {
  const row = requireBaselineRow(ctx);
  const missing = missingSourceFiles(ctx, row);

  const lease = finalizeLease(DRAFT);
  const onceReleased = markReleased(lease);
  const twiceReleased = markReleased(onceReleased);
  const consumed = recordConsumption(lease, 'batch-1');
  const consumedTwice = recordConsumption(consumed, 'batch-1');
  const renewed = renewLease(onceReleased, NOW + 120_000);

  const root = mkdtempSync(join(tmpdir(), 'cbl-J12-'));
  try {
    const storeDir = leaseStoreDir(root);
    const missingStore = listLeasesSync(storeDir, {
      readdir: readdirSync,
      readFile: (p) => readFileSync(p, 'utf8'),
      existsSync
    });
    mkdirSync(storeDir, { recursive: true });
    writeFileSync(leaseFilePath(root, lease.leaseId), serializeLease(lease));
    const listed = listLeasesSync(storeDir, {
      readdir: readdirSync,
      readFile: (p) => readFileSync(p, 'utf8'),
      existsSync
    });

    const result = combineProbes([
      probe(missing.length === 0, `baseline sourceFiles present (${row.sourceFiles.length})`),
      probe(
        lease.status === 'active' && lease.consumedBySubAgents.length === 0,
        'a fresh lease is active with no consumers'
      ),
      probe(
        leaseStoreDir(root).replace(/\\/g, '/').endsWith('/worktree-leases'),
        `leases live under the session worktree-leases dir (${leaseStoreDir(root)})`
      ),
      probe(
        missingStore.kind === 'store-missing',
        'an absent lease store is reported, not invented'
      ),
      probe(
        listed.kind === 'ok' && listed.leases.length === 1,
        `a persisted lease is listed back (${listed.kind === 'ok' ? String(listed.leases.length) : listed.kind})`
      ),
      probe(
        JSON.stringify(deserializeLease(serializeLease(lease))) === JSON.stringify(lease),
        'serialize/deserialize round-trips the lease'
      ),
      probe(onceReleased.status === 'released', 'release moves the lease to released'),
      probe(
        JSON.stringify(twiceReleased) === JSON.stringify(onceReleased),
        'a duplicate release is a no-op'
      ),
      probe(
        JSON.stringify(consumedTwice) === JSON.stringify(consumed) &&
          consumed.consumedBySubAgents.length === 1,
        'a duplicate consumption is not appended twice'
      ),
      probe(
        renewed.status === 'active' && renewed.expiresAt === NOW + 120_000,
        'renew extends expiry and returns the lease to active'
      ),
      probe(isLeaseActive(lease, NOW), 'an unexpired active lease is in flight'),
      probe(!isLeaseGcEligible(lease, NOW), 'gc is NOT eligible for an in-flight lease'),
      probe(isLeaseGcEligible(onceReleased, NOW), 'a released lease is gc-eligible'),
      probe(
        isLeaseGcEligible(finalizeLease({ ...DRAFT, expiresAt: NOW - 1 }), NOW),
        'an expired lease is gc-eligible'
      ),
      probe(
        ttlForRole('rd') > 0 && ttlForRole('no-such-role') === ttlForRole('rd'),
        'unknown roles fall back to the rd TTL'
      )
    ]);

    const artifact = row.sourceFiles[0] ?? 'src/services/worktree/worktree-lease.ts';
    if (result.ok) return pass(ctx, artifact);
    return fail(
      ctx,
      artifact,
      'the lease lifecycle is complete: release is idempotent and gc never touches an in-flight lease',
      result.detail,
      'J12 invariant broken: the lease release lifecycle or its gc guard no longer holds'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
