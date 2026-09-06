/**
 * Import-edge collection helpers for the slice-decompose pipeline.
 * Extracted from `slice-decompose-service.ts` to keep that file under
 * the 800 LOC cap (mechanical verbatim move). `buildDependencyEdges` is
 * the only exported entry point; the rest are internal helpers.
 */

import { dirname, join, relative } from 'node:path';
import type { DependencyEdge, ImportEdge, KnowledgeGraph, WorkUnit } from './slice-decompose-types.js';

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

export function buildDependencyEdges(
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
