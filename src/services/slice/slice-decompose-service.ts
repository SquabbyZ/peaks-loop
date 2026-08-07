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
// PUBLIC: decomposeSlices (FSM orchestrator over the 6-stage pipeline)
// =====================================================================

/** FSM stages for the slice-decompose pipeline. The orchestrator
 *  (`decomposeSlices`) dispatches each stage in strict order; each
 *  stage reads its predecessor's output and produces one new output.
 *  The cycle graph is explicitly enumerated so the orchestrator remains
 *  a flat sequence with no nested branching. */
type DecomposeStage =
  | 'validate-codegraph'
  | 'resolve-work-units'
  | 'build-dep-dag'
  | 'scc-critical-path'
  | 'min-cut'
  | 'partition-estimate-emit';

export async function decomposeSlices(
  rid: string,
  prdMarkdown: string,
  projectRoot: string,
  options: DecomposeOptions = {}
): Promise<DecompositionResult> {
  const runners = resolveRunners(options);
  const stageOrder: readonly DecomposeStage[] = [
    'validate-codegraph',
    'resolve-work-units',
    'build-dep-dag',
    'scc-critical-path',
    'min-cut',
    'partition-estimate-emit'
  ];
  const initial = createInitialState(rid, prdMarkdown, projectRoot, runners);
  const final = await runPipeline(initial, stageOrder);
  if (final.result === null) {
    throw new Error('decomposeSlices FSM completed without emitting a result');
  }
  return final.result;
}

/** Mutable FSM state threaded through every stage. Each stage mutates
 *  only the slots it owns; downstream stages read what they need. */
interface DecomposeState {
  rid: string;
  prdMarkdown: string;
  projectRoot: string;
  runners: { cg: CodegraphRunner; ur: UnderstandRunner; ier: ImportEdgeRunner };
  cgStatus: Awaited<ReturnType<CodegraphRunner['status']>> | null;
  workUnits: WorkUnit[];
  depEdges: DependencyEdge[];
  kg: KnowledgeGraph | null;
  understandAvailable: boolean;
  codegraphAffectedCrossFile: boolean;
  scc: SccAnalysis | null;
  criticalPath: ReturnType<typeof findCriticalPath> | null;
  minCut: MinCutResult | null;
  batchesWithEstimates: readonly ParallelBatch[];
  result: DecompositionResult | null;
}

function createInitialState(
  rid: string,
  prdMarkdown: string,
  projectRoot: string,
  runners: { cg: CodegraphRunner; ur: UnderstandRunner; ier: ImportEdgeRunner }
): DecomposeState {
  return {
    rid,
    prdMarkdown,
    projectRoot,
    runners,
    cgStatus: null,
    workUnits: [],
    depEdges: [],
    kg: null,
    understandAvailable: false,
    codegraphAffectedCrossFile: false,
    scc: null,
    criticalPath: null,
    minCut: null,
    batchesWithEstimates: [],
    result: null
  };
}

async function runPipeline(
  state: DecomposeState,
  stages: readonly DecomposeStage[]
): Promise<DecomposeState> {
  let current = state;
  for (const stage of stages) {
    current = await runStage(current, stage);
  }
  return current;
}

async function runStage(state: DecomposeState, stage: DecomposeStage): Promise<DecomposeState> {
  switch (stage) {
    case 'validate-codegraph':
      return validateCodegraphStage(state);
    case 'resolve-work-units':
      return resolveWorkUnitsStage(state);
    case 'build-dep-dag':
      return buildDepDagStage(state);
    case 'scc-critical-path':
      return sccCriticalPathStage(state);
    case 'min-cut':
      return minCutStage(state);
    case 'partition-estimate-emit':
      return partitionEstimateEmitStage(state);
  }
}

