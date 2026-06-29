/**
 * Slice Decomposition Service -- default runners.
 *
 * See `.peaks/_runtime/2026-06-13-session-86d852/sc/slice-algorithm-design.md`
 * for the full spec. This module hosts the 3 default runner factories
 * (CLI-mode, real shell-outs) used by `decomposeSlices` when the caller
 * does not inject fakes via `DecomposeOptions`. The 6-stage pure
 * algorithm itself lives in `slice-decompose-service.ts`.
 *
 * Public surface (3 exported factories):
 *
 *   defaultCodegraphRunner()  -- spawns `npx codegraph <cmd>`
 *   defaultUnderstandRunner() -- reads .understand-anything/knowledge-graph.json
 *   defaultImportEdgeRunner() -- reads source files for import statements
 *
 * v2.18.3 file-split: this module is the extracted sub-tree of the
 * pre-split `slice-decompose-service.ts`. Function signatures are
 * unchanged (verbatim move).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import type {
  CodegraphAffectedResult,
  CodegraphQueryHit,
  CodegraphRunner,
  ImportEdge,
  ImportEdgeRunner,
  UnderstandRunner
} from './slice-decompose-types.js';

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
      } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
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
        } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
          // Skip unreadable files
        }
      }
      return edges;
    }
  };
}
