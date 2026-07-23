/**
 * `peaks adapter *` — vendor adapter registry CLI surface.
 *
 * Slice S2-a of RD-2 (2026-07-08 session). Two subcommands:
 *
 *   list     — list registered user adapters (persisted at
 *              `.peaks/runtime/adapters.json`).
 *   register — register a new adapter. Vendor verb strings live in
 *              the binary the user picks, NOT in peaks-loop source.
 *
 * This file coexists with the older `adapter-commands.ts` (slice
 * 2026-07-04-cli-15a) which exposes `peaks skill adapter <verb>` —
 * a different surface for skill materialization (resolveScratchDir /
 * materialize / publish). The two surfaces do NOT collide because
 * one is `peaks skill adapter` and the other is `peaks adapter`.
 */
import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok, getErrorMessage } from 'peaks-loop-shared/result';

import { AdapterRegistry, type AdapterRecord } from '../../services/adapter/adapter-registry.js';
import { registryFileFor } from './runtime-commands-helpers.js';

export interface AdapterListOptions {
  json?: boolean;
  project?: string;
}

export interface AdapterRegisterOptions {
  json?: boolean;
  id?: string;
  /** Display name override (defaults to the id). */
  name?: string;
  binary?: string;
  /** Repeated --arg values. */
  arg?: string[];
  force?: boolean;
  project?: string;
}

function resolveProjectRoot(explicit: string | undefined): string {
  if (explicit !== undefined && explicit.length > 0) return explicit;
  return process.cwd();
}

export function registerAdapterS2ACommands(program: Command, io: ProgramIO): void {
  const adapter = program
    .command('adapter')
    .description('Vendor adapter registry (user-registered, persisted to .peaks/runtime/adapters.json)');

  // -----------------------------------------------------------------
  // 1. peaks adapter list [--json] [--project <root>]
  // -----------------------------------------------------------------
  addJsonOption(
    adapter
      .command('list')
      .description('List user-registered vendor adapters')
      .option('--project <path>', 'project root (defaults to cwd)')
  ).action((options: AdapterListOptions) => {
    try {
      const projectRoot = resolveProjectRoot(options.project);
      const file = registryFileFor(projectRoot);
      const reg = new AdapterRegistry();
      if (existsSync(file)) reg.load(file);
      const records = reg.list();
      printResult(io, ok('adapter.list', { projectRoot, file, records, count: records.length }, [], [
        records.length === 0
          ? 'No adapters registered yet. Run `peaks adapter register --id <vendor> --binary <cmd>` to add one.'
          : `Run \`peaks compact auto --project <repo> --json\` to invoke the capability-first control plane.`
      ]), options.json);
    } catch (error) {
      printResult(io, fail('adapter.list', 'ADAPTER_LIST_FAILED', getErrorMessage(error), {}, []), options.json);
      process.exitCode = 1;
    }
  });

  // -----------------------------------------------------------------
  // 2. peaks adapter register --id <id> --binary <cmd> [--arg <a>]... [--force]
  // -----------------------------------------------------------------
  addJsonOption(
    adapter
      .command('register')
      .description('Register a new vendor adapter; persists to .peaks/runtime/adapters.json')
      .requiredOption('--id <id>', 'vendor adapter id (lowercase, e.g. my-cli)')
      .option('--name <name>', 'human-readable display name (defaults to <id>)')
      .requiredOption('--binary <cmd>', 'binary name to invoke for compact (e.g. my-cli)')
      .option('--arg <value>', 'extra arg appended before --force (repeatable)', (value: string, previous: string[] = []) => [...previous, value])
      .option('--force', 'overwrite an existing adapter with the same id')
      .option('--project <path>', 'project root (defaults to cwd)')
  ).action((options: AdapterRegisterOptions) => {
    try {
      const projectRoot = resolveProjectRoot(options.project);
      const file = registryFileFor(projectRoot);
      const reg = new AdapterRegistry();
      if (existsSync(file)) reg.load(file);

      const id = options.id ?? '';
      const record: AdapterRecord = options.arg !== undefined
        ? { id, displayName: options.name ?? id, binary: options.binary ?? '', args: options.arg }
        : { id, displayName: options.name ?? id, binary: options.binary ?? '' };

      let result: { record: AdapterRecord; created: boolean };
      try {
        result = reg.register(record, { force: options.force === true });
      } catch (validationError) {
        printResult(io, fail('adapter.register', 'INVALID_ADAPTER_RECORD', getErrorMessage(validationError), { id }, [
          'Use --id with /^[a-z0-9][a-z0-9._-]*$/, --binary as a binary name (no path separators).'
        ]), options.json);
        process.exitCode = 1;
        return;
      }

      reg.persist(file);

      const warnings: string[] = [];
      if (!result.created && options.force !== true) {
        warnings.push(`adapter "${id}" already registered; pass --force to overwrite`);
      }

      printResult(io, ok('adapter.register', {
        projectRoot,
        file,
        adapter: result.record,
        created: result.created
      }, warnings, [
        `Run \`peaks compact auto --project <repo> --json\` to invoke the capability-first control plane.`
      ]), options.json);
    } catch (error) {
      printResult(io, fail('adapter.register', 'ADAPTER_REGISTER_FAILED', getErrorMessage(error), {}, []), options.json);
      process.exitCode = 1;
    }
  });
}