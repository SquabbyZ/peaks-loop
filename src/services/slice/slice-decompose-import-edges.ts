/**
 * Import-edge collection helpers for the slice-decompose pipeline.
 * Extracted from `slice-decompose-service.ts` to keep that file under
 * the 800 LOC cap (mechanical verbatim move). `buildDependencyEdges` is
 * the only exported entry point; the rest are internal helpers.
 */

import { dirname, join, relative } from 'node:path';
import type { DependencyEdge, ImportEdge, WorkUnit } from './slice-decompose-types.js';
import {
  loadWorkspacePackages,
  ownerPackageFor,
  type WorkspacePackage
} from './slice-workspace-packages.js';

/**
 * A declared workspace dependency is weaker evidence than a real import, so it
 * carries a lower weight than an import edge. 4.0 keeps it above the min-cut's
 * 0.5 cutoff, because the point of the edge is serialization rather than a
 * candidate for splitting the packages apart.
 */
const PACKAGE_DEPENDENCY_WEIGHT = 4.0;

/** Edge-builder FSM: classifies each import candidate as a structural
 *  edge or drops it, and emits a deduplicated list. The state machine
 *  enumerates the classification rules explicitly so this stays under the
 *  complexity budget while preserving the original behaviour. */
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

export function buildDependencyEdges(
  wus: readonly WorkUnit[],
  importEdges: readonly ImportEdge[],
  projectRoot: string
): DependencyEdge[] {
  const fileToWu = indexFilesToWorkUnits(wus);
  const collector: EdgeCollector = { edges: [], seen: new Set() };
  collectImportEdges(importEdges, fileToWu, projectRoot, collector);
  collectPackageDependencyEdges(wus, projectRoot, collector);
  return collector.edges;
}

/**
 * Connect packages that declare a workspace dependency in `package.json` but
 * share no file-level edge. This is the "serialize rather than parallelize"
 * direction: a dependency that no source file expresses is still a coupling a
 * parallel dispatch can break.
 *
 * A shared runtime contract — both packages reading the same JSON file — leaves
 * neither an import nor a declared dependency, so it stays uncovered. An edge
 * there would be a guess about a coupling the manifests do not state.
 */
function collectPackageDependencyEdges(
  wus: readonly WorkUnit[],
  projectRoot: string,
  collector: EdgeCollector
): void {
  const packages = loadWorkspacePackages(projectRoot);
  if (packages.length < 2) return;
  const groups = groupWorkUnitsByPackage(wus, packages, projectRoot);
  for (const pkg of packages) {
    const dependentWuIds = groups.get(pkg.name);
    if (dependentWuIds === undefined) continue;
    for (const dependencyName of pkg.dependencyNames) {
      if (dependencyName === pkg.name) continue;
      const dependencyWuIds = groups.get(dependencyName);
      if (dependencyWuIds === undefined) continue;
      if (hasFileLevelEdge(collector.edges, dependentWuIds, dependencyWuIds)) continue;
      for (const from of dependentWuIds) {
        for (const to of dependencyWuIds) {
          pushIfNew(collector, {
            from,
            to,
            kind: 'package-dependency',
            weight: PACKAGE_DEPENDENCY_WEIGHT,
            evidence: `package.json: ${pkg.name} depends on ${dependencyName}`,
            isSemantic: false,
            confidence: 'structural'
          });
        }
      }
    }
  }
}

function groupWorkUnitsByPackage(
  wus: readonly WorkUnit[],
  packages: readonly WorkspacePackage[],
  projectRoot: string
): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const wu of wus) {
    const owner = ownerPackageFor(packages, wu.filePath, projectRoot);
    if (owner === null) continue;
    const ids = groups.get(owner.name) ?? [];
    ids.push(wu.id);
    groups.set(owner.name, ids);
  }
  return groups;
}

/** True when any edge between the two groups came from source, not a manifest. */
function hasFileLevelEdge(
  edges: readonly DependencyEdge[],
  firstIds: readonly string[],
  secondIds: readonly string[]
): boolean {
  const first = new Set(firstIds);
  const second = new Set(secondIds);
  return edges.some(
    (edge) =>
      edge.kind !== 'package-dependency' &&
      ((first.has(edge.from) && second.has(edge.to)) ||
        (first.has(edge.to) && second.has(edge.from)))
  );
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
