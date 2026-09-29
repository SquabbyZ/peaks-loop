// ---------------------------------------------------------------------------
// `peaks memory ingest` — support surface.
//
// Split out of `./memory-ingest-service.ts` by the `b1-filesplit-campaign`
// (wave 3, leaf `b1w3-c-memory`): the IDE-side source-dir encoding and the
// frontmatter-normalisation helpers. `./memory-ingest-service.ts` imports
// `defaultIdeMemoryDir` / `renderNormalizedMemory` for its orchestrator and
// re-exports the three public helpers, so `memory-commands.ts` and the ingest
// test keep importing them from `memory-ingest-service.js` unchanged.
// ---------------------------------------------------------------------------

import { homedir } from 'node:os';
import { join } from 'node:path';

import { summarizeMemoryBody } from './project-memory-service/parsers/markdown-pure.js';
import type { ProjectMemoryKind } from './project-memory-service/types.js';

const RESERVED_TOP_LEVEL_KEYS = new Set(['name', 'description', 'metadata', 'type', 'kind']);
const RESERVED_METADATA_KEYS = new Set(['type', 'kind', 'description']);

/**
 * Claude Code encodes a project cwd into its `~/.claude/projects/<name>/`
 * directory by replacing every non-alphanumeric character with `-`
 * (`D:\peaks-loop` → `D--peaks-loop`). Separator-agnostic, so the same
 * encoding holds for POSIX paths.
 */
export function encodeIdeProjectDir(projectRoot: string): string {
  return projectRoot.replace(/[^A-Za-z0-9]/g, '-');
}

/** Default IDE-side memory dir for a project: `~/.claude/projects/<encoded>/memory`. */
export function defaultIdeMemoryDir(projectRoot: string, homeDir?: string): string {
  return join(
    homeDir ?? homedir(),
    '.claude',
    'projects',
    encodeIdeProjectDir(projectRoot),
    'memory'
  );
}

interface FrontmatterDoc {
  top: Array<[string, string]>;
  metadata: Array<[string, string]>;
}

function parseFrontmatterDoc(frontmatter: string): FrontmatterDoc {
  const top: Array<[string, string]> = [];
  const metadata: Array<[string, string]> = [];
  let inMetadata = false;
  for (const rawLine of frontmatter.split('\n')) {
    if (rawLine.trim() === '') continue;
    const indented = /^\s/.test(rawLine);
    const line = rawLine.trim();
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (indented) {
      if (inMetadata) metadata.push([key, value]);
      continue;
    }
    inMetadata = key === 'metadata';
    if (!inMetadata) top.push([key, value]);
  }
  return { top, metadata };
}

/**
 * Rewrite a source file's frontmatter to the peaks contract: `name` pinned to
 * the destination filename stem, and `metadata.type` set to the resolved
 * kind. Non-contract keys (e.g. `originSessionId`, `modified`, `node_type`)
 * are preserved verbatim so provenance survives the import; `type` / `kind`
 * are consumed by the normalization and not duplicated.
 */
export function renderNormalizedMemory(input: {
  stem: string;
  kind: ProjectMemoryKind;
  frontmatter: string;
  body: string;
}): string {
  const doc = parseFrontmatterDoc(input.frontmatter);
  const topMap = new Map(doc.top);
  const metaMap = new Map(doc.metadata);
  const description =
    topMap.get('description') ?? metaMap.get('description') ?? summarizeMemoryBody(input.body);

  const lines: string[] = ['---', `name: ${input.stem}`, `description: ${description}`];
  for (const [key, value] of doc.top) {
    if (RESERVED_TOP_LEVEL_KEYS.has(key)) continue;
    lines.push(`${key}: ${value}`);
  }
  lines.push('metadata:');
  lines.push(`  type: ${input.kind}`);
  for (const [key, value] of doc.metadata) {
    if (RESERVED_METADATA_KEYS.has(key)) continue;
    lines.push(`  ${key}: ${value}`);
  }
  lines.push('---', '', input.body, '');
  return lines.join('\n');
}
