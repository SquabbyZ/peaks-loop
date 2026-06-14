/**
 * Slice Decomposition Service -- the 6-stage pure algorithm.
 *
 * See `.peaks/_runtime/2026-06-13-session-86d852/sc/slice-algorithm-design.md`
 * for the full spec, and `slice-decompose-types.ts` for all input/output
 * type contracts.
 *
 * Public surface (one exported function):
 *
 *   decomposeSlices(rid, prdMarkdown, projectRoot, options)
 *
 * Default runners (CLI-mode, real shell-outs):
 *
 *   defaultCodegraphRunner()  -- spawns `npx codegraph <cmd>`
 *   defaultUnderstandRunner() -- reads .understand-anything/knowledge-graph.json
 *   defaultImportEdgeRunner() -- reads source files for import statements
 *
 * Tests inject fakes via the `codegraphRunner`, `understandRunner`, and
 * `importEdgeRunner` fields of `DecomposeOptions`.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, dirname, basename } from 'node:path';
import { calibrate } from './calibration-store.js';
import type {
  CodegraphAffectedResult,
  CodegraphQueryHit,
  CodegraphRunner,
  DecomposeOptions,
  DecompositionResult,
  DependencyEdge,
  ImportEdge,
  ImportEdgeRunner,
  KnowledgeGraph,
  MinCutEdge,
  MinCutPartition,
  MinCutResult,
  ParallelBatch,
  SccAnalysis,
  SliceCandidate,
  UnderstandAnythingEnvelope,
  UnderstandRunner,
  WorkUnit
} from './slice-decompose-types.js';

export type { DecomposeOptions };

// =====================================================================
// PUBLIC: decomposeSlices (the 6-stage pure algorithm)
// =====================================================================

export async function decomposeSlices(
  rid: string,
  prdMarkdown: string,
  projectRoot: string,
  options: DecomposeOptions = {}
): Promise<DecompositionResult> {
  const cg = options.codegraphRunner ?? defaultCodegraphRunner();
  const ur = options.understandRunner ?? defaultUnderstandRunner();
  const ier = options.importEdgeRunner ?? defaultImportEdgeRunner();

  // ---------- Stage 0: Validate codegraph ----------
  const cgStatus = await cg.status(projectRoot);
  if (!cgStatus.indexed) {
    throw new Error(
      'peaks codegraph not initialised on this project. ' +
        'Run `npx codegraph init` then `npx codegraph index` in ' +
        projectRoot +
        ' before invoking `peaks slice decompose`.'
    );
  }

  // ---------- Read understand-anything ----------
  const kg = await ur.read(projectRoot);
  const understandAvailable = kg !== null;

  // ---------- Stage 1: Work-unit resolution ----------
  const acs = extractAcceptanceCriteria(prdMarkdown);
  let workUnits = await resolveWorkUnits(rid, acs, cg, projectRoot);

  // ---------- Stage 2: Dependency DAG ----------
  const explicitFiles = workUnits.flatMap((w) => w.files);
  const probeImports = await ier.importsOf(projectRoot, explicitFiles);
  const fileSet = new Set<string>(explicitFiles);
  for (const e of probeImports) {
    fileSet.add(e.from);
    fileSet.add(e.to);
  }
  const allFiles = Array.from(fileSet);

  // If no ACs but the import graph has files, create implicit WUs (one per file).
  // This is the fallback path for the chain/diamond test cases.
  if (workUnits.length === 0 && allFiles.length > 0) {
    workUnits = allFiles.map((file, i) => ({
      id: `F${i + 1}`,
      label: basename(file),
      files: [file],
      loc: 110,
      testsAdded: 0,
      filePath: file,
      candidates: [`file:${file}`]
    }));
  }

  let codegraphAffectedCrossFile = false;
  if (allFiles.length > 0) {
    try {
      const aff = await cg.affected(allFiles, projectRoot);
      codegraphAffectedCrossFile = aff.totalDependentsTraversed > 0;
    } catch {
      codegraphAffectedCrossFile = false;
    }
  }
  const importEdges = await ier.importsOf(projectRoot, allFiles);
  const depEdges = buildDependencyEdges(workUnits, importEdges, kg, projectRoot);

  // ---------- Stage 3: SCC + critical path ----------
  const nodeIds = workUnits.map((w) => w.id);
  const scc = findSCCs(nodeIds, depEdges);
  const criticalPath = findCriticalPath(workUnits, depEdges);

  // ---------- Stage 4: Min-cut ----------
  const minCut = findMinCut(workUnits, depEdges, criticalPath, kg);

  // ---------- Stage 5+6: Partition + Estimate + Emit ----------
  const parallelBatches = partitionIntoBatches(workUnits, depEdges, criticalPath);
  const batchesWithEstimates: readonly ParallelBatch[] = parallelBatches.map((b) => ({
    ...b,
    slices: b.slices.map((s) => ({
      ...s,
      estimate: estimateSlice(s, kg)
    }))
  }));

  const totalSlices = batchesWithEstimates.reduce((sum, b) => sum + b.slices.length, 0);
  const pickHint = totalSlices > 10
    ? `slice count is ${totalSlices} (>10); split into multiple pick sessions for operator comfort`
    : undefined;

  const codegraphEnvelope = {
    nodes: cgStatus.nodes,
    edges: cgStatus.edges,
    dbMB: cgStatus.dbMB,
    freshness: cgStatus.freshness,
    affectedCrossFile: codegraphAffectedCrossFile,
    note: codegraphAffectedCrossFile
      ? 'cross-file dependents resolved via codegraph.affected'
      : 'codegraph.affected returned 0 cross-file dependents (v0.7.10 limitation); used real import edges'
  };
  const understandEnvelope: UnderstandAnythingEnvelope = {
    kgNodes: kg?.nodes.length ?? 0,
    kgEdges: kg?.edges.length ?? 0,
    available: understandAvailable,
    fallback: understandAvailable ? 'semantic' : 'structural-only',
    note: understandAvailable
      ? 'read from .understand-anything/knowledge-graph.json'
      : '.understand-anything/knowledge-graph.json not found; algorithm falls back to structural cuts'
  };

  return {
    rid,
    generatedAt: new Date().toISOString(),
    codegraph: codegraphEnvelope,
    understandAnything: understandEnvelope,
    workUnits,
    dependencyDAG: { edges: depEdges },
    sccAnalysis: scc,
    criticalPath,
    minCutResult: minCut,
    parallelBatches: batchesWithEstimates,
    ...(pickHint !== undefined ? { pickHint } : {})
  };
}

// =====================================================================
// Stage 1 helpers
// =====================================================================

function extractAcceptanceCriteria(prd: string): string[] {
  const acs: string[] = [];
  const lines = prd.split('\n');
  let inAcSection = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^##\s+acceptance criteria/i.test(trimmed)) {
      inAcSection = true;
      continue;
    }
    if (inAcSection && /^##\s+/.test(trimmed)) {
      break;
    }
    if (inAcSection && trimmed.length > 0) {
      const cleaned = trimmed.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '');
      acs.push(cleaned);
    }
  }
  return acs;
}

async function resolveWorkUnits(
  _rid: string,
  acs: readonly string[],
  cg: CodegraphRunner,
  projectRoot: string
): Promise<WorkUnit[]> {
  if (acs.length === 0) {
    return [];
  }

  const wus: WorkUnit[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < acs.length; i++) {
    const ac = acs[i]!;
    const hits = await cg.query(ac, projectRoot);
    const hit = matchAcToHit(ac, hits);
    if (hit === null) continue;
    if (seen.has(hit.filePath)) continue;
    seen.add(hit.filePath);

    wus.push({
      id: `W${i + 1}`,
      label: hit.name,
      files: [hit.filePath],
      loc: hit.loc ?? 110,
      testsAdded: 0,
      filePath: hit.filePath,
      candidates: [hit.id]
    });
  }
  return wus;
}

function matchAcToHit(ac: string, hits: readonly CodegraphQueryHit[]): CodegraphQueryHit | null {
  if (hits.length === 0) return null;
  const acLower = ac.toLowerCase();
  for (const h of hits) {
    const nameBase = basename(h.filePath, '.ts').replace(/\.tsx?$/, '').toLowerCase();
    if (acLower.includes(nameBase)) {
      return h;
    }
  }
  return hits[0]!;
}

// =====================================================================
// Stage 2 helpers
// =====================================================================

function buildDependencyEdges(
  wus: readonly WorkUnit[],
  importEdges: readonly ImportEdge[],
  kg: KnowledgeGraph | null,
  projectRoot: string
): DependencyEdge[] {
  const fileToWu = new Map<string, string>();
  for (const wu of wus) {
    for (const f of wu.files) {
      fileToWu.set(f, wu.id);
    }
  }

  const edges: DependencyEdge[] = [];
  const seen = new Set<string>();

  const addEdge = (
    from: string,
    to: string,
    kind: DependencyEdge['kind'],
    weight: number,
    evidence: string,
    isSemantic: boolean,
    confidence: 'semantic' | 'structural'
  ): void => {
    if (from === to) return;
    const key = `${from}->${to}|${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from, to, kind, weight, evidence, isSemantic, confidence });
  };

  for (const imp of importEdges) {
    let fromWu = fileToWu.get(imp.from);
    let toWu = fileToWu.get(imp.to);
    if (!fromWu) {
      const resolved = resolveRelativeImport(projectRoot, imp.from, imp.evidence);
      fromWu = fileToWu.get(resolved);
    }
    if (!toWu) {
      const resolved = resolveRelativeImport(projectRoot, imp.from, imp.evidence);
      toWu = fileToWu.get(resolved);
    }
    if (fromWu && toWu) {
      addEdge(fromWu, toWu, 'imports', 10.0, imp.evidence, false, 'structural');
    }
  }

  if (kg !== null) {
    for (const e of kg.edges) {
      if (e.type !== 'contains_flow' && e.type !== 'flow_step') continue;
      const fromNode = kg.nodes.find((n) => n.id === e.source);
      const toNode = kg.nodes.find((n) => n.id === e.target);
      if (!fromNode?.filePath || !toNode?.filePath) continue;
      const fromWu = fileToWu.get(fromNode.filePath);
      const toWu = fileToWu.get(toNode.filePath);
      if (fromWu && toWu && fromWu !== toWu) {
        const weight = e.type === 'flow_step' ? 0.05 : 0.1;
        addEdge(
          fromWu,
          toWu,
          e.type as DependencyEdge['kind'],
          weight,
          `understand-anything: ${e.type} ${e.source}->${e.target}`,
          true,
          'semantic'
        );
      }
    }
  }

  return edges;
}

function resolveRelativeImport(projectRoot: string, sourceFile: string, evidence: string): string {
  const match = /from\s+['"]([^'"]+)['"]/.exec(evidence);
  if (!match) return sourceFile;
  const importPath = match[1]!;
  if (!importPath.startsWith('.')) return sourceFile;
  const sourceDir = dirname(sourceFile);
  const tsPath = importPath.replace(/\.js$/, '.ts').replace(/\.jsx$/, '.tsx');
  return relative(projectRoot, join(projectRoot, sourceDir, tsPath));
}

// =====================================================================
// Stage 3: Tarjan SCC + longest path
// =====================================================================

function findSCCs(nodeIds: readonly string[], edges: readonly DependencyEdge[]): SccAnalysis {
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) adj.set(id, []);
  for (const e of edges) {
    const list = adj.get(e.from);
    if (list && !list.includes(e.to)) list.push(e.to);
  }

  let index = 0;
  const idx = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  const strongconnect = (v: string): void => {
    idx.set(v, index);
    lowlink.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    for (const w of adj.get(v) ?? []) {
      if (!idx.has(w)) {
        strongconnect(w);
        lowlink.set(v, Math.min(lowlink.get(v) ?? 0, lowlink.get(w) ?? 0));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v) ?? 0, idx.get(w) ?? 0));
      }
    }

    if (lowlink.get(v) === idx.get(v)) {
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      sccs.push(component);
    }
  };

  for (const id of nodeIds) {
    if (!idx.has(id)) strongconnect(id);
  }

  const trivial: string[] = [];
  const nonTrivial: string[] = [];
  for (const scc of sccs) {
    if (scc.length === 1) trivial.push(scc[0]!);
    else nonTrivial.push(...scc);
  }

  let condensationEdges = 0;
  for (const e of edges) {
    if (!sameScc(sccs, e.from, e.to)) condensationEdges++;
  }

  return {
    sccCount: sccs.length,
    trivialSCCs: trivial,
    nonTrivialSCCs: nonTrivial,
    condensationEdges
  };
}

function sameScc(sccs: readonly string[][], a: string, b: string): boolean {
  for (const scc of sccs) {
    if (scc.includes(a) && scc.includes(b)) return true;
  }
  return false;
}

function findCriticalPath(
  wus: readonly WorkUnit[],
  edges: readonly DependencyEdge[]
): { nodes: readonly string[]; edges: readonly string[]; totalLoc: number; totalDeltaLoc: number; rationale: string } {
  const locById = new Map<string, number>();
  for (const wu of wus) {
    locById.set(wu.id, wu.loc);
  }
  const adj = new Map<string, Array<{ to: string; weight: number }>>();
  for (const wu of wus) adj.set(wu.id, []);
  for (const e of edges) {
    const list = adj.get(e.from);
    if (list) list.push({ to: e.to, weight: locById.get(e.to) ?? 0 });
  }

  const indeg = new Map<string, number>();
  for (const wu of wus) indeg.set(wu.id, 0);
  for (const e of edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  const queue: string[] = [];
  for (const [id, d] of indeg) if (d === 0) queue.push(id);
  const topoOrder: string[] = [];
  while (queue.length > 0) {
    const n = queue.shift()!;
    topoOrder.push(n);
    for (const { to } of adj.get(n) ?? []) {
      indeg.set(to, (indeg.get(to) ?? 0) - 1);
      if (indeg.get(to) === 0) queue.push(to);
    }
  }
  for (const wu of wus) if (!topoOrder.includes(wu.id)) topoOrder.push(wu.id);

  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  for (const wu of wus) {
    dist.set(wu.id, locById.get(wu.id) ?? 0);
    prev.set(wu.id, null);
  }
  for (const u of topoOrder) {
    for (const { to, weight } of adj.get(u) ?? []) {
      const newDist = (dist.get(u) ?? 0) + weight;
      if (newDist > (dist.get(to) ?? 0)) {
        dist.set(to, newDist);
        prev.set(to, u);
      }
    }
  }

  let endNode = topoOrder[0]!;
  let maxDist = -1;
  for (const [id, d] of dist) {
    if (d > maxDist) {
      maxDist = d;
      endNode = id;
    }
  }

  const path: string[] = [];
  let cur: string | null = endNode;
  while (cur !== null) {
    path.unshift(cur);
    cur = prev.get(cur) ?? null;
  }

  const totalLoc = path.reduce((sum, id) => sum + (locById.get(id) ?? 0), 0);
  const totalDeltaLoc = path.reduce((sum, id) => {
    const wu = wus.find((w) => w.id === id);
    return sum + (wu?.deltaLoc ?? wu?.loc ?? 0);
  }, 0);

  const edgeStrs = path.slice(0, -1).map((n, i) => `${n} -> ${path[i + 1]!}`);

  return {
    nodes: path,
    edges: edgeStrs,
    totalLoc,
    totalDeltaLoc,
    rationale: `Longest path by sum of LoC across the dependency DAG; ${path.length} work units, ${totalLoc} LoC summed`
  };
}

// =====================================================================
// Stage 4: Min-cut
// =====================================================================

function findMinCut(
  _wus: readonly WorkUnit[],
  edges: readonly DependencyEdge[],
  criticalPath: { nodes: readonly string[] },
  _kg: KnowledgeGraph | null
): MinCutResult {
  const cpSet = new Set(criticalPath.nodes);

  const nonCpEdges = edges.filter((e) => !cpSet.has(e.from) || !cpSet.has(e.to));
  const sorted = [...nonCpEdges].sort((a, b) => a.weight - b.weight);
  const cutSet: MinCutEdge[] = sorted.filter((e) => e.weight < 0.5);

  const partitions: MinCutPartition[] = [];
  partitions.push({ name: 'critical-path', nodes: criticalPath.nodes });

  // For v1, just label every non-CP WU as its own parallel partition
  const remaining = Array.from(
    new Set(_wus.map((w) => w.id).filter((id) => !cpSet.has(id)))
  );
  let parallelIdx = 1;
  for (const id of remaining) {
    partitions.push({ name: `parallel-${parallelIdx++}`, nodes: [id] });
  }
  if (remaining.length === 0) {
    partitions.push({ name: 'parallel-empty', nodes: [] });
  }

  return {
    algorithm: 'v1 simplified min-cut: lowest-weight non-critical-path edges; full Stoer-Wagner in v2',
    cutEdges: cutSet.map((e) => ({
      from: e.from,
      to: e.to,
      kind: e.kind,
      weight: e.weight,
      isSemantic: e.isSemantic,
      confidence: e.confidence
    })),
    partitions
  };
}

// =====================================================================
// Stage 5+6: Estimate + Partition
// =====================================================================

function estimateSlice(slice: SliceCandidate, _kg: KnowledgeGraph | null): SliceCandidate['estimate'] {
  const sampleSize = 0;
  const complexitySum = 0;
  return calibrate(complexitySum, slice.estimate.testCount, slice.estimate.locSum, sampleSize);
}

function partitionIntoBatches(
  wus: readonly WorkUnit[],
  edges: readonly DependencyEdge[],
  _criticalPath: { nodes: readonly string[] }
): ParallelBatch[] {
  const upstream = new Map<string, string[]>();
  for (const wu of wus) upstream.set(wu.id, []);
  for (const e of edges) {
    const list = upstream.get(e.to);
    if (list && !list.includes(e.from)) list.push(e.from);
  }

  const placed = new Set<string>();
  const batches: ParallelBatch[] = [];

  if (wus.length === 0) return batches;

  let currentBatch: string[] = [];
  for (const wu of wus) {
    if ((upstream.get(wu.id) ?? []).length === 0) {
      currentBatch.push(wu.id);
    }
  }
  batches.push({
    batch: 1,
    dependsOn: [],
    slices: currentBatch.map((id) => wuToSlice(wus.find((w) => w.id === id)!)),
    parallelizableWithinBatch: currentBatch.length > 1
  });
  for (const id of currentBatch) placed.add(id);

  let batchNum = 2;
  let prevBatchNums: number[] = [1];
  while (placed.size < wus.length) {
    currentBatch = [];
    for (const wu of wus) {
      if (placed.has(wu.id)) continue;
      const ups = upstream.get(wu.id) ?? [];
      if (ups.every((u) => placed.has(u))) {
        currentBatch.push(wu.id);
      }
    }
    if (currentBatch.length === 0) {
      for (const wu of wus) {
        if (!placed.has(wu.id)) currentBatch.push(wu.id);
      }
    }
    batches.push({
      batch: batchNum,
      dependsOn: prevBatchNums,
      slices: currentBatch.map((id) => wuToSlice(wus.find((w) => w.id === id)!)),
      parallelizableWithinBatch: currentBatch.length > 1
    });
    for (const id of currentBatch) placed.add(id);
    prevBatchNums = [batchNum];
    batchNum++;
  }

  return batches;
}

function wuToSlice(wu: WorkUnit): SliceCandidate {
  return {
    rid: `${wu.id}-slice`,
    label: wu.label,
    files: wu.files,
    estimate: {
      complexitySum: 0,
      testCount: wu.testsAdded,
      locSum: wu.loc,
      minutesP50: 0,
      minutesP90: 0,
      confidence: 'low',
      rationale: 'preliminary; replaced by calibrate() in estimateSlice'
    },
    semanticAnchor: `file:${wu.filePath}`
  };
}

// =====================================================================
// DEFAULT RUNNERS (CLI-mode, real shell-outs)
// =====================================================================

export function defaultCodegraphRunner(): CodegraphRunner {
  return {
    async query(text, projectRoot) {
      try {
        const stdout = runCodegraph(['query', text, '--json', '--project', projectRoot], projectRoot);
        const parsed = JSON.parse(stdout);
        if (Array.isArray(parsed)) {
          // Upstream envelope: { node: {id, kind, name, filePath, ...}, score }
          // Flatten to our CodegraphQueryHit shape.
          return parsed
            .map((entry: unknown) => {
              if (entry && typeof entry === 'object' && 'node' in entry) {
                const node = (entry as { node: Record<string, unknown> }).node;
                return {
                  id: String(node.id ?? ''),
                  kind: String(node.kind ?? 'unknown'),
                  name: String(node.name ?? ''),
                  filePath: String(node.filePath ?? ''),
                  score: Number((entry as { score?: number }).score ?? 0)
                };
              }
              return null;
            })
            .filter((h: CodegraphQueryHit | null): h is CodegraphQueryHit => h !== null && h.filePath !== '');
        }
        return [];
      } catch {
        return [];
      }
    },
    async affected(files, projectRoot): Promise<CodegraphAffectedResult> {
      try {
        const stdout = runCodegraph(['affected', ...files, '--json', '--project', projectRoot], projectRoot);
        const parsed = JSON.parse(stdout);
        return {
          changedFiles: parsed.changedFiles ?? files,
          affectedTests: parsed.affectedTests ?? [],
          totalDependentsTraversed: parsed.totalDependentsTraversed ?? 0
        };
      } catch {
        return { changedFiles: files, affectedTests: [], totalDependentsTraversed: 0 };
      }
    },
    async status(projectRoot) {
      try {
        const stdout = runCodegraph(['status', '--project', projectRoot], projectRoot);
        const nodesMatch = /Nodes:\s+([\d,]+)/.exec(stdout);
        const edgesMatch = /Edges:\s+([\d,]+)/.exec(stdout);
        const dbMatch = /DB Size:\s+([\d.]+)\s*MB/.exec(stdout);
        if (!nodesMatch) {
          return { indexed: false, nodes: 0, edges: 0, dbMB: 0, freshness: 'unindexed' };
        }
        return {
          indexed: true,
          nodes: parseInt(nodesMatch[1]!.replace(/,/g, ''), 10),
          edges: parseInt(edgesMatch?.[1]!.replace(/,/g, '') ?? '0', 10),
          dbMB: parseFloat(dbMatch?.[1] ?? '0'),
          freshness: 'indexed'
        };
      } catch {
        return { indexed: false, nodes: 0, edges: 0, dbMB: 0, freshness: 'unindexed' };
      }
    }
  };
}

function runCodegraph(args: string[], projectRoot: string): string {
  // Use `peaks codegraph` (the peaks wrapper), which adds --project support.
  // Falls back to raw `codegraph` (no --project) if peaks is not on PATH.
  const isWin = process.platform === 'win32';
  // Try `peaks codegraph` first (the wrapper that understands --project).
  try {
    return execFileSync('peaks', ['codegraph', ...args], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: isWin,
      timeout: 60_000,
      maxBuffer: 32 * 1024 * 1024
    }).toString('utf8');
  } catch (error: unknown) {
    const err = error as { code?: string; status?: number };
    if (err.code === 'ENOENT') {
      // Fallback: raw `codegraph` (won't accept --project, drop it)
      const fallbackArgs = args.filter((a) => a !== '--project' && !a.startsWith('--project='));
      const localBin = join(projectRoot, 'node_modules', '.bin', 'codegraph');
      const command = existsSync(localBin) ? localBin : 'npx';
      const finalArgs = command === 'npx' ? ['codegraph', ...fallbackArgs] : fallbackArgs;
      return execFileSync(command, finalArgs, {
        cwd: projectRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: isWin,
        timeout: 60_000,
        maxBuffer: 32 * 1024 * 1024
      }).toString('utf8');
    }
    throw error;
  }
}

export function defaultUnderstandRunner(): UnderstandRunner {
  return {
    async read(projectRoot) {
      const kgPath = join(projectRoot, '.understand-anything', 'knowledge-graph.json');
      if (!existsSync(kgPath)) return null;
      try {
        const raw = readFileSync(kgPath, 'utf8');
        const parsed = JSON.parse(raw);
        return {
          nodes: parsed.nodes ?? [],
          edges: parsed.edges ?? [],
          layers: parsed.layers ?? []
        };
      } catch {
        return null;
      }
    }
  };
}

export function defaultImportEdgeRunner(): ImportEdgeRunner {
  return {
    async importsOf(projectRoot, files) {
      const edges: ImportEdge[] = [];
      for (const file of files) {
        const absPath = join(projectRoot, file);
        if (!existsSync(absPath)) continue;
        try {
          const content = readFileSync(absPath, 'utf8');
          const importRe = /import\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)?\s*(?:,\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+))?\s*from\s+['"]([^'"]+)['"]/g;
          let match: RegExpExecArray | null;
          while ((match = importRe.exec(content)) !== null) {
            const importPath = match[1]!;
            if (!importPath.startsWith('.')) continue;
            const fromDir = dirname(file);
            const tsPath = importPath.replace(/\.js$/, '.ts').replace(/\.jsx$/, '.tsx');
            const resolved = relative(projectRoot, join(projectRoot, fromDir, tsPath));
            edges.push({ from: file, to: resolved, evidence: match[0] });
          }
        } catch {
          // Skip unreadable files
        }
      }
      return edges;
    }
  };
}