function resolveRunners(options: DecomposeOptions): {
  cg: CodegraphRunner;
  ur: UnderstandRunner;
  ier: ImportEdgeRunner;
} {
  return {
    cg: options.codegraphRunner ?? defaultCodegraphRunner(),
    ur: options.understandRunner ?? defaultUnderstandRunner(),
    ier: options.importEdgeRunner ?? defaultImportEdgeRunner()
  };
}

// =====================================================================
// Stage 0: validate codegraph index
// =====================================================================

async function validateCodegraphStage(state: DecomposeState): Promise<DecomposeState> {
  const cgStatus = await state.runners.cg.status(state.projectRoot);
  if (!cgStatus.indexed) {
    throw new Error(
      'peaks codegraph not initialised on this project. ' +
        'Run `npx codegraph init` then `npx codegraph index` in ' +
        state.projectRoot +
        ' before invoking `peaks slice decompose`.'
    );
  }
  return { ...state, cgStatus };
}

// =====================================================================
// Stage 1: work-unit resolution
// =====================================================================

async function resolveWorkUnitsStage(state: DecomposeState): Promise<DecomposeState> {
  const acs = extractAcceptanceCriteria(state.prdMarkdown);
  const workUnits = await resolveWorkUnits(state.rid, acs, state.runners.cg, state.projectRoot);
  return { ...state, workUnits };
}

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
// Stage 2: dependency DAG
// =====================================================================

async function buildDepDagStage(state: DecomposeState): Promise<DecomposeState> {
  const kg = await state.runners.ur.read(state.projectRoot);
  const understandAvailable = kg !== null;
  const fileSet = await collectFileSet(state.workUnits, state.runners.ier, state.projectRoot);
  const allFiles = Array.from(fileSet);
  const codegraphAffectedCrossFile = await probeCrossFileAffected(allFiles, state.runners.cg, state.projectRoot);
  const workUnits = applyImplicitWuFallback(state.workUnits, allFiles);
  const importEdges = await state.runners.ier.importsOf(state.projectRoot, allFiles);
  const depEdges = buildDependencyEdges(workUnits, importEdges, kg, state.projectRoot);
  return { ...state, kg, understandAvailable, codegraphAffectedCrossFile, workUnits, depEdges };
}

async function collectFileSet(
  workUnits: readonly WorkUnit[],
  ier: ImportEdgeRunner,
  projectRoot: string
): Promise<Set<string>> {
  const explicitFiles = workUnits.flatMap((w) => w.files);
  const probeImports = await ier.importsOf(projectRoot, explicitFiles);
  const fileSet = new Set<string>(explicitFiles);
  for (const e of probeImports) {
    fileSet.add(e.from);
    fileSet.add(e.to);
  }
  return fileSet;
}

async function probeCrossFileAffected(
  allFiles: readonly string[],
  cg: CodegraphRunner,
  projectRoot: string
): Promise<boolean> {
  if (allFiles.length === 0) return false;
  try {
    const aff = await cg.affected(allFiles, projectRoot);
    return aff.totalDependentsTraversed > 0;
  } catch {
    return false;
  }
}

/** If no ACs but the import graph has files, create implicit WUs (one
 *  per file). This is the fallback path for the chain/diamond test
 *  cases. */
function applyImplicitWuFallback(workUnits: readonly WorkUnit[], allFiles: readonly string[]): WorkUnit[] {
  if (workUnits.length > 0 || allFiles.length === 0) return [...workUnits];
  return allFiles.map((file, i) => ({
    id: `F${i + 1}`,
    label: basename(file),
    files: [file],
    loc: 110,
    testsAdded: 0,
    filePath: file,
    candidates: [`file:${file}`]
  }));
}

/** Edge-builder FSM: classifies each candidate into one of three
 *  classes (structural-import, semantic-flow, or dropped) and emits a
 *  deduplicated list. The state machine enumerates the classification
 *  rules explicitly so this stays under the complexity budget while
 *  preserving the original behaviour. */
