/**
 * Slice Decomposition Service -- default runners.
 *
 * See `.peaks/_runtime/2026-06-13-session-86d852/sc/slice-algorithm-design.md`
 * for the full spec. This module hosts the 3 default runner factories
 * (CLI-mode, real shell-outs) used by `decomposeSlices` when the caller
 * does not inject fakes via `DecomposeOptions`. The 6-stage pure
 * algorithm itself lives in `slice-decompose-service.ts`.
 *
 * Public surface (2 exported factories):
 *
 *   defaultCodegraphRunner()  -- spawns `npx codegraph <cmd>`
 *   defaultImportEdgeRunner() -- reads source files for import statements
 *
 * v2.18.3 file-split: this module is the extracted sub-tree of the
 * pre-split `slice-decompose-service.ts`. Function signatures are
 * unchanged (verbatim move).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { z } from 'zod';
import { parseJson } from '../../shared/json-parse.js';
import { resolveNpxInvocation } from '../lint/npx-resolver.js';
// 2026-09-10: the D1 fix (`orchestrator-can-do.ts`) resolved this tree's own CLI
// entry so a bare `peaks` never had to be resolved through a Windows `.cmd`
// shim. `runCodegraph` below needs exactly that, so it reuses the same helper
// rather than growing a second mechanism.
import { cliEntryPath, interpreterArgs } from '../web/daemon-supervisor.js';
import type {
  CodegraphAffectedResult,
  CodegraphQueryHit,
  CodegraphRunner,
  ImportEdge,
  ImportEdgeRunner
} from './slice-decompose-types.js';

/**
 * The two `codegraph … --json` stdout shapes these runners consume.
 *
 * WHY THESE EXIST (batch B4). `JSON.parse(stdout)` is `any`, so `runCodegraph`
 * — a subprocess whose stdout is not under this module's control — was the
 * entry for eight `no-unsafe-*` findings: three `no-unsafe-assignment` on the
 * parse plus five reads (`parsed.changedFiles`, `.affectedTests`,
 * `.totalDependentsTraversed`) with nothing behind them. The declarations in
 * `slice-decompose-types.js` (`CodegraphAffectedResult`) are the contract these
 * two schemas now actually enforce, instead of the parse silently claiming it.
 *
 * `query`'s schema is `z.array(z.unknown())` and NOT a deeper envelope, and
 * that is a measured choice: an element without `node` is DROPPED by the
 * per-entry guard below rather than failing the whole response, and the guard
 * tolerates `id` / `kind` / `name` / `filePath` / `score` being any JSON value
 * (each is run through `String(...)` / `Number(...)`). A stricter element
 * schema would turn one odd upstream row into an empty result set.
 */
const codegraphQueryOutputSchema = z.array(z.unknown());

/**
 * `codegraph affected --json` stdout. Every field is `.optional()` because the
 * `?? files` / `?? []` / `?? 0` defaults below were already the reading of a
 * missing field — and because the `catch` fallback is those same three values,
 * a response that misses this schema lands on exactly the value the old
 * `any`-typed read produced.
 */
const codegraphAffectedOutputSchema = z.object({
  changedFiles: z.array(z.string()).optional(),
  affectedTests: z.array(z.string()).optional(),
  totalDependentsTraversed: z.number().optional()
});

export function defaultCodegraphRunner(): CodegraphRunner {
  return {
    async query(text, projectRoot) {
      try {
        const stdout = runCodegraph(
          ['query', text, '--json', '--project', projectRoot],
          projectRoot
        );
        // The envelope is an ARRAY; the elements are heterogeneous — an entry
        // that carries no `node` is dropped by the guard below rather than
        // rejected as a whole, which is what the per-entry check has always
        // done. `z.array(z.unknown())` is therefore the exact replacement for
        // the `Array.isArray(parsed)` guard it supersedes: a non-array now
        // misses the schema and lands in the same `catch` as a non-parseable
        // stdout, whose fallback (`[]`) is what the old `return []` returned.
        const parsed = parseJson(stdout, codegraphQueryOutputSchema);
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
          .filter(
            (h: CodegraphQueryHit | null): h is CodegraphQueryHit => h !== null && h.filePath !== ''
          );
      } catch {
        return [];
      }
    },
    async affected(files, projectRoot): Promise<CodegraphAffectedResult> {
      try {
        const stdout = runCodegraph(
          ['affected', ...files, '--json', '--project', projectRoot],
          projectRoot
        );
        const parsed = parseJson(stdout, codegraphAffectedOutputSchema);
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
  const execOptions = {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true
  };
  // Use `peaks codegraph` (the peaks wrapper), which adds --project support.
  // 2026-09-10: no shell. `peaks` on Windows is a `.cmd` shim, which Node >= 20
  // refuses to spawn without `shell: true` — and `shell: true` concatenates the
  // argv unescaped, so `--project <projectRoot>` was split at the first space in
  // the project path (the same defect that made `peaks slice check` report a
  // phantom failure on such a project). Resolving this tree's own CLI entry and
  // running it through `process.execPath` needs no shim and no shell, so a
  // spaced `projectRoot` is just an argument again.
  try {
    return execFileSync(
      process.execPath,
      [...interpreterArgs(cliEntryPath()), 'codegraph', ...args],
      execOptions
    ).toString('utf8');
  } catch (error: unknown) {
    const err = error as { code?: string; status?: number };
    if (err.code === 'ENOENT') {
      // Fallback: raw `codegraph` (won't accept --project, drop it), reached
      // through the npx resolver so the local `.bin` shim is never spawned.
      const fallbackArgs = args.filter((a) => a !== '--project' && !a.startsWith('--project='));
      const {
        command,
        args: npxArgs,
        baseEnv
      } = resolveNpxInvocation(['codegraph', ...fallbackArgs]);
      return execFileSync(command, npxArgs, { ...execOptions, env: baseEnv }).toString('utf8');
    }
    throw error;
  }
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
          const importRe =
            /import\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)?\s*(?:,\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+))?\s*from\s+['"]([^'"]+)['"]/g;
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
          // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
          // Skip unreadable files
        }
      }
      return edges;
    }
  };
}
