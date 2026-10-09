import type { Command } from 'commander';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../../cli-helpers.js';
import { fail } from 'peaks-loop-shared/result';
import { VALID_PROJECT_MEMORY_KINDS } from '../../../services/memory/project-memory-service.js';

import { emitBootstrapFailure } from './memory-command-shared.js';

/** Derived from the canonical kind vocabulary — never hand-maintain a list here. */
const KIND_HELP = VALID_PROJECT_MEMORY_KINDS.join(', ');

type MemoryRunner = (io: ProgramIO, options: never) => unknown;

/** The five run functions the `memory-commands.ts` façade re-exports. */
type MemoryRunNames = {
  runMemoryList: MemoryRunner;
  runMemoryReindex: MemoryRunner;
  runMemoryIngest: MemoryRunner;
  runMemoryRotate: MemoryRunner;
  runMemorySearch: MemoryRunner;
};

type DelegateSpec = {
  readonly command: string;
  readonly code: string;
  readonly json: boolean | undefined;
  readonly nextActions?: readonly string[] | undefined;
};

/**
 * Call a run function from the lazily imported `memory-commands.js`.
 *
 * The dynamic import avoids a top-of-file import cycle (memory-commands.ts
 * imports services the rest of this family also touches).
 */
function delegateMemoryRun(args: {
  io: ProgramIO;
  spec: DelegateSpec;
  options: Record<string, unknown>;
  build: (mod: MemoryRunNames) => MemoryRunner;
}): void {
  void import('../memory-commands.js')
    .then((mod) => {
      void args.build(mod)(args.io, args.options as never);
    })
    .catch((error: unknown) => {
      emitBootstrapFailure(args.io, {
        command: args.spec.command,
        code: args.spec.code,
        message: getErrorMessage(error),
        json: args.spec.json,
        nextActions: args.spec.nextActions
      });
    });
}

/** The bootstrap hint `memory list --pick` gives when fzf is missing or old. */
const FZF_UNAVAILABLE = /brew install fzf|apt-get install fzf|older than required/;
const FZF_MESSAGE =
  'fzf binary not found or too old. Install with: brew install fzf (or apt: apt-get install fzf). peaks memory list --pick requires fzf >= 0.38.';

type ListOptions = {
  kind?: string;
  pick?: boolean;
  fzfBin?: string;
  project?: string;
  summary?: boolean;
  json?: boolean;
};

/**
 * `--pick` needs a real fzf, so a missing binary is its own refusal with its
 * own exit code (127, the shell's "command not found") rather than a generic
 * bootstrap failure.
 */
function listBootstrapFailure(io: ProgramIO, options: ListOptions, error: unknown): void {
  const msg = FZF_UNAVAILABLE.test(getErrorMessage(error)) ? FZF_MESSAGE : getErrorMessage(error);
  const code = FZF_UNAVAILABLE.test(msg) ? 'FZF_UNAVAILABLE' : 'MEMORY_LIST_BOOTSTRAP_FAILED';
  printResult(
    io,
    fail('memory.list', code, msg, {}, [
      'Install fzf or run without --pick to list entries as JSON'
    ]),
    options.json
  );
  if (code === 'FZF_UNAVAILABLE') process.exitCode = 127;
  else process.exitCode = 1;
}

function registerMemoryList(memory: Command, io: ProgramIO): void {
  addJsonOption(
    memory
      .command('list')
      .description(
        'List all memory entries from .peaks/memory/index.json. Pass --pick to spawn fzf for interactive multi-select; the picked subset is written to .peaks/memory/picked.json.'
      )
      .option('--kind <kind>', `filter by memory kind (one of: ${KIND_HELP})`)
      .option(
        '--pick',
        'spawn fzf for interactive multi-select (requires fzf >= 0.38); writes picked.json'
      )
      .option('--fzf-bin <path>', 'override fzf binary path (default: fzf on PATH)', 'fzf')
      .option(
        '--summary',
        'emit counts + names-of-first-N only (≤ 2 KB) instead of the full entry array; the default envelope is unchanged'
      )
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
  ).action((options: ListOptions) => {
    void import('../memory-commands.js')
      .then(({ runMemoryList }) => {
        void runMemoryList(io, {
          ...(options.kind !== undefined ? { kind: options.kind } : {}),
          ...(options.pick === true ? { pick: true } : {}),
          ...(options.fzfBin ? { fzfBin: options.fzfBin } : {}),
          ...(options.project !== undefined ? { project: options.project } : {}),
          ...(options.summary === true ? { summary: true } : {}),
          ...(options.json !== undefined ? { json: options.json } : {})
        });
      })
      .catch((error: unknown) => listBootstrapFailure(io, options, error));
  });
}