interface ClassifiedImportEdge {
  fromWu: string;
  toWu: string;
  evidence: string;
}

interface EdgeCollector {
  edges: DependencyEdge[];
  seen: Set<string>;
}

function indexFilesToWorkUnits(wus: readonly WorkUnit[]): Map<string, string> {
  const fileToWu = new Map<string, string>();
  for (const wu of wus) {
    for (const f of wu.files) {
      fileToWu.set(f, wu.id);
    }
  }
  return fileToWu;
}

function classifyImportEdge(
  imp: ImportEdge,
  fileToWu: ReadonlyMap<string, string>,
  projectRoot: string
): ClassifiedImportEdge | null {
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
  if (!fromWu || !toWu) return null;
  return { fromWu, toWu, evidence: imp.evidence };
}

function pushIfNew(collector: EdgeCollector, edge: DependencyEdge): void {
  if (edge.from === edge.to) return;
  const key = `${edge.from}->${edge.to}|${edge.kind}`;
  if (collector.seen.has(key)) return;
  collector.seen.add(key);
  collector.edges.push(edge);
}

function collectImportEdges(
  importEdges: readonly ImportEdge[],
  fileToWu: ReadonlyMap<string, string>,
  projectRoot: string,
  collector: EdgeCollector
): void {
  for (const imp of importEdges) {
    const classified = classifyImportEdge(imp, fileToWu, projectRoot);
    if (classified === null) continue;
    const edge: DependencyEdge = {
      from: classified.fromWu,
      to: classified.toWu,
      kind: 'imports',
      weight: 10.0,
      evidence: classified.evidence,
      isSemantic: false,
      confidence: 'structural'
    };
    pushIfNew(collector, edge);
  }
}

function collectSemanticEdges(
  kg: KnowledgeGraph,
  fileToWu: ReadonlyMap<string, string>,
  collector: EdgeCollector
): void {
  for (const e of kg.edges) {
    if (e.type !== 'contains_flow' && e.type !== 'flow_step') continue;
    const fromNode = kg.nodes.find((n) => n.id === e.source);
    const toNode = kg.nodes.find((n) => n.id === e.target);
    if (!fromNode?.filePath || !toNode?.filePath) continue;
    const fromWu = fileToWu.get(fromNode.filePath);
    const toWu = fileToWu.get(toNode.filePath);
    if (!fromWu || !toWu || fromWu === toWu) continue;
    const weight = e.type === 'flow_step' ? 0.05 : 0.1;
    const edge: DependencyEdge = {
      from: fromWu,
      to: toWu,
      kind: e.type as DependencyEdge['kind'],
      weight,
      evidence: `understand-anything: ${e.type} ${e.source}->${e.target}`,
      isSemantic: true,
      confidence: 'semantic'
    };
    pushIfNew(collector, edge);
  }
}

function buildDependencyEdges(
  wus: readonly WorkUnit[],
  importEdges: readonly ImportEdge[],
  kg: KnowledgeGraph | null,
  projectRoot: string
): DependencyEdge[] {
  const fileToWu = indexFilesToWorkUnits(wus);
  const collector: EdgeCollector = { edges: [], seen: new Set() };
  collectImportEdges(importEdges, fileToWu, projectRoot, collector);
  if (kg !== null) {
    collectSemanticEdges(kg, fileToWu, collector);
  }
  return collector.edges;
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

function sccCriticalPathStage(state: DecomposeState): DecomposeState {
  const nodeIds = state.workUnits.map((w) => w.id);
  const scc = findSCCs(nodeIds, state.depEdges);
  const criticalPath = findCriticalPath(state.workUnits, state.depEdges);
  return { ...state, scc, criticalPath };
}

function findSCCs(nodeIds: readonly string[], edges: readonly DependencyEdge[]): SccAnalysis {
  const adj = buildAdjacencyList(nodeIds, edges);
  const sccs = runTarjan(nodeIds, adj);
  return summariseSccs(sccs, edges);
}

/** Build a forward adjacency map: nodeId → list of distinct neighbours. */
function buildAdjacencyList(nodeIds: readonly string[], edges: readonly DependencyEdge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) adj.set(id, []);
  for (const e of edges) {
    const list = adj.get(e.from);
    if (list && !list.includes(e.to)) list.push(e.to);
  }
  return adj;
}

