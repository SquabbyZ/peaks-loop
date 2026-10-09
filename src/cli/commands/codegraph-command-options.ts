// src/cli/commands/codegraph-command-options.ts
//
// The option shapes every `peaks codegraph <verb>` shares, plus the three
// option-attaching helpers. Split out of `codegraph-commands.ts` so each verb
// group can live in its own module without re-declaring them.

import { type Command, InvalidArgumentError } from 'commander';
import type { CommonCodegraphOptions } from './codegraph-command-runtime.js';

export interface CodegraphIndexOptions extends CommonCodegraphOptions {
  force?: boolean;
  quiet?: boolean;
}

export interface CodegraphQueryOptions extends CommonCodegraphOptions {
  json?: boolean;
  limit?: number;
}

export interface CodegraphFilesOptions extends CommonCodegraphOptions {
  json?: boolean;
  maxDepth?: number;
}

export interface CodegraphAffectedOptions extends CommonCodegraphOptions {
  json?: boolean;
  rid?: string;
  writeEnvelope?: boolean;
}

export function addPeaksJsonOption(command: Command): Command {
  return command.option('--peaks-json', 'print Peaks error envelope as machine-readable JSON');
}

export function addProjectOption(command: Command): Command {
  return addPeaksJsonOption(command.requiredOption('--project <path>', 'target project root'));
}

export function parsePositiveInteger(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new InvalidArgumentError('must be a positive integer');
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError('must be a positive integer');
  }

  return parsed;
}
