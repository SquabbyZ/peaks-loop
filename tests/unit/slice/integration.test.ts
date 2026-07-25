/**
 * Integration test for MultiPassOrchestrator + slice-decompose-service across
 * real service boundaries (peaks-code/multipass W2 T9 — integration gap).
 *
 * This test closes a small coverage gap: the existing
 * `multi-pass-orchestrator.test.ts` mocks `decomposeSlices` and `merge`, so it
 * cannot verify that the orchestrator + 6-stage algorithm + cross-pass edge
 * merger cooperate correctly when run end-to-end against a real-shaped
 * project. The earlier gap-closure checklist asks for "an integration test
 * against src/services/config/ + src/services/memory/ that the multipass
 * decomposition produces correct topological order across service
 * boundaries."
 *
 * What this test verifies (6 cases):
 *
 *   1. Real runners (codegraph/understand/importEdge) inject against the
 *      orchestrator's `decompose()` — no module-level mocking of
 *      `decomposeSlices` / `merge`.
 *   2. Pass 1 produces 2 slices, each tagged granularity='service' by the
 *      orchestrator; the slices' file-sets are disjoint and together cover
 *      the AC-targeted files.
 *   3. Pass 2 (file-level) subdivides each Pass 1 slice; every Pass 2
 *      slice's `files` set is a subset of its parent's `files` set
 *      (the surgical scope-filter invariant from
 *      `filterWorkUnitsByScope`).
 *   4. `decompose()` returns a v2 envelope: `schemaVersion: 'v2'`,
 *      `partial: false`, ≥2 passes.
 *   5. Topological order: every Pass 2 slice's `parentSliceId` matches the
 *      Pass 1 slice whose scope contains ALL of the Pass 2 slice's files.
 *      No cross-service collapse happens — a Pass 2 child of the memory
 *      service has files only under src/services/memory/, and a Pass 2
 *      child of the config service has files only under
 *      src/services/config/.
 *   6. With granularity='file' (no Pass 1) there is exactly 1 pass and no
 *      cross-pass edges (single-pass flows don't have anything to bridge).
 *
 * Note on cross-pass edges: the static cross-pass detector reads each
 * Pass 2 slice's files from disk and looks for `import type`,
 * `export ... from`, and test-file imports. Because each Pass 1 work-unit
 * in this fixture is single-file (the 6-stage algorithm produces one WU
 * per AC, each with `files: [singleFile]`), Pass 2's scope filter yields
 * file-sets that match the parent exactly — no cross-service importer
 * file is ever inside a Pass 2 slice. Therefore no static cross-pass
 * edge is detected in this fixture. This is the correct behaviour for
 * single-file-scope parents and is itself an integration invariant:
 * the orchestrator does not invent edges that the static detector
 * cannot see on disk.
 *
 * Non-goals:
 *   - We do NOT spawn a real `npx codegraph` shell-out. The runners are
 *     fakes, but `decomposeSlices` itself is the real 6-stage algorithm
 *     (not mocked). This isolates the integration seam to "the
 *     orchestrator + the algorithm + the merger talking to each other".
 *   - We do NOT exercise the LLM fallback path (`llmRunner`); the
 *     topological invariant can be proved via file scoping alone.
 *
 * Style: matches sibling slice tests (schema-router.test.ts,
 * cross-pass-edge-merger.test.ts) — header docstring + real-fs temp
 * dirs + projectRoot passed as a tmp path; no global module mocking.
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { decompose } from '../../../src/services/slice/multi-pass-orchestrator.js';
import type {
  CodegraphAffectedResult,
  CodegraphQueryHit,
  CodegraphRunner,
  ImportEdge,
  ImportEdgeRunner,
  KnowledgeGraph,
  UnderstandRunner
} from '../../../src/services/slice/slice-decompose-types.js';
import { resetArbitratorBudget } from '../../../src/services/slice/llm-arbitrator.js';
// Note: cross-pass-edge-merger.merge is NOT mocked. This test exercises the
// real merger so the integration seam is end-to-end (orchestrator + 6-stage
// algorithm + cross-pass edge merger talking to each other).

// ---------------------------------------------------------------------------
// Fixture: a minimal-but-real-shaped project tree with two services.
//   src/services/config/config-types.ts         (low-level types, no deps)
//   src/services/config/config-service.ts       (imports config-types)
//   src/services/config/config-migration.ts     (imports config-service)
//   src/services/memory/project-memory-types.ts (low-level types)
//   src/services/memory/project-memory-service.ts
//     (imports project-memory-types AND config-types — the cross-service import)
// ---------------------------------------------------------------------------

const SERVICE_FILES: Record<string, string> = {
  'src/services/config/config-types.ts':
    "export type ConfigLayer = 'user' | 'project' | 'workspace';",
  'src/services/config/config-service.ts': [
    "import type { ConfigLayer } from './config-types.js';",
    "export function readConfig(): { layer: ConfigLayer } { return { layer: 'user' }; }"
  ].join('\n'),
  'src/services/config/config-migration.ts': [
    "import { readConfig } from './config-service.js';",
    "export function migrate() { return readConfig(); }"
  ].join('\n'),
  'src/services/memory/project-memory-types.ts':
    "export type MemoryKind = 'project' | 'rule' | 'decision';",
  'src/services/memory/project-memory-service.ts': [
    "import type { ConfigLayer } from '../config/config-types.js';",
    "import type { MemoryKind } from './project-memory-types.js';",
    "export function extract(layer: ConfigLayer, kind: MemoryKind) {",
    "  return { layer, kind };",
    "}"
  ].join('\n')
};

const SERVICE_FILE_LIST = Object.keys(SERVICE_FILES);

// Two acceptance criteria: one per service. Each AC is matched to a
// service file via matchAcToHit (first hit whose basename is a substring
// of the AC). AC1 contains "config-types" → seeds config-types.ts;
// AC2 contains "project-memory-service" → seeds project-memory-service.ts.
// These are the Pass 1 work-units; Pass 2 then re-runs on each scope.
const PRD_MARKDOWN = [
  '# Slice topology test PRD',
  '',
  '## Acceptance Criteria',
  '',
  '- Refactor config-types module into a separate file',
  '- Extract project-memory-service from the existing memory helpers',
  ''
].join('\n');

// ---------------------------------------------------------------------------
// Runner builders
// ---------------------------------------------------------------------------

function buildCodegraphRunner(): CodegraphRunner {
  const allFiles: readonly CodegraphQueryHit[] = SERVICE_FILE_LIST.map(
    (filePath) => ({
      id: `file:${filePath}`,
      kind: 'file',
      name: filePath.split('/').pop() ?? filePath,
      filePath,
      score: 1,
      loc: 50
    })
  );

  return {
    async status() {
      return {
        indexed: true,
        nodes: allFiles.length,
        edges: 4,
        dbMB: 0.1,
        freshness: 'indexed'
      };
    },
    async query(text: string) {
      const needle = text.toLowerCase();
      if (needle.includes('config')) {
        return allFiles.filter((f) =>
          f.filePath.startsWith('src/services/config/')
        );
      }
      if (needle.includes('memory')) {
        return allFiles.filter((f) =>
          f.filePath.startsWith('src/services/memory/')
        );
      }
      // Fallback: return everything (the 6-stage algorithm will dedupe).
      return allFiles;
    },
    async affected(
      _files: readonly string[]
    ): Promise<CodegraphAffectedResult> {
      return {
        changedFiles: [],
        affectedTests: [],
        totalDependentsTraversed: 0
      };
    }
  };
}

function buildUnderstandRunner(): UnderstandRunner {
  return {
    async read(): Promise<KnowledgeGraph | null> {
      return {
        nodes: SERVICE_FILE_LIST.map((filePath) => ({
          id: `file:${filePath}`,
          type: 'file',
          name: filePath,
          filePath
        })),
        edges: [],
        layers: [
          {
            id: 'config',
            name: 'config',
            nodeIds: SERVICE_FILE_LIST.filter((f) =>
              f.startsWith('src/services/config/')
            ).map((f) => `file:${f}`)
          },
          {
            id: 'memory',
            name: 'memory',
            nodeIds: SERVICE_FILE_LIST.filter((f) =>
              f.startsWith('src/services/memory/')
            ).map((f) => `file:${f}`)
          }
        ]
      };
    }
  };
}

function buildImportEdgeRunner(): ImportEdgeRunner {
  return {
    async importsOf(
      _projectRoot: string,
      files: readonly string[]
    ): Promise<readonly ImportEdge[]> {
      const out: ImportEdge[] = [];
      for (const f of files) {
        const content = SERVICE_FILES[f];
        if (!content) continue;
        const lines = content.split('\n');
        for (const line of lines) {
          const m = line.match(/from\s+'([^']+)'/);
          if (!m) continue;
          const target = m[1]!;
          const dir = f.split('/').slice(0, -1).join('/');
          const resolved =
            target.startsWith('.') === false
              ? target
              : normalize(join(dir, target));
          out.push({ from: f, to: resolved, evidence: line.trim() });
        }
      }
      return out;
    }
  };
}

// Tiny POSIX-ish path normaliser for the test fixture.
function normalize(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+/g, '/');
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('MultiPassOrchestrator integration across service boundaries', () => {
  let projectRoot: string;

  beforeAll(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'slice-integration-'));
    for (const [relPath, content] of Object.entries(SERVICE_FILES)) {
      const abs = join(projectRoot, relPath);
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, content, 'utf8');
    }
  });

  afterAll(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    resetArbitratorBudget();
  });

  // -------------------------------------------------------------------------
  // 1. End-to-end decompose() with real runners + real decomposeSlices +
  //    real cross-pass-edge-merger (no module-level mocking).
  // -------------------------------------------------------------------------
  it('decompose() runs end-to-end with injected runners and emits a v2 envelope', async () => {
    const result = await decompose('rid-int-1', PRD_MARKDOWN, projectRoot, {
      granularity: 'both',
      codegraphRunner: buildCodegraphRunner(),
      understandRunner: buildUnderstandRunner(),
      importEdgeRunner: buildImportEdgeRunner()
    });

    expect(result.schemaVersion).toBe('v2');
    expect(result.partial).toBe(false);
    expect(result.passes.length).toBeGreaterThanOrEqual(2);
  });

  // -------------------------------------------------------------------------
  // 2. Pass 1 produces 2 service-level slices whose file-sets are disjoint.
  //    Each AC seeds one work-unit; the orchestrator labels them
  //    granularity='service'.
  // -------------------------------------------------------------------------
  it('Pass 1 produces 2 disjoint service-level slices, one per AC', async () => {
    const result = await decompose('rid-int-2', PRD_MARKDOWN, projectRoot, {
      granularity: 'service',
      codegraphRunner: buildCodegraphRunner(),
      understandRunner: buildUnderstandRunner(),
      importEdgeRunner: buildImportEdgeRunner()
    });

    expect(result.passes).toHaveLength(1);
    const pass1 = result.passes[0]!;
    expect(pass1.passNumber).toBe(1);
    expect(pass1.granularity).toBe('service');
    expect(pass1.slices).toHaveLength(2);

    const allFilesInPass1 = new Set<string>();
    for (const slice of pass1.slices) {
      for (const f of slice.files) {
        expect(
          allFilesInPass1.has(f),
          `file ${f} appears in two slices`
        ).toBe(false);
        allFilesInPass1.add(f);
      }
    }
    // Each seed file must be present exactly once across the two slices.
    expect(allFilesInPass1.has('src/services/config/config-types.ts')).toBe(true);
    expect(allFilesInPass1.has('src/services/memory/project-memory-service.ts')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 3. Pass 2 (file-level) subdivides each Pass 1 slice; every Pass 2
  //    slice's `files` set is a subset of its parent's `files` set.
  // -------------------------------------------------------------------------
  it('Pass 2 slices are scoped strictly under their Pass 1 parent', async () => {
    const result = await decompose('rid-int-3', PRD_MARKDOWN, projectRoot, {
      granularity: 'both',
      codegraphRunner: buildCodegraphRunner(),
      understandRunner: buildUnderstandRunner(),
      importEdgeRunner: buildImportEdgeRunner()
    });

    // 1 Pass 1 + at least 1 Pass 2 per parent.
    expect(result.passes.length).toBeGreaterThanOrEqual(2);
    const pass1 = result.passes[0]!;
    const parentById = new Map(pass1.slices.map((s) => [s.id, s] as const));

    for (const pass of result.passes.slice(1)) {
      expect(pass.passNumber).toBe(2);
      expect(pass.granularity).toBe('file');
      for (const slice of pass.slices) {
        const parentId = slice.parentSliceId;
        expect(
          parentId,
          `Pass 2 slice ${slice.id} has null parent`
        ).not.toBeNull();
        const parent = parentById.get(parentId!);
        expect(
          parent,
          `Pass 2 slice ${slice.id} references unknown parent ${parentId}`
        ).toBeDefined();
        const parentFiles = new Set(parent!.files);
        for (const f of slice.files) {
          expect(
            parentFiles.has(f),
            `Pass 2 slice ${slice.id} file ${f} not in parent scope`
          ).toBe(true);
        }
      }
    }
  });

  // -------------------------------------------------------------------------
  // 4. Topological order: Pass 2 children stay inside their parent's file
  //    scope. The config service subtree never contains a memory file,
  //    and the memory service subtree never contains a config file.
  //    This is the "produces correct topological order across service
  //    boundaries" guarantee — cross-service imports do NOT collapse the
  //    two services into a single parent.
  // -------------------------------------------------------------------------
  it('cross-service imports do not collapse Pass 2 children across boundaries', async () => {
    const result = await decompose('rid-int-4', PRD_MARKDOWN, projectRoot, {
      granularity: 'both',
      codegraphRunner: buildCodegraphRunner(),
      understandRunner: buildUnderstandRunner(),
      importEdgeRunner: buildImportEdgeRunner()
    });

    const configParent = result.passes[0]!.slices.find((s) =>
      s.files.includes('src/services/config/config-types.ts')
    );
    const memoryParent = result.passes[0]!.slices.find((s) =>
      s.files.includes('src/services/memory/project-memory-service.ts')
    );
    expect(configParent, 'config parent slice missing').toBeDefined();
    expect(memoryParent, 'memory parent slice missing').toBeDefined();

    // Strong invariant: every Pass 2 child whose parent is the config
    // service has files that start with src/services/config/, and every
    // Pass 2 child of the memory service has files that start with
    // src/services/memory/. No collapse, no spillover.
    for (const slice of result.passes
      .slice(1)
      .flatMap((p) => p.slices)) {
      if (slice.parentSliceId === configParent!.id) {
        for (const f of slice.files) {
          expect(
            f.startsWith('src/services/config/'),
            `Pass 2 slice ${slice.id} parented under config but contains non-config file ${f}`
          ).toBe(true);
        }
      } else if (slice.parentSliceId === memoryParent!.id) {
        for (const f of slice.files) {
          expect(
            f.startsWith('src/services/memory/'),
            `Pass 2 slice ${slice.id} parented under memory but contains non-memory file ${f}`
          ).toBe(true);
        }
      }
    }

    // No static cross-pass edges in this fixture (single-file Pass 1
    // scopes never include the cross-service importer). The merger is
    // wired and exercised — it just has nothing to bridge.
    expect(result.crossPassEdges).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 5. internalEdges in Pass 1 and Pass 2 carry the same EdgeKind union
  //    (imports | calls | depends_on | contains_flow | flow_step) — proves
  //    that the v1→v2 edge mapping (v1EdgesToV2) round-trips through the
  //    real 6-stage algorithm + orchestrator.
  // -------------------------------------------------------------------------
  it('internalEdges survive the v1→v2 round-trip through the real algorithm', async () => {
    const result = await decompose('rid-int-5', PRD_MARKDOWN, projectRoot, {
      granularity: 'both',
      codegraphRunner: buildCodegraphRunner(),
      understandRunner: buildUnderstandRunner(),
      importEdgeRunner: buildImportEdgeRunner()
    });

    const allowedKinds = new Set([
      'imports',
      'calls',
      'depends_on',
      'contains_flow',
      'flow_step'
    ]);
    for (const pass of result.passes) {
      for (const edge of pass.internalEdges) {
        expect(
          allowedKinds.has(edge.kind),
          `pass ${pass.passNumber} internal edge ${edge.from}→${edge.to} has unknown kind ${edge.kind}`
        ).toBe(true);
        expect(['structural', 'semantic']).toContain(edge.confidence);
      }
    }
  });

  // -------------------------------------------------------------------------
  // 6. With granularity='file' (no Pass 1) there is exactly 1 pass and no
  //    cross-pass edges (single-pass flows don't have anything to bridge).
  // -------------------------------------------------------------------------
  it("granularity='file' yields a single pass and no cross-pass edges", async () => {
    const result = await decompose('rid-int-6', PRD_MARKDOWN, projectRoot, {
      granularity: 'file',
      codegraphRunner: buildCodegraphRunner(),
      understandRunner: buildUnderstandRunner(),
      importEdgeRunner: buildImportEdgeRunner()
    });

    expect(result.passes).toHaveLength(1);
    expect(result.passes[0]!.passNumber).toBe(2);
    expect(result.crossPassEdges).toHaveLength(0);
    expect(result.llmArbitrations).toHaveLength(0);
  });
});