/** Tarjan SCC visitor state. The recursive `strongconnect` reads/writes
 *  this object instead of capturing mutable counters via closure; that
 *  separation lets us split the body into `enterNode`, `relaxEdge`,
 *  and `finaliseRoot` so the per-iteration cyclomatic budget stays low. */
interface TarjanVisitor {
  index: number;
  idx: Map<string, number>;
  lowlink: Map<string, number>;
  onStack: Set<string>;
  stack: string[];
  sccs: string[][];
}

function createTarjanVisitor(): TarjanVisitor {
  return {
    index: 0,
    idx: new Map(),
    lowlink: new Map(),
    onStack: new Set(),
    stack: [],
    sccs: []
  };
}

function enterNode(visitor: TarjanVisitor, v: string): void {
  visitor.idx.set(v, visitor.index);
  visitor.lowlink.set(v, visitor.index);
  visitor.index++;
  visitor.stack.push(v);
  visitor.onStack.add(v);
}

function relaxEdge(
  visitor: TarjanVisitor,
  v: string,
  w: string,
  recurse: (next: string) => void
): void {
  if (!visitor.idx.has(w)) {
    recurse(w);
    visitor.lowlink.set(v, Math.min(visitor.lowlink.get(v) ?? 0, visitor.lowlink.get(w) ?? 0));
  } else if (visitor.onStack.has(w)) {
    visitor.lowlink.set(v, Math.min(visitor.lowlink.get(v) ?? 0, visitor.idx.get(w) ?? 0));
  }
}

function finaliseRoot(visitor: TarjanVisitor, v: string): void {
  if ((visitor.lowlink.get(v) ?? 0) !== (visitor.idx.get(v) ?? 0)) return;
  const component: string[] = [];
  let w: string;
  do {
    w = visitor.stack.pop()!;
    visitor.onStack.delete(w);
    component.push(w);
  } while (w !== v);
  visitor.sccs.push(component);
}

/** Run Tarjan's SCC algorithm; returns the list of components in
 *  discovery order. Visitor state is hoisted to a named struct
 *  (`TarjanVisitor`) so the recursive body can be split into
 *  enterNode / relaxEdge / finaliseRoot without parameter sprawl. */
function runTarjan(nodeIds: readonly string[], adj: ReadonlyMap<string, readonly string[]>): string[][] {
  const visitor = createTarjanVisitor();

  const strongconnect = (v: string): void => {
    enterNode(visitor, v);
    for (const w of adj.get(v) ?? []) {
      relaxEdge(visitor, v, w, strongconnect);
    }
    finaliseRoot(visitor, v);
  };

  for (const id of nodeIds) {
    if (!visitor.idx.has(id)) strongconnect(id);
  }
  return visitor.sccs;
}

