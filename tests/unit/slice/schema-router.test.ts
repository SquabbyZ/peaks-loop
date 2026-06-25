/**
 * Unit tests for schema-router.ts.
 *
 * The router reads a `DecompositionResult` JSON file from disk and dispatches
 * to v1 (no `schemaVersion` field) or v2 (`schemaVersion: 'v2'`) parsers based
 * on the discriminator. It also writes the result back to disk, preserving
 * the version marker.
 *
 * RED phase: import target `schema-router.ts` does not exist yet — tests fail
 * with a module-resolution error. GREEN phase: every case below passes.
 *
 * Tests use real fs via `os.tmpdir()` (no mock of `node:fs`) so the round-trip
 * cases exercise the actual `writeFileSync` / `readFileSync` plumbing.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  readResult,
  writeResult,
  UnknownSchemaVersionError
} from '../../../src/services/slice/schema-router.js';
import type { DecompositionResult } from '../../../src/services/slice/slice-decompose-types.js';
import type { DecompositionResultV2 } from '../../../src/services/slice/slice-topology-types.js';

describe('schema-router', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'schema-router-test-'));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // Case 1: v1 file (no schemaVersion field) → readResult returns DecompositionResult.
  it('readResult on a v1 file (no schemaVersion field) returns the parsed object', () => {
    const v1: DecompositionResult = {
      rid: 'rid-v1',
      generatedAt: '2026-06-20T00:00:00.000Z',
      codegraph: { nodes: 0, edges: 0, dbMB: 0, freshness: 'unindexed', affectedCrossFile: false, note: '' },
      understandAnything: { kgNodes: 0, kgEdges: 0, available: false, fallback: 'structural-only', note: '' },
      workUnits: [
        { id: 'W1', label: 'w1', files: ['a.ts'], loc: 10, testsAdded: 0, filePath: 'a.ts', candidates: [] }
      ],
      dependencyDAG: { edges: [] },
      sccAnalysis: { sccCount: 1, trivialSCCs: ['W1'], nonTrivialSCCs: [], condensationEdges: 0 },
      criticalPath: { nodes: ['W1'], edges: [], totalLoc: 10, totalDeltaLoc: 0, rationale: '' },
      minCutResult: { algorithm: 'stoer-wagner', cutEdges: [], partitions: [] },
      parallelBatches: [{ batch: 1, dependsOn: [], slices: [], parallelizableWithinBatch: true }]
    };

    const filePath = join(tmpDir, 'v1-read.json');
    writeFileSync(filePath, JSON.stringify(v1), 'utf8');

    const result = readResult(filePath);
    expect(result).toEqual(v1);
    // v1 must NOT carry a schemaVersion field.
    expect((result as { schemaVersion?: unknown }).schemaVersion).toBeUndefined();
  });

  // Case 2: v2 file → readResult returns DecompositionResultV2.
  it('readResult on a v2 file (schemaVersion v2) returns the parsed object', () => {
    const v2: DecompositionResultV2 = {
      schemaVersion: 'v2',
      rid: 'rid-v2',
      generatedAt: '2026-06-20T00:00:00.000Z',
      passes: [
        {
          passNumber: 1,
          granularity: 'service',
          slices: [
            {
              id: 'S1',
              label: 's1',
              granularity: 'service',
              files: ['a.ts'],
              loc: 10,
              parentSliceId: null,
              semanticAnchor: 'file:a.ts'
            }
          ],
          internalEdges: []
        }
      ],
      crossPassEdges: [],
      llmArbitrations: [],
      codegraph: { nodes: 0, edges: 0, dbMB: 0, freshness: 'unindexed', affectedCrossFile: false, note: '' },
      understandAnything: { kgNodes: 0, kgEdges: 0, available: false, fallback: 'structural-only', note: '' },
      partial: false
    };

    const filePath = join(tmpDir, 'v2-read.json');
    writeFileSync(filePath, JSON.stringify(v2), 'utf8');

    const result = readResult(filePath);
    expect(result).toEqual(v2);
    expect((result as DecompositionResultV2).schemaVersion).toBe('v2');
  });

  // Case 3: write then read round-trip — v2 object survives intact.
  it('writeResult then readResult preserves a v2 object intact', () => {
    const v2: DecompositionResultV2 = {
      schemaVersion: 'v2',
      rid: 'rid-v2-rt',
      generatedAt: '2026-06-20T01:00:00.000Z',
      passes: [
        {
          passNumber: 1,
          granularity: 'file',
          slices: [
            {
              id: 'S1',
              label: 'slice one',
              granularity: 'file',
              files: ['x.ts', 'y.ts'],
              loc: 42,
              parentSliceId: null,
              semanticAnchor: 'domain:foo'
            }
          ],
          internalEdges: [
            {
              from: 'S1',
              to: 'S1',
              kind: 'imports',
              weight: 10,
              evidence: 'import y from "./y"',
              confidence: 'structural'
            }
          ]
        }
      ],
      crossPassEdges: [],
      llmArbitrations: [],
      codegraph: { nodes: 1, edges: 1, dbMB: 0.1, freshness: 'unindexed', affectedCrossFile: false, note: '' },
      understandAnything: { kgNodes: 0, kgEdges: 0, available: false, fallback: 'structural-only', note: '' },
      partial: false
    };

    const filePath = join(tmpDir, 'v2-roundtrip.json');
    writeResult(filePath, v2);
    const read = readResult(filePath);
    expect(read).toEqual(v2);
    expect((read as DecompositionResultV2).schemaVersion).toBe('v2');
  });

  // Case 4: write then read round-trip — v1 object survives intact.
  it('writeResult then readResult preserves a v1 object intact', () => {
    const v1: DecompositionResult = {
      rid: 'rid-v1-rt',
      generatedAt: '2026-06-20T02:00:00.000Z',
      codegraph: { nodes: 0, edges: 0, dbMB: 0, freshness: 'unindexed', affectedCrossFile: false, note: '' },
      understandAnything: { kgNodes: 0, kgEdges: 0, available: false, fallback: 'structural-only', note: '' },
      workUnits: [],
      dependencyDAG: { edges: [] },
      sccAnalysis: { sccCount: 0, trivialSCCs: [], nonTrivialSCCs: [], condensationEdges: 0 },
      criticalPath: { nodes: [], edges: [], totalLoc: 0, totalDeltaLoc: 0, rationale: '' },
      minCutResult: { algorithm: 'stoer-wagner', cutEdges: [], partitions: [] },
      parallelBatches: []
    };

    const filePath = join(tmpDir, 'v1-roundtrip.json');
    writeResult(filePath, v1);
    const read = readResult(filePath);
    expect(read).toEqual(v1);
    expect((read as { schemaVersion?: unknown }).schemaVersion).toBeUndefined();
  });

  // Case 5: unknown schemaVersion → throws UnknownSchemaVersionError with the right code.
  it('readResult on an unknown schemaVersion throws UnknownSchemaVersionError', () => {
    const unknown = {
      schemaVersion: 'v3',
      rid: 'rid-v3'
    };
    const filePath = join(tmpDir, 'unknown-version.json');
    writeFileSync(filePath, JSON.stringify(unknown), 'utf8');

    expect(() => readResult(filePath)).toThrow(UnknownSchemaVersionError);
    try {
      readResult(filePath);
      // unreachable — force failure if throw didn't fire.
      expect.fail('expected readResult to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownSchemaVersionError);
      expect((err as UnknownSchemaVersionError).code).toBe('UNKNOWN_SCHEMA_VERSION');
      expect((err as Error).message).toContain('v3');
    }
  });

  // Case 6: UnknownSchemaVersionError is a proper Error subclass and an instance of itself.
  it('UnknownSchemaVersionError is instanceof Error and instanceof itself', () => {
    const err = new UnknownSchemaVersionError('boom');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(UnknownSchemaVersionError);
    expect(err.name).toBe('UnknownSchemaVersionError');
    expect(err.code).toBe('UNKNOWN_SCHEMA_VERSION');
    expect(err.message).toBe('boom');
  });
});