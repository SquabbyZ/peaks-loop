import type { Command } from 'commander';
import { executeProjectMemoryBackup, executeProjectMemoryExtract, summarizeProjectMemoryBackupResult, summarizeProjectMemoryExtractResult } from '../../../services/memory/project-memory-service.js';
import { fail, ok } from '../../../shared/result.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../../cli-helpers.js';

export function registerMemoryCommand(program: Command, io: ProgramIO): void {
  const memory = program.command('memory').description('Manage project-local Peaks memory');
  addJsonOption(
    memory
      .command('extract')
      .description('Extract stable project memory from skill artifacts into project .peaks/memory')
      .requiredOption('--project <path>', 'target project root')
      .requiredOption('--artifact <path...>', 'skill artifact paths inside the project')
      .option('--dry-run', 'preview writes without changing files')
      .option('--apply', 'write extracted memories into project .peaks/memory')
  ).action((options: { project: string; artifact: string[]; dryRun?: boolean; apply?: boolean; json?: boolean }) => {
    if (options.dryRun === true && options.apply === true) {
      printResult(io, fail('memory.extract', 'INVALID_MEMORY_EXTRACT_FLAGS', 'Use either --dry-run or --apply, not both', {}, ['Run without --apply to preview writes, or pass --apply to write memories']), options.json);
      process.exitCode = 1;
      return;
    }
    try {
      const result = executeProjectMemoryExtract({ projectRoot: options.project, artifactPaths: options.artifact, apply: options.apply === true });
      printResult(io, ok('memory.extract', summarizeProjectMemoryExtractResult(result)), options.json);
    } catch (error) {
      printResult(io, fail('memory.extract', 'MEMORY_EXTRACT_FAILED', getErrorMessage(error), {}, ['Check artifact paths and remove secrets before extracting memory']), options.json);
      process.exitCode = 1;
    }
  });
  addJsonOption(
    memory
      .command('sync')
      .description('Back up project .peaks/memory into the artifact workspace')
      .requiredOption('--project <path>', 'target project root')
      .requiredOption('--workspace <path>', 'artifact workspace path')
      .option('--dry-run', 'preview copies without changing files')
      .option('--apply', 'copy project .peaks/memory into artifact workspace backup')
  ).action((options: { project: string; workspace: string; dryRun?: boolean; apply?: boolean; json?: boolean }) => {
    if (options.dryRun === true && options.apply === true) {
      printResult(io, fail('memory.sync', 'INVALID_MEMORY_SYNC_FLAGS', 'Use either --dry-run or --apply, not both', {}, ['Run without --apply to preview copies, or pass --apply to back up memories']), options.json);
      process.exitCode = 1;
      return;
    }
    try {
      const result = executeProjectMemoryBackup({ projectRoot: options.project, artifactWorkspacePath: options.workspace, apply: options.apply === true });
      printResult(io, ok('memory.sync', summarizeProjectMemoryBackupResult(result)), options.json);
    } catch (error) {
      printResult(io, fail('memory.sync', 'MEMORY_SYNC_FAILED', getErrorMessage(error), {}, ['Use an artifact workspace outside the project root']), options.json);
      process.exitCode = 1;
    }
  });

  addJsonOption(
    memory
      .command('list')
      .description('List all memory entries from .peaks/memory/index.json. Pass --pick to spawn fzf for interactive multi-select; the picked subset is written to .peaks/memory/picked.json.')
      .option('--kind <kind>', 'filter by memory kind (one of: project, rule, decision, reference, feedback, convention, module, lesson)')
      .option('--pick', 'spawn fzf for interactive multi-select (requires fzf >= 0.38); writes picked.json')
      .option('--fzf-bin <path>', 'override fzf binary path (default: fzf on PATH)', 'fzf')
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
  ).action((options: { kind?: string; pick?: boolean; fzfBin?: string; project?: string; json?: boolean }) => {
    void import('../memory-commands.js').then(({ runMemoryList }) => {
      void runMemoryList(io, {
        ...(options.kind !== undefined ? { kind: options.kind } : {}),
        ...(options.pick === true ? { pick: true } : {}),
        ...(options.fzfBin ? { fzfBin: options.fzfBin } : {}),
        ...(options.project !== undefined ? { project: options.project } : {}),
        ...(options.json !== undefined ? { json: options.json } : {}),
      });
    }).catch((error: unknown) => {
      const msg = /brew install fzf|apt-get install fzf|older than required/.test(getErrorMessage(error))
        ? 'fzf binary not found or too old. Install with: brew install fzf (or apt: apt-get install fzf). peaks memory list --pick requires fzf >= 0.38.'
        : getErrorMessage(error);
      const code = /brew install fzf|apt-get install fzf|older than required/.test(msg) ? 'FZF_UNAVAILABLE' : 'MEMORY_LIST_BOOTSTRAP_FAILED';
      printResult(io, fail('memory.list', code, msg, {}, ['Install fzf or run without --pick to list entries as JSON']), options.json);
      if (code === 'FZF_UNAVAILABLE') process.exitCode = 127;
      else process.exitCode = 1;
    });
  });

  addJsonOption(
    memory
      .command('search <query>')
      .description('Fuzzy-search the memory index (deterministic, local, zero-token). Default --limit 6. Pass --compress-results to also emit a headroom-compressed text view of the matches for LLM-side prompt assembly.')
      .option('--kind <kind>', 'filter by memory kind (one of: project, rule, decision, reference, feedback, convention, module, lesson)')
      .option('--limit <n>', 'maximum number of matches to return', (value: string) => Number(value))
      .option('--compress-results', 'compress joined match text via headroom-ai (uses preferences.headroom.perTouchpoint.memorySearch mode)')
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
  ).action((query: string, options: { kind?: string; limit?: number; compressResults?: boolean; project?: string; json?: boolean }) => {
    // Lazy import avoids a top-of-file import cycle (memory-commands.ts
    // imports services that the rest of this file may also touch).
    void import('../memory-commands.js').then(({ runMemorySearch }) => {
      void runMemorySearch(io, {
        query,
        ...(options.kind !== undefined ? { kind: options.kind } : {}),
        ...(options.limit !== undefined ? { limit: options.limit } : {}),
        ...(options.compressResults === true ? { compressResults: true } : {}),
        ...(options.project !== undefined ? { project: options.project } : {}),
        ...(options.json !== undefined ? { json: options.json } : {}),
      });
    }).catch((error: unknown) => {
      printResult(io, fail('memory.search', 'MEMORY_SEARCH_BOOTSTRAP_FAILED', getErrorMessage(error), {}, []), options.json);
      process.exitCode = 1;
    });
  });
}