function summariseSccs(sccs: readonly string[][], edges: readonly DependencyEdge[]): SccAnalysis {
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

/** Critical-path FSM: three sequential phases.
 *  1. `phaseTopoOrder` -- Kahn's algorithm with cycle-tolerance fallback.
 *  2. `phaseLongestDist` -- DP relaxation along the topo order.
 *  3. `phaseReconstruct` -- backtrack + aggregate metrics.
 *  Each phase has its own branch budget; the orchestrator stays linear. */
function findCriticalPath(
  wus: readonly WorkUnit[],
  edges: readonly DependencyEdge[]
): { nodes: readonly string[]; edges: readonly string[]; totalLoc: number; totalDeltaLoc: number; rationale: string } {
  const locById = indexLocById(wus);
  const adj = buildForwardAdjacency(wus, edges, locById);
  const topoOrder = phaseTopoOrder(wus, adj);
  const { dist, prev } = phaseLongestDist(wus, adj, topoOrder, locById);
  return phaseReconstruct(wus, locById, topoOrder, dist, prev);
}

function indexLocById(wus: readonly WorkUnit[]): Map<string, number> {
  const locById = new Map<string, number>();
  for (const wu of wus) {
    locById.set(wu.id, wu.loc);
  }
  return locById;
}

function buildForwardAdjacency(
  wus: readonly WorkUnit[],
  edges: readonly DependencyEdge[],
  locById: ReadonlyMap<string, number>
): Map<string, Array<{ to: string; weight: number }>> {
  const adj = new Map<string, Array<{ to: string; weight: number }>>();
  for (const wu of wus) adj.set(wu.id, []);
  for (const e of edges) {
    const list = adj.get(e.from);
    if (list) list.push({ to: e.to, weight: locById.get(e.to) ?? 0 });
  }
  return adj;
}

function phaseTopoOrder(
  wus: readonly WorkUnit[],
  adj: ReadonlyMap<string, readonly { to: string; weight: number }[]>
): string[] {
  const indeg = computeIndegrees(wus, adj);
  const queue = seedQueue(indeg);
  const topoOrder = drainKahnQueue(queue, indeg, adj);
  appendCycleLeftovers(wus, topoOrder);
  return topoOrder;
}

function computeIndegrees(
  wus: readonly WorkUnit[],
  adj: ReadonlyMap<string, readonly { to: string; weight: number }[]>
): Map<string, number> {
  const indeg = new Map<string, number>();
  for (const wu of wus) indeg.set(wu.id, 0);
  for (const e of adj.values()) {
    for (const { to } of e) indeg.set(to, (indeg.get(to) ?? 0) + 1);
  }
  return indeg;
}

function seedQueue(indeg: ReadonlyMap<string, number>): string[] {
  const queue: string[] = [];
  for (const [id, d] of indeg) if (d === 0) queue.push(id);
  return queue;
}

function drainKahnQueue(
  queue: string[],
  indeg: Map<string, number>,
  adj: ReadonlyMap<string, readonly { to: string; weight: number }[]>
): string[] {
  const topoOrder: string[] = [];
  while (queue.length > 0) {
    const n = queue.shift()!;
    topoOrder.push(n);
    for (const { to } of adj.get(n) ?? []) {
      indeg.set(to, (indeg.get(to) ?? 0) - 1);
      if (indeg.get(to) === 0) queue.push(to);
    }
  }
  return topoOrder;
}

/** Cycle-tolerance fallback: append any wu that didn't make it through Kahn. */
function appendCycleLeftovers(wus: readonly WorkUnit[], topoOrder: string[]): void {
  for (const wu of wus) if (!topoOrder.includes(wu.id)) topoOrder.push(wu.id);
}

function phaseLongestDist(
  wus: readonly WorkUnit[],
  adj: ReadonlyMap<string, readonly { to: string; weight: number }[]>,
  topoOrder: readonly string[],
  locById: ReadonlyMap<string, number>
): { dist: Map<string, number>; prev: Map<string, string | null> } {
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
  return { dist, prev };
}

function phaseReconstruct(
  wus: readonly WorkUnit[],
  locById: ReadonlyMap<string, number>,
  topoOrder: readonly string[],
  dist: ReadonlyMap<string, number>,
  prev: ReadonlyMap<string, string | null>
): { nodes: readonly string[]; edges: readonly string[]; totalLoc: number; totalDeltaLoc: number; rationale: string } {
  const endNode = pickEndNode(topoOrder, dist);
  const path = backtrackPath(endNode, prev);
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

function pickEndNode(topoOrder: readonly string[], dist: ReadonlyMap<string, number>): string {
  let endNode = topoOrder[0]!;
  let maxDist = -1;
  for (const [id, d] of dist) {
    if (d > maxDist) {
      maxDist = d;
      endNode = id;
    }
  }
  return endNode;
}

function backtrackPath(endNode: string, prev: ReadonlyMap<string, string | null>): string[] {
  const path: string[] = [];
  let cur: string | null = endNode;
  while (cur !== null) {
    path.unshift(cur);
    cur = prev.get(cur) ?? null;
  }
  return path;
}

// =====================================================================
// Stage 4: Min-cut
// =====================================================================

function minCutStage(state: DecomposeState): DecomposeState {
  if (state.criticalPath === null) return state;
  const minCut = findMinCut(state.workUnits, state.depEdges, state.criticalPath, state.kg);
  return { ...state, minCut };
}

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
// Stage 5+6: Estimate + Partition + Emit
// =====================================================================

function partitionEstimateEmitStage(state: DecomposeState): DecomposeState {
  if (state.criticalPath === null) return state;
  const parallelBatches = partitionIntoBatches(state.workUnits, state.depEdges, state.criticalPath);
  const batchesWithEstimates: readonly ParallelBatch[] = parallelBatches.map((b) => ({
    ...b,
    slices: b.slices.map((s) => ({
      ...s,
      estimate: estimateSlice(s, state.kg)
    }))
  }));
  const result = buildDecompositionResult(state, batchesWithEstimates);
  return { ...state, batchesWithEstimates, result };
}

function buildDecompositionResult(
  state: DecomposeState,
  batchesWithEstimates: readonly ParallelBatch[]
): DecompositionResult {
  assertReadyForEmit(state);

  const totalSlices = batchesWithEstimates.reduce((sum, b) => sum + b.slices.length, 0);
  const pickHint = buildPickHint(totalSlices);
  const codegraphEnvelope = buildCodegraphEnvelope(state);
  const understandEnvelope = buildUnderstandEnvelope(state);

  return {
    rid: state.rid,
    generatedAt: new Date().toISOString(),
    codegraph: codegraphEnvelope,
    understandAnything: understandEnvelope,
    workUnits: state.workUnits,
    dependencyDAG: { edges: state.depEdges },
    sccAnalysis: state.scc!,
    criticalPath: state.criticalPath!,
    minCutResult: state.minCut!,
    parallelBatches: batchesWithEstimates,
    ...(pickHint !== undefined ? { pickHint } : {})
  };
}

function assertReadyForEmit(state: DecomposeState): void {
  if (
    state.cgStatus === null ||
    state.criticalPath === null ||
    state.scc === null ||
    state.minCut === null
  ) {
    throw new Error('decomposeSlices FSM reached emit stage without completing prior stages');
  }
}

function buildPickHint(totalSlices: number): string | undefined {
  if (totalSlices <= 10) return undefined;
  return `slice count is ${totalSlices} (>10); split into multiple pick sessions for operator comfort`;
}

function buildCodegraphEnvelope(state: DecomposeState): {
  nodes: number;
  edges: number;
  dbMB: number;
  freshness: string;
  affectedCrossFile: boolean;
  note: string;
} {
  const cgStatus = state.cgStatus;
  if (cgStatus === null) {
    throw new Error('buildCodegraphEnvelope called before validate-codegraph stage');
  }
  return {
    nodes: cgStatus.nodes,
    edges: cgStatus.edges,
    dbMB: cgStatus.dbMB,
    freshness: cgStatus.freshness,
    affectedCrossFile: state.codegraphAffectedCrossFile,
    note: state.codegraphAffectedCrossFile
      ? 'cross-file dependents resolved via codegraph.affected'
      : 'codegraph.affected returned 0 cross-file dependents (v0.7.10 limitation); used real import edges'
  };
}

function buildUnderstandEnvelope(state: DecomposeState): UnderstandAnythingEnvelope {
  return {
    kgNodes: state.kg?.nodes.length ?? 0,
    kgEdges: state.kg?.edges.length ?? 0,
    available: state.understandAvailable,
    fallback: state.understandAvailable ? 'semantic' : 'structural-only',
    note: state.understandAvailable
      ? 'read from .understand-anything/knowledge-graph.json'
      : '.understand-anything/knowledge-graph.json not found; algorithm falls back to structural cuts'
  };
}

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
  if (wus.length === 0) return [];
  const upstream = computeUpstream(wus, edges);
  return runBatchScheduler(wus, upstream);
}

/** Build reverse adjacency: id → list of upstream wu ids that depend on it. */
function computeUpstream(
  wus: readonly WorkUnit[],
  edges: readonly DependencyEdge[]
): Map<string, string[]> {
  const upstream = new Map<string, string[]>();
  for (const wu of wus) upstream.set(wu.id, []);
  for (const e of edges) {
    const list = upstream.get(e.to);
    if (list && !list.includes(e.from)) list.push(e.from);
  }
  return upstream;
}

/** Iterate Kahn-style batches until every wu is placed. The seed
 *  batch contains all wus with no upstream; subsequent batches pick
 *  the wus whose upstream is fully placed. */
function runBatchScheduler(
  wus: readonly WorkUnit[],
  upstream: ReadonlyMap<string, readonly string[]>
): ParallelBatch[] {
  const placed = new Set<string>();
  const batches: ParallelBatch[] = [];

  const seedIds = wus
    .filter((wu) => (upstream.get(wu.id) ?? []).length === 0)
    .map((wu) => wu.id);
  batches.push(materialiseBatch(1, [], seedIds, wus));
  for (const id of seedIds) placed.add(id);

  let batchNum = 2;
  let prevBatchNums: number[] = [1];
  while (placed.size < wus.length) {
    const ready = pickReadyBatch(wus, upstream, placed);
    batches.push(materialiseBatch(batchNum, prevBatchNums, ready, wus));
    for (const id of ready) placed.add(id);
    prevBatchNums = [batchNum];
    batchNum++;
  }
  return batches;
}

function pickReadyBatch(
  wus: readonly WorkUnit[],
  upstream: ReadonlyMap<string, readonly string[]>,
  placed: ReadonlySet<string>
): string[] {
  const ready: string[] = [];
  for (const wu of wus) {
    if (placed.has(wu.id)) continue;
    const ups = upstream.get(wu.id) ?? [];
    if (ups.every((u) => placed.has(u))) {
      ready.push(wu.id);
    }
  }
  if (ready.length > 0) return ready;
  // Fallback: pick whatever is unplaced (shouldn't happen on a valid DAG,
  // but keeps the loop total when cycles sneak through).
  for (const wu of wus) {
    if (!placed.has(wu.id)) ready.push(wu.id);
  }
  return ready;
}

function materialiseBatch(
  batchNum: number,
  dependsOn: readonly number[],
  ids: readonly string[],
  wus: readonly WorkUnit[]
): ParallelBatch {
  return {
    batch: batchNum,
    dependsOn: [...dependsOn],
    slices: ids.map((id) => wuToSlice(wus.find((w) => w.id === id)!)),
    parallelizableWithinBatch: ids.length > 1
  };
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

// Re-export the 3 default runner factories so external callers (CLI,
// tests) keep importing from this module unchanged. The runners
// (CLI-mode, real shell-outs) live in the sibling
// `slice-decompose-runners.ts` module — see v2.18.3 file-split for
// the rationale. Function signatures and behaviour are unchanged
// (verbatim move).
import { defaultCodegraphRunner, defaultUnderstandRunner, defaultImportEdgeRunner } from './slice-decompose-runners.js';
export { defaultCodegraphRunner, defaultUnderstandRunner, defaultImportEdgeRunner } from './slice-decompose-runners.js';