// src/services/codegraph/codegraph-preflight-structure.ts
//
// The declaration + payload-parsing surface of the pre-dispatch codegraph
// preflight (`codegraph-preflight-service.ts`), extracted so the service
// module stays under the repo file-size cap. `codegraph-preflight-service.ts`
// imports these and re-exports the public ones, so importers keep resolving
// every name from the original path.

export type CodegraphPreflightResult =
  | { available: true; block: string; fileCount: number; truncated: boolean }
  | { available: false; note: string };

/** Cap for the directory histogram in the rendered structure block. */
export const CODEGRAPH_STRUCTURE_MAX_DIRS = 40;
/** Cap for bare root files listed in the rendered structure block. */
export const CODEGRAPH_STRUCTURE_MAX_ROOT_FILES = 12;

export interface CodegraphStructureFileEntry {
  readonly path: string;
}

export interface CodegraphStructureRenderOptions {
  readonly maxDirs?: number;
  readonly maxRootFiles?: number;
}

export interface CodegraphStructureSummary {
  /** Full `## Codegraph structure` markdown block, ending on its own paragraph. */
  block: string;
  total: number;
  truncated: boolean;
}

/** Strip a leading `./` (upstream codegraph paths may carry it). */
export function normalizeCodegraphPath(path: string): string {
  return path.startsWith('./') ? path.slice(2) : path;
}

export function parseFilesPayload(stdout: string): {
  ok: boolean;
  entries: CodegraphStructureFileEntry[];
} {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (Array.isArray(parsed)) {
      const entries = parsed
        .filter(
          (entry): entry is { path: unknown } =>
            typeof entry === 'object' && entry !== null && 'path' in entry
        )
        .map((entry) => ({ path: typeof entry.path === 'string' ? entry.path : '' }))
        .filter((entry) => entry.path.length > 0);
      return { ok: true, entries };
    }
    // JSON but not an array — not the shape we expect.
    return { ok: false, entries: [] };
  } catch {
    // Not JSON at all — e.g. the upstream text path ("No files indexed…").
    return { ok: false, entries: [] };
  }
}
