// src/cli/commands/sediment-command-shared.ts
//
// The envelope and dispatch shapes every `peaks skill sediment` verb handler
// shares. Split out of `sediment-commands.ts`.

import type { ParsedFlags } from './sediment-argv-flags.js';

/** The `{ ok, error?, data? }` envelope every sediment verb returns. */
export interface CliResult {
  ok: boolean;
  error?: string;
  data?: unknown;
}

/** One parsed argv tail: the pool home, the positionals and the flag accessors. */
export type SedimentContext = {
  readonly home: string;
  readonly positional: string[];
  readonly flags: ParsedFlags;
};

/** A verb implementation. `runSediment` owns the error envelope around it. */
export type SedimentVerb = (ctx: SedimentContext) => CliResult | Promise<CliResult>;
