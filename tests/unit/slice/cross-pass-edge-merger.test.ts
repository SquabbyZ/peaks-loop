/**
 * Unit tests for CrossPassEdgeMerger (peaks-code/multipass W2 T7).
 *
 * Behavior under test (9 cases from the spec):
 *   1. type-shares        — `import type { Foo } from '../upper/...'` resolves to an upper file.
 *   2. fixture-shares     — a lower test file imports a module that is owned by an upper slice.
 *   3. import-re-export   — `export { Bar } from '../upper/...'` resolves to an upper file.
 *   4. multiple edges     — 2 lower slices each match a different static rule, expect 2 edges.
 *   5. LLM fallback       — no static match, llmRunner returns `{"depends": true, "reason": ...}`,
 *                           expect 1 `llm-arbitrated` edge.
 *   6. budget cap         — 3 ambiguous lower slices, default budget=2, expect ≤2 edges and
 *                           `llmCalls.length === 2`.
 *   7. no llmRunner       — no static match and no llmRunner, expect empty result, no crash.
 *   8. mutation probe A   — comment-out the type-shares detector in the source file
 *                           (search for "kind: 'type-shares'" inside the static branch) and
 *                           the test "detects type-shares between adjacent passes" MUST fail
 *                           with edges.length === 0. This is a meta-assertion: a comment in
 *                           this file points at the implementation line so a future maintainer
 *                           can re-run the probe by hand.
 *   9. directionality     — fromPass/toPass match the source passes (upper.passNumber,
 *                           lower.passNumber).
 *
 * Isolation: projectDir + cacheDir are created in beforeAll/afterAll via os.tmpdir(). The
 * arbitrator budget is reset in beforeEach so the module-level counter never leaks between
 * tests.
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  merge,
} from '../../../src/services/slice/cross-pass-edge-merger.js';
import {
  resetArbitratorBudget,
} from '../../../src/services/slice/llm-arbitrator.js';
import type { LlmRunner } from '../../../src/services/audit/audit-goal-service.js';
import type {
  PassNumber,
  PassResult,
  SliceV2,
} from '../../../src/services/slice/slice-topology-types.js';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function makeSlice(
  overrides: Partial<SliceV2> & Pick<SliceV2, 'id' | 'files'>
): SliceV2 {
  return {
    label: overrides.id,
    granularity: 'file',
    loc: 10,
    parentSliceId: null,
    semanticAnchor: `file:${overrides.files[0] ?? 'unknown'}`,
    ...overrides,
  };
}

function makePass(passNumber: PassNumber, slices: SliceV2[]): PassResult {
  return {
    passNumber,
    granularity: 'file',
    slices,
    internalEdges: [],
  };
}

function writeFile(path: string, content: string): void {
  writeFileSync(path, content);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('CrossPassEdgeMerger.merge', () => {
  let projectDir: string;
  let upperDir: string;
  let lowerDir: string;
  let testsDir: string;
  let sharedCacheDir: string;

  beforeAll(() => {
    projectDir = makeTempDir('cross-pass-edge-test-');
    upperDir = join(projectDir, 'upper');
    lowerDir = join(projectDir, 'lower');
    testsDir = join(projectDir, 'tests');
    mkdirSync(upperDir, { recursive: true });
    mkdirSync(lowerDir, { recursive: true });
    mkdirSync(testsDir, { recursive: true });
    sharedCacheDir = makeTempDir('cross-pass-edge-cache-');
  });

  afterAll(() => {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(sharedCacheDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    resetArbitratorBudget();
  });

  // -------------------------------------------------------------------------
  // 1. type-shares
  // -------------------------------------------------------------------------
  it('detects type-shares between adjacent passes', async () => {
    const upperFile = join(upperDir, 'upper-file.ts');
    writeFile(upperFile, 'export interface Foo { x: number; }\n');

    const lowerFile = join(lowerDir, 'lower-file.ts');
    writeFile(
      lowerFile,
      `import type { Foo } from '../upper/upper-file';\nexport const bar: Foo = { x: 1 };\n`
    );

    const upper = makePass(1, [makeSlice({ id: 'S1', files: [upperFile] })]);
    const lower = makePass(2, [makeSlice({ id: 'S2', files: [lowerFile] })]);

    const result = await merge([upper, lower], {
      projectRoot: projectDir,
      cacheDir: sharedCacheDir,
    });

    expect(result.edges).toHaveLength(1);
    const edge = result.edges[0]!;
    expect(edge.kind).toBe('type-shares');
    expect(edge.confidence).toBe('structural');
    expect(edge.arbitratedBy).toBeNull();
    expect(edge.fromSliceId).toBe('S1');
    expect(edge.toSliceId).toBe('S2');
    expect(result.llmCalls).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 2. fixture-shares
  // -------------------------------------------------------------------------
  it('detects fixture-shares when a lower test file imports an upper fixture', async () => {
    const fixtureFile = join(upperDir, 'fixtures.ts');
    writeFile(fixtureFile, 'export const fixtureData = { token: "abc" };\n');

    const lowerTestFile = join(testsDir, 'lower-test.ts');
    writeFile(
      lowerTestFile,
      `import { fixtureData } from '../upper/fixtures';\n` +
        `test('uses fixture', () => { expect(fixtureData).toBeDefined(); });\n`
    );

    const upper = makePass(1, [makeSlice({ id: 'S1', files: [fixtureFile] })]);
    const lower = makePass(2, [makeSlice({ id: 'S2', files: [lowerTestFile] })]);

    const result = await merge([upper, lower], {
      projectRoot: projectDir,
      cacheDir: sharedCacheDir,
    });

    expect(result.edges).toHaveLength(1);
    const edge = result.edges[0]!;
    expect(edge.kind).toBe('fixture-shares');
    expect(edge.confidence).toBe('structural');
    expect(edge.arbitratedBy).toBeNull();
    expect(edge.fromSliceId).toBe('S1');
    expect(edge.toSliceId).toBe('S2');
  });

  // -------------------------------------------------------------------------
  // 3. import-re-export
  // -------------------------------------------------------------------------
  it('detects import-re-export between adjacent passes', async () => {
    const upperFile = join(upperDir, 'upper-file.ts');
    writeFile(upperFile, 'export const bar = 42;\n');

    const lowerFile = join(lowerDir, 'lower-file.ts');
    writeFile(lowerFile, `export { bar } from '../upper/upper-file';\n`);

    const upper = makePass(1, [makeSlice({ id: 'S1', files: [upperFile] })]);
    const lower = makePass(2, [makeSlice({ id: 'S2', files: [lowerFile] })]);

    const result = await merge([upper, lower], {
      projectRoot: projectDir,
      cacheDir: sharedCacheDir,
    });

    expect(result.edges).toHaveLength(1);
    const edge = result.edges[0]!;
    expect(edge.kind).toBe('import-re-export');
    expect(edge.confidence).toBe('structural');
    expect(edge.arbitratedBy).toBeNull();
    expect(edge.fromSliceId).toBe('S1');
    expect(edge.toSliceId).toBe('S2');
  });

  // -------------------------------------------------------------------------
  // 4. multiple edges across 2 lower slices
  // -------------------------------------------------------------------------
  it('emits multiple edges when 2 lower slices match different static rules', async () => {
    const upperFile1 = join(upperDir, 'upper-file1.ts');
    writeFile(upperFile1, 'export interface X { y: number; }\n');
    const upperFile2 = join(upperDir, 'upper-file2.ts');
    writeFile(upperFile2, 'export const z = 99;\n');

    const lowerFile1 = join(lowerDir, 'lower-file1.ts');
    writeFile(lowerFile1, `import type { X } from '../upper/upper-file1';\n`);
    const lowerFile2 = join(lowerDir, 'lower-file2.ts');
    writeFile(lowerFile2, `export { z } from '../upper/upper-file2';\n`);

    const upper = makePass(1, [
      makeSlice({ id: 'S1', files: [upperFile1, upperFile2] }),
    ]);
    const lower = makePass(2, [
      makeSlice({ id: 'S2.1', files: [lowerFile1] }),
      makeSlice({ id: 'S2.2', files: [lowerFile2] }),
    ]);

    const result = await merge([upper, lower], {
      projectRoot: projectDir,
      cacheDir: sharedCacheDir,
    });

    expect(result.edges).toHaveLength(2);
    const kinds = result.edges.map((e) => e.kind).sort();
    expect(kinds).toEqual(['import-re-export', 'type-shares']);
  });

  // -------------------------------------------------------------------------
  // 5. LLM fallback fires when no static match exists
  // -------------------------------------------------------------------------
  it('falls back to the LLM arbitrator when no static match is found', async () => {
    const unrelatedFile = join(lowerDir, 'unrelated.ts');
    writeFile(unrelatedFile, 'export const lonely = 1;\n');
    const emptyUpperFile = join(upperDir, 'empty.ts');
    writeFile(emptyUpperFile, 'export const nothing = 0;\n');

    const upper = makePass(1, [makeSlice({ id: 'S1', files: [emptyUpperFile] })]);
    const lower = makePass(2, [makeSlice({ id: 'S2', files: [unrelatedFile] })]);

    const llmRunner: LlmRunner = {
      call: vi.fn(async () => ({
        output: '{"depends": true, "reason": "shared schema"}',
        tokens: { input: 10, output: 5 },
      })),
    };

    const cacheDir = makeTempDir('llm-fallback-cache-');

    const result = await merge([upper, lower], {
      projectRoot: projectDir,
      cacheDir,
      llmRunner,
    });

    try {
      expect(vi.mocked(llmRunner.call)).toHaveBeenCalledTimes(1);
      expect(result.edges).toHaveLength(1);
      const edge = result.edges[0]!;
      expect(edge.kind).toBe('llm-arbitrated');
      expect(edge.confidence).toBe('llm');
      expect(edge.arbitratedBy).toMatch(/^live:/);
      expect(edge.fromSliceId).toBe('S1');
      expect(edge.toSliceId).toBe('S2');
      expect(result.llmCalls).toHaveLength(1);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // 6. budget cap enforced when all slices are ambiguous
  // -------------------------------------------------------------------------
  it('respects the LLM budget cap when every lower slice is ambiguous', async () => {
    const lowerFile1 = join(lowerDir, 'lower1.ts');
    writeFile(lowerFile1, 'export const a = 1;\n');
    const lowerFile2 = join(lowerDir, 'lower2.ts');
    writeFile(lowerFile2, 'export const b = 2;\n');
    const lowerFile3 = join(lowerDir, 'lower3.ts');
    writeFile(lowerFile3, 'export const c = 3;\n');
    const emptyUpperFile = join(upperDir, 'empty.ts');
    writeFile(emptyUpperFile, 'export const nothing = 0;\n');

    const upper = makePass(1, [makeSlice({ id: 'S1', files: [emptyUpperFile] })]);
    const lower = makePass(2, [
      makeSlice({ id: 'S2.1', files: [lowerFile1] }),
      makeSlice({ id: 'S2.2', files: [lowerFile2] }),
      makeSlice({ id: 'S2.3', files: [lowerFile3] }),
    ]);

    const llmRunner: LlmRunner = {
      call: vi.fn(async () => ({
        output: '{"depends": true, "reason": "shared"}',
        tokens: { input: 10, output: 5 },
      })),
    };

    const cacheDir = makeTempDir('budget-cap-cache-');

    const result = await merge([upper, lower], {
      projectRoot: projectDir,
      cacheDir,
      llmRunner,
      maxLlmCalls: 2,
    });

    try {
      expect(result.llmCalls).toHaveLength(2);
      expect(result.edges.length).toBeLessThanOrEqual(2);
      expect(vi.mocked(llmRunner.call)).toHaveBeenCalledTimes(2);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // 7. no llmRunner + no static match → empty result, no crash
  // -------------------------------------------------------------------------
  it('returns an empty result when no llmRunner is provided and no static match exists', async () => {
    const lowerFile = join(lowerDir, 'lonely.ts');
    writeFile(lowerFile, 'export const lonely = 1;\n');
    const emptyUpperFile = join(upperDir, 'empty.ts');
    writeFile(emptyUpperFile, 'export const nothing = 0;\n');

    const upper = makePass(1, [makeSlice({ id: 'S1', files: [emptyUpperFile] })]);
    const lower = makePass(2, [makeSlice({ id: 'S2', files: [lowerFile] })]);

    const result = await merge([upper, lower], {
      projectRoot: projectDir,
      cacheDir: sharedCacheDir,
    });

    expect(result.edges).toHaveLength(0);
    expect(result.llmCalls).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 9. directionality — fromPass/toPass reflect upper.passNumber / lower.passNumber
  // -------------------------------------------------------------------------
  it('populates fromPass/toPass with the correct pass numbers (directionality)', async () => {
    const upperFile = join(upperDir, 'upper-dir.ts');
    writeFile(upperFile, 'export interface Y { z: string; }\n');

    const lowerFile = join(lowerDir, 'lower-dir.ts');
    writeFile(lowerFile, `import type { Y } from '../upper/upper-dir';\n`);

    const upper = makePass(1, [makeSlice({ id: 'S1', files: [upperFile] })]);
    const lower = makePass(2, [makeSlice({ id: 'S2', files: [lowerFile] })]);

    const result = await merge([upper, lower], {
      projectRoot: projectDir,
      cacheDir: sharedCacheDir,
    });

    expect(result.edges).toHaveLength(1);
    const edge = result.edges[0]!;
    expect(edge.fromPass).toBe(1);
    expect(edge.toPass).toBe(2);
  });

  // -------------------------------------------------------------------------
  // 10. LlmCallTrace enrichment — live LLM success (W6 T9 fix #3)
  // -------------------------------------------------------------------------
  it('populates promptHash/input/output/confidence on llmCalls when LLM fallback fires', async () => {
    const unrelatedFile = join(lowerDir, 'unrelated-enrich.ts');
    writeFile(unrelatedFile, 'export const lonely = 1;\n');
    const emptyUpperFile = join(upperDir, 'empty-enrich.ts');
    writeFile(emptyUpperFile, 'export const nothing = 0;\n');

    const upper = makePass(1, [
      makeSlice({ id: 'S1', files: [emptyUpperFile] })
    ]);
    const lower = makePass(2, [
      makeSlice({ id: 'S2', files: [unrelatedFile] })
    ]);

    const llmRunner: LlmRunner = {
      call: vi.fn(async () => ({
        output: '{"depends": true, "reason": "shared schema"}',
        tokens: { input: 11, output: 7 }
      }))
    };

    const cacheDir = makeTempDir('llm-enrich-cache-');

    const result = await merge([upper, lower], {
      projectRoot: projectDir,
      cacheDir,
      llmRunner
    });

    try {
      expect(result.llmCalls).toHaveLength(1);
      const trace = result.llmCalls[0]!;
      expect(trace.callId).toMatch(/^live:/);
      // promptHash: 64-char sha256 hex of the prompt string.
      expect(trace.promptHash).toMatch(/^[0-9a-f]{64}$/);
      // input: the actual prompt text sent to arbitrate.
      expect(trace.input).toContain('"S1"');
      expect(trace.input).toContain('"S2"');
      // output: the LLM response.
      expect(trace.output).toBe('{"depends": true, "reason": "shared schema"}');
      // confidence: live success → 'medium'.
      expect(trace.confidence).toBe('medium');
      // tokens: matches the runner.
      expect(trace.tokens).toEqual({ input: 11, output: 7 });
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // 11. LlmCallTrace enrichment — cache hit (medium confidence, promptHash matches)
  // -------------------------------------------------------------------------
  it('marks cache-hit llmCalls with confidence=medium and matches the live promptHash', async () => {
    const unrelatedFile = join(lowerDir, 'unrelated-cache.ts');
    writeFile(unrelatedFile, 'export const lonely = 1;\n');
    const emptyUpperFile = join(upperDir, 'empty-cache.ts');
    writeFile(emptyUpperFile, 'export const nothing = 0;\n');

    const upper = makePass(1, [
      makeSlice({ id: 'S1', files: [emptyUpperFile] })
    ]);
    const lower = makePass(2, [
      makeSlice({ id: 'S2', files: [unrelatedFile] })
    ]);

    const llmRunner: LlmRunner = {
      call: vi.fn(async () => ({
        output: '{"depends": true, "reason": "cached"}',
        tokens: { input: 4, output: 3 }
      }))
    };

    const cacheDir = makeTempDir('llm-cachehit-');

    // First call: warms the cache via the live runner.
    const first = await merge([upper, lower], {
      projectRoot: projectDir,
      cacheDir,
      llmRunner
    });
    expect(first.llmCalls).toHaveLength(1);
    expect(first.llmCalls[0]!.callId).toMatch(/^live:/);
    const warmPromptHash = first.llmCalls[0]!.promptHash;

    // Second call: cache hit. Build a fresh merge that reuses the same
    // upper/lower ids and same cache dir so the prompt is identical.
    const second = await merge([upper, lower], {
      projectRoot: projectDir,
      cacheDir,
      llmRunner
    });

    try {
      expect(second.llmCalls).toHaveLength(1);
      const cacheTrace = second.llmCalls[0]!;
      expect(cacheTrace.callId.startsWith('cache:')).toBe(true);
      // promptHash must match the warm run's hash exactly.
      expect(cacheTrace.promptHash).toBe(warmPromptHash);
      // Recompute independently to double-check the merger.
      const expectedHash = createHash('sha256')
        .update(cacheTrace.input)
        .digest('hex');
      expect(cacheTrace.promptHash).toBe(expectedHash);
      expect(cacheTrace.confidence).toBe('medium');
      expect(cacheTrace.output).toBe('{"depends": true, "reason": "cached"}');
      // Cache hits carry no tokens (per llm-arbitrator.ts).
      expect(cacheTrace.tokens).toBeNull();
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // 12. LlmCallTrace enrichment — failure path (low confidence, empty output)
  //
  // The merger's outer budget gate (`llmCalls.length < maxLlm`) is aligned
  // with the arbitrator's inner budget, so a 'budget-exhausted' callId is
  // hard to surface via the merger's public API. The merger does, however,
  // catch runner errors and surface them as `callId: 'error'` (low
  // confidence, empty output). That exercises the same failure-path branch
  // in `runLlmFallback` as 'budget-exhausted' / 'timeout' would.
  // -------------------------------------------------------------------------
  it("marks failure-path llmCalls with confidence=low and empty output", async () => {
    const unrelatedFile = join(lowerDir, 'unrelated-fail.ts');
    writeFile(unrelatedFile, 'export const lonely = 1;\n');
    const emptyUpperFile = join(upperDir, 'empty-fail.ts');
    writeFile(emptyUpperFile, 'export const nothing = 0;\n');

    const upper = makePass(1, [
      makeSlice({ id: 'S1', files: [emptyUpperFile] })
    ]);
    const lower = makePass(2, [
      makeSlice({ id: 'S2', files: [unrelatedFile] })
    ]);

    const llmRunner: LlmRunner = {
      call: vi.fn(async () => {
        throw new Error('upstream 503');
      })
    };

    const cacheDir = makeTempDir('llm-fail-');

    const result = await merge([upper, lower], {
      projectRoot: projectDir,
      cacheDir,
      llmRunner
    });

    try {
      expect(result.llmCalls).toHaveLength(1);
      const trace = result.llmCalls[0]!;
      expect(trace.callId).toBe('error');
      expect(trace.confidence).toBe('low');
      expect(trace.output).toBe('');
      expect(trace.tokens).toBeNull();
      // promptHash and input are still populated even on failure.
      expect(trace.promptHash).toMatch(/^[0-9a-f]{64}$/);
      expect(trace.input).toContain('"S1"');
      expect(trace.input).toContain('"S2"');
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 8. mutation probe A (meta-assertion, no test body)
//
// To exercise the probe by hand:
//   1. Open src/services/slice/cross-pass-edge-merger.ts
//   2. Comment out the block that emits CrossPassEdge with `kind: 'type-shares'`
//      inside the per-file static-detection loop (search for `kind: 'type-shares'`).
//   3. Run `./node_modules/.bin/vitest run tests/unit/slice/cross-pass-edge-merger.test.ts`
//   4. The "detects type-shares between adjacent passes" test MUST fail with
//      `edges.length === 0` (instead of the expected 1). Restore the block to re-green.
// ---------------------------------------------------------------------------