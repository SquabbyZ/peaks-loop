/**
 * 2.7.0 slice-dag-dispatcher MVP (slice 1.2.a) — contract-store tests.
 *
 * Covers AC-4.a / AC-4.b / AC-4.c from the 1.1 PRD.
 *
 * Cross-platform: uses Node's `os.tmpdir()` + `path.join` so the test
 * passes on macOS / Linux / Windows.
 */
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  contractPath,
  contractsDir,
  formatContractInjection,
  listContracts,
  readContract,
  SliceContract,
  writeContract
} from '../../../src/services/dispatch/contract-store.js';

let projectRoot = '';
const sessionId = '2026-06-18-test-session';

beforeAll(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'peaks-contracts-'));
});

afterAll(() => {
  if (projectRoot && existsSync(projectRoot)) {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

const sample = (sliceId: string, sid: string = sessionId): Omit<SliceContract, 'completedAt' | 'contractHash'> => ({
  sliceId,
  sessionId: sid,
  exports: ['validateDag', 'topologicalLevels'],
  types: ['SliceDag', 'SliceNode'],
  publicSignatures: ['validateDag(dag: SliceDag): void', 'topologicalLevels(dag: SliceDag): readonly (readonly string[])[]'],
  broadcastTo: ['slice-B', 'slice-C']
});

describe('contractStore path layout (AC-4.b)', () => {
  it('uses .peaks/_runtime/<sid>/dispatch/contracts/<sliceId>.json', () => {
    const dir = contractsDir(projectRoot, sessionId);
    expect(dir).toBe(join(projectRoot, '.peaks', '_runtime', sessionId, 'dispatch', 'contracts'));
    const path = contractPath(projectRoot, sessionId, 'slice-A');
    expect(path).toBe(join(dir, 'slice-A.json'));
  });
});

describe('writeContract / readContract / listContracts (AC-4.a)', () => {
  it('round-trips a contract through disk', () => {
    const { path, contract } = writeContract(projectRoot, sessionId, sample('slice-A'));
    expect(existsSync(path)).toBe(true);
    const read = readContract(projectRoot, sessionId, 'slice-A');
    expect(read).not.toBeNull();
    expect(read?.sliceId).toBe('slice-A');
    expect(read?.exports).toEqual(['validateDag', 'topologicalLevels']);
    expect(read?.contractHash).toBe(contract.contractHash);
    expect(read?.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns null for unknown sliceId', () => {
    expect(readContract(projectRoot, sessionId, 'missing-slice')).toBeNull();
  });

  it('lists contracts in stable sliceId order', () => {
    writeContract(projectRoot, sessionId, sample('slice-Z'));
    writeContract(projectRoot, sessionId, sample('slice-M'));
    const all = listContracts(projectRoot, sessionId);
    const ids = all.map((c) => c.sliceId);
    const ourIds = ids.filter((id) => ['slice-Z', 'slice-M'].includes(id));
    expect(ourIds).toEqual(['slice-M', 'slice-Z']);
  });

  it('creates the contracts directory on demand', () => {
    const dir = contractsDir(projectRoot, sessionId);
    expect(existsSync(dir)).toBe(true);
    expect(readdirSync(dir).length).toBeGreaterThan(0);
  });
});

describe('hashContract stability (AC-4.c)', () => {
  it('produces the same hash regardless of array ordering of exports / types / signatures', () => {
    // Pin completedAt so two consecutive writeContract calls don't get
    // different ISO timestamps (the hash is content-based, but the
    // content includes completedAt).
    const fixedAt = '2026-06-18T05:00:00.000Z';
    const a = writeContract(projectRoot, sessionId, {
      ...sample('slice-H1'),
      completedAt: fixedAt,
      exports: ['a', 'b', 'c'],
      types: ['T1', 'T2'],
      publicSignatures: ['sig1', 'sig2']
    });
    const b = writeContract(projectRoot, sessionId, {
      ...sample('slice-H1'),
      completedAt: fixedAt,
      exports: ['c', 'a', 'b'],
      types: ['T2', 'T1'],
      publicSignatures: ['sig2', 'sig1']
    });
    expect(a.contract.contractHash).toBe(b.contract.contractHash);
  });

  it('produces different hashes for different payloads', () => {
    const a = writeContract(projectRoot, sessionId, {
      ...sample('slice-D1'),
      completedAt: '2026-06-18T05:00:00.000Z'
    });
    const b = writeContract(projectRoot, sessionId, {
      ...sample('slice-D1'),
      completedAt: '2026-06-18T05:00:00.000Z',
      exports: ['differentExport']
    });
    expect(a.contract.contractHash).not.toBe(b.contract.contractHash);
  });
});

describe('formatContractInjection (AC-4.c)', () => {
  it('produces an empty string for no contracts', () => {
    expect(formatContractInjection([])).toBe('');
  });

  it('produces a stable markdown block with each contract surfaced', () => {
    const { contract: c1 } = writeContract(projectRoot, sessionId, sample('slice-P'));
    const block = formatContractInjection([c1]);
    expect(block).toContain('## Ancestor slice contracts');
    expect(block).toContain(`slice ${c1.sliceId}`);
    expect(block).toContain('validateDag');
    expect(block).toContain('SliceDag');
    expect(block).toContain('hash=');
  });
});

describe('error path', () => {
  it('throws on missing sliceId', () => {
    expect(() =>
      writeContract(projectRoot, sessionId, { ...sample(''), sliceId: '' })
    ).toThrow();
  });
  it('throws when projectRoot or sessionId is empty', () => {
    expect(() => writeContract('', sessionId, sample('x'))).toThrow();
    expect(() => writeContract(projectRoot, '', sample('x'))).toThrow();
  });
});
