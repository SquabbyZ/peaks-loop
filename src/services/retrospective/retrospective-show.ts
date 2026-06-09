/**
 * retrospective-show — load one retrospective entry by id, synthesize the
 * body on-demand from `artifactPaths` (concatenate with `---` separator),
 * apply `formatMdCompact` by default, return the JSON envelope.
 *
 * Slice 023 (R3). The on-disk MD form is gone after the G9 migration; the
 * body is re-hydrated from the source PRD / RD / QA / TXT artifacts. If
 * a referenced artifact is missing on disk, `show` returns a
 * `ARTIFACT_MISSING` envelope (PRD R3) and does not crash.
 *
 * Stale policy is **not** applied to retrospective in this slice
 * (per PRD G7 / R3 scope). The helper exists for a future slice.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { formatMdCompact } from '../../shared/format-md-compact.js';
import { loadRetrospectiveIndex, type RetrospectiveEntry, type RetrospectiveIndexResult } from './retrospective-index.js';

export type RetrospectiveFormat = 'compact' | 'pretty';

export interface RetrospectiveShowOptions {
  projectRoot: string;
  id: string;
  format?: RetrospectiveFormat;
}

export interface RetrospectiveShowSuccess {
  ok: true;
  projectRoot: string;
  format: RetrospectiveFormat;
  entry: RetrospectiveEntry;
  body: string;
  warnings: string[];
}

export interface RetrospectiveShowError {
  ok: false;
  code: 'NOT_FOUND' | 'INDEX_MISSING' | 'ARTIFACT_MISSING' | 'INVALID_REQUEST';
  message: string;
  hint?: string;
  projectRoot: string;
  missingArtifacts?: string[];
}

export type RetrospectiveShowResult = RetrospectiveShowSuccess | RetrospectiveShowError;

export function showRetrospective(options: RetrospectiveShowOptions): RetrospectiveShowResult {
  if (typeof options.id !== 'string' || options.id.trim().length === 0) {
    return {
      ok: false,
      code: 'INVALID_REQUEST',
      message: 'retrospective show requires a non-empty <id> argument',
      projectRoot: resolve(options.projectRoot)
    };
  }

  const resolvedRoot = resolve(options.projectRoot);
  const index = loadRetrospectiveIndex(resolvedRoot);
  if (index.source === null) {
    return {
      ok: false,
      code: 'INDEX_MISSING',
      message: index.warning ?? `retrospective index not found at ${index.indexPath}`,
      hint: 'run `peaks retrospective migrate --apply` to build the index',
      projectRoot: resolvedRoot
    };
  }

  const entry = index.entries.find((e) => e.id === options.id);
  if (entry === undefined) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: `retrospective entry not found: ${options.id}`,
      hint: 'run `peaks retrospective index --json` to see available ids',
      projectRoot: resolvedRoot
    };
  }

  const format: RetrospectiveFormat = options.format ?? 'compact';
  const synthesis = synthesizeBody(entry, resolvedRoot);
  const body = format === 'pretty' ? synthesis.body : formatMdCompact(synthesis.body);
  const warnings = synthesis.warnings;

  return {
    ok: true,
    projectRoot: resolvedRoot,
    format,
    entry,
    body,
    warnings
  };
}

interface BodySynthesis {
  body: string;
  warnings: string[];
}

function synthesizeBody(entry: RetrospectiveEntry, projectRoot: string): BodySynthesis {
  if (entry.artifactPaths.length === 0) {
    return { body: renderEntryHeader(entry), warnings: ['entry has no artifactPaths; body is the index summary only'] };
  }

  const sections: string[] = [];
  const warnings: string[] = [];
  for (const relativePath of entry.artifactPaths) {
    const absolutePath = join(projectRoot, relativePath);
    if (!existsSync(absolutePath)) {
      warnings.push(`artifact missing on disk: ${relativePath}`);
      continue;
    }
    try {
      const content = readFileSync(absolutePath, 'utf8');
      sections.push(`## ${relativePath}\n\n${content}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`failed to read ${relativePath}: ${message}`);
    }
  }

  const header = renderEntryHeader(entry);
  const body = sections.length === 0
    ? `${header}\n\n_No artifacts available; only the index summary is shown._`
    : `${header}\n\n${sections.join('\n\n---\n\n')}`;

  return { body, warnings };
}

function renderEntryHeader(entry: RetrospectiveEntry): string {
  const lines: string[] = [
    `# ${entry.title}`,
    '',
    `- id: ${entry.id}`,
    `- session: ${entry.sessionId}`,
    ...(entry.sliceId !== undefined ? [`- slice: ${entry.sliceId}`] : []),
    `- type: ${entry.type}`,
    `- outcome: ${entry.outcome}`,
    `- updatedAt: ${entry.updatedAt}`,
    `- lessonsLearned: ${entry.lessonsLearned}`,
    ''
  ];
  if (entry.keyDecisions.length > 0) {
    lines.push('## Key Decisions', '', ...entry.keyDecisions.map((decision) => `- ${decision}`), '');
  }
  if (entry.summary.length > 0) {
    lines.push('## Summary', '', entry.summary, '');
  }
  return lines.join('\n');
}

export { loadRetrospectiveIndex };
export type { RetrospectiveEntry, RetrospectiveIndexResult };