function registerMemoryReindex(memory: Command, io: ProgramIO): void {
  addJsonOption(
    memory
      .command('reindex')
      .description(
        'Rebuild .peaks/memory/index.json from every memory file on disk and regenerate MEMORY.md; reports unclassified files and orphans both ways. Dry-run by default; pass --apply to write.'
      )
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
      .option('--dry-run', 'report drift without writing (default)')
      .option('--apply', 'rebuild index.json and regenerate MEMORY.md')
      .option(
        '--summary',
        'emit drift counts + names-of-first-N only (≤ 2 KB) instead of the full arrays; the default envelope is unchanged'
      )
  ).action(
    (options: {
      project?: string;
      dryRun?: boolean;
      apply?: boolean;
      summary?: boolean;
      json?: boolean;
    }) => {
      delegateMemoryRun({
        io,
        spec: {
          command: 'memory.reindex',
          code: 'MEMORY_REINDEX_BOOTSTRAP_FAILED',
          json: options.json
        },
        options: {
          ...(options.project !== undefined ? { project: options.project } : {}),
          ...(options.dryRun === true ? { dryRun: true } : {}),
          ...(options.apply === true ? { apply: true } : {}),
          ...(options.summary === true ? { summary: true } : {}),
          ...(options.json !== undefined ? { json: options.json } : {})
        },
        build: (mod) => mod.runMemoryReindex
      });
    }
  );
}

function registerMemoryIngest(memory: Command, io: ProgramIO): void {
  addJsonOption(
    memory
      .command('ingest')
      .description(
        'Import memories written by the IDE-side agent (~/.claude/projects/<hash>/memory/*.md) into the peaks-owned .peaks/memory store. The IDE-side dir is read-only. Dry-run by default; pass --apply to write.'
      )
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
      .option('--source-dir <path>', 'override the IDE-side memory directory')
      .option('--dry-run', 'preview imports without writing (default)')
      .option('--apply', 'write normalized memories into .peaks/memory')
  ).action(
    (options: {
      project?: string;
      sourceDir?: string;
      dryRun?: boolean;
      apply?: boolean;
      json?: boolean;
    }) => {
      delegateMemoryRun({
        io,
        spec: {
          command: 'memory.ingest',
          code: 'MEMORY_INGEST_BOOTSTRAP_FAILED',
          json: options.json
        },
        options: {
          ...(options.project !== undefined ? { project: options.project } : {}),
          ...(options.sourceDir !== undefined ? { sourceDir: options.sourceDir } : {}),
          ...(options.dryRun === true ? { dryRun: true } : {}),
          ...(options.apply === true ? { apply: true } : {}),
          ...(options.json !== undefined ? { json: options.json } : {})
        },
        build: (mod) => mod.runMemoryIngest
      });
    }
  );
}

function registerMemoryRotate(memory: Command, io: ProgramIO): void {
  addJsonOption(
    memory
      .command('rotate')
      .description(
        'Tier-driven retention for .peaks/memory/ (sediment pruning policy, tier 1: archive only, never delete). Tier assignment: explicit `metadata.tier: A|B|C|D` wins; else files under archived/ are D, files pinned in MEMORY.md are B, kinds rule/convention/project-rule are A, kinds decision/reference/feedback/module/bug/investigation/technical-pattern are B, everything else is C. Tier C older than 6 months (frontmatter updatedAt/updated/modified, else file mtime) and not pinned is archived; tier D is reported as a delete-candidate only. Tier A/B are never selected, every candidate must pass a reference grep against src/ + skills/, and --apply refuses an empty plan or a failed gate. Dry-run by default.'
      )
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
      .option('--dry-run', 'report the rotation plan without moving anything (default)')
      .option('--apply', 'move tier-C candidates into .peaks/memory/archived/')
  ).action((options: { project?: string; dryRun?: boolean; apply?: boolean; json?: boolean }) => {
    delegateMemoryRun({
      io,
      spec: {
        command: 'memory.rotate',
        code: 'MEMORY_ROTATE_BOOTSTRAP_FAILED',
        json: options.json
      },
      options: {
        ...(options.project !== undefined ? { project: options.project } : {}),
        ...(options.dryRun === true ? { dryRun: true } : {}),
        ...(options.apply === true ? { apply: true } : {}),
        ...(options.json !== undefined ? { json: options.json } : {})
      },
      build: (mod) => mod.runMemoryRotate
    });
  });
}

function registerMemorySearch(memory: Command, io: ProgramIO): void {
  addJsonOption(
    memory
      .command('search <query>')
      .description(
        'Fuzzy-search the memory index (deterministic, local, zero-token). Default --limit 6.'
      )
      .option('--kind <kind>', `filter by memory kind (one of: ${KIND_HELP})`)
      .option('--limit <n>', 'maximum number of matches to return', (value: string) =>
        Number(value)
      )
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
  ).action(
    (
      query: string,
      options: { kind?: string; limit?: number; project?: string; json?: boolean }
    ) => {
      delegateMemoryRun({
        io,
        spec: {
          command: 'memory.search',
          code: 'MEMORY_SEARCH_BOOTSTRAP_FAILED',
          json: options.json
        },
        options: {
          query,
          ...(options.kind !== undefined ? { kind: options.kind } : {}),
          ...(options.limit !== undefined ? { limit: options.limit } : {}),
          ...(options.project !== undefined ? { project: options.project } : {}),
          ...(options.json !== undefined ? { json: options.json } : {})
        },
        build: (mod) => mod.runMemorySearch
      });
    }
  );
}

/** The five verbs whose bodies live in `memory-commands.ts`, in shipping order. */
export function registerMemoryDelegatedVerbs(memory: Command, io: ProgramIO): void {
  registerMemoryList(memory, io);
  registerMemoryReindex(memory, io);
  registerMemoryIngest(memory, io);
  registerMemoryRotate(memory, io);
  registerMemorySearch(memory, io);
}
