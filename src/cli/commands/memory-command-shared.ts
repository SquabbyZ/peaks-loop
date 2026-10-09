// src/cli/commands/memory-command-shared.ts
//
// What every `peaks memory` run function shares: the option types the Commander
// wiring in `core/memory-command.ts` feeds them, the project-root resolution,
// the kind filter, and the one place a refused run becomes an envelope. Split
// out of `memory-commands.ts` so each verb can live in its own module.
//
// The five run functions used to repeat the same twelve-line catch block, each
// with its own `(error as { code?: string }).code ?? '<VERB>_FAILED'` and its
// own suggestion list. `memoryFailure` is that block once; the per-verb
// fallback code, the code-keyed hints and the default suggestion are the only
// things that ever differed.

import { fail, getErrorMessage, type ResultEnvelope } from 'peaks-loop-shared/result';

import { findProjectRoot } from '../../services/config/config-safety.js';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import type { ProjectMemoryKind } from '../../services/memory/memory-search-service.js';
import { VALID_PROJECT_MEMORY_KINDS } from '../../services/memory/project-memory-service.js';

export interface MemorySearchCommandOptions {
  query: string;
  kind?: string;
  limit?: number;
  project?: string;
  json?: boolean;
}

export interface MemoryListCommandOptions {
  kind?: string;
  pick?: boolean;
  fzfBin?: string;
  project?: string;
  json?: boolean;
  /** Slice B: emit counts + names-of-first-N instead of the full entry array. */
  summary?: boolean;
}

export interface MemoryReindexCommandOptions {
  project?: string;
  dryRun?: boolean;
  apply?: boolean;
  json?: boolean;
  /** Slice B: emit counts + names-of-first-N instead of the full arrays. */
  summary?: boolean;
}

export interface MemoryIngestCommandOptions {
  project?: string;
  sourceDir?: string;
  dryRun?: boolean;
  apply?: boolean;
  json?: boolean;
}

export interface MemoryRotateCommandOptions {
  project?: string;
  dryRun?: boolean;
  apply?: boolean;
  json?: boolean;
}

/** `--project` canonicalised, else the nearest project root above cwd, else cwd. */
export function resolveMemoryProjectRoot(project?: string): string {
  return project !== undefined
    ? resolveCanonicalProjectRoot(project)
    : (findProjectRoot(process.cwd()) ?? process.cwd());
}

/** The CLI kind flag, narrowed to the canonical vocabulary; unknown ⇒ no filter. */
export function resolveKindFilter(kind: string | undefined): ProjectMemoryKind | undefined {
  return kind !== undefined && VALID_PROJECT_MEMORY_KINDS.includes(kind as ProjectMemoryKind)
    ? (kind as ProjectMemoryKind)
    : undefined;
}

/**
 * The failed envelope for a memory verb: the error's own `code` when it carries
 * one, the verb's `<VERB>_FAILED` otherwise. `byCode` names the one action worth
 * recommending for a specific failure; anything else falls back to
 * `suggestions`, so a caller that has no code-specific advice omits it.
 */
export function memoryFailure(input: {
  readonly command: string;
  readonly fallbackCode: string;
  readonly error: unknown;
  readonly projectRoot: string;
  readonly suggestions?: readonly string[];
  readonly byCode?: Readonly<Record<string, string>>;
}): ResultEnvelope<{ projectRoot: string }> {
  const code = (input.error as { code?: string }).code ?? input.fallbackCode;
  const hint = input.byCode?.[code];
  return fail(
    input.command,
    code,
    getErrorMessage(input.error),
    { projectRoot: input.projectRoot },
    hint === undefined ? [...(input.suggestions ?? [])] : [hint]
  );
}
