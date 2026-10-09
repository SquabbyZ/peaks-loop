/**
 * `peaks skill sediment <verb>` — Sediment pool CLI primitives.
 *
 * Slices 2026-07-04-cli-15a (Task 15a) and 2026-07-04-cli-15b (Task 15b)
 * of the 18-verb plan. This file implements 8 of 18 verbs:
 *
 *   Task 15a:
 *     add-segment   — scaffold ~/.peaks/skills/segments/<name>/SKILL.md
 *     add-bee       — write ~/.peaks/skills/bees/<name>/manifest.json
 *     list          — read index.json via readPool
 *     rebuild-index — rewrite index.json from filesystem state
 *
 *   Task 15b:
 *     refine-bee    — append a NL-described patch to an existing bee manifest
 *     clone-bee     — duplicate an existing bee to a new name, status reset
 *     promote       — flip candidate → stable when PromotionGate passes
 *     retire        — flip → retired, optionally record a reason
 *
 * Other verbs (dispose / releases / release-show / release-diff / export /
 * import / gc-blobs / search / recent / show) return
 * `{ ok: false, error: "UNKNOWN_VERB: …" }` until Tasks 15c / 15d fill them.
 *
 * The CLI boundary is runSediment(argv, { home }): it returns a
 * `{ ok, error?, data? }` envelope so program.ts can render the result
 * as JSON via peaks-cli's existing printResult primitive.
 *
 * The verb bodies live beside this file — `sediment-pool-commands.ts` (the
 * pool verbs), `sediment-release-commands.ts` (the retained-release verbs)
 * and `sediment-query-commands.ts` (the read-only verbs) — with the argv
 * parser in `sediment-argv-flags.ts`. This module owns the dispatch table,
 * `parseFlags`' re-export and the commander registration.
 */
import type { Command } from 'commander';
import { SYSTEM_PATH_FORBIDDEN } from '../../services/sediment/pool-paths.js';
import { peaksHome } from '../../services/sop/sop-paths.js';
import { type ProgramIO, printCliEnvelope } from '../cli-helpers.js';
import { parseFlags } from './sediment-argv-flags.js';
import type { CliResult, SedimentVerb } from './sediment-command-shared.js';
import {
  addBee,
  addSegment,
  cloneBee,
  listPool,
  promote,
  rebuildIndex,
  refineBee,
  retire
} from './sediment-pool-commands.js';
import {
  dispose,
  exportVerb,
  gcBlobsVerb,
  importVerb,
  releaseDiffVerb,
  releaseShow,
  releases
} from './sediment-release-commands.js';
import { recent, search, show } from './sediment-query-commands.js';

// Re-exported so the split is invisible to importers of THIS path.
export { ParsedFlags, parseFlags } from './sediment-argv-flags.js';
export type { CliResult } from './sediment-command-shared.js';

/**
 * Every verb the pool answers, keyed by the first positional. A `Map` rather
 * than an object literal on purpose: `Object.prototype` names
 * (`toString`, `constructor`, …) would otherwise resolve to an inherited
 * function and dispatch a verb that does not exist.
 */
const VERBS: ReadonlyMap<string, SedimentVerb> = new Map<string, SedimentVerb>([
  ['add-segment', addSegment],
  ['add-bee', addBee],
  ['list', listPool],
  ['rebuild-index', rebuildIndex],
  ['refine-bee', refineBee],
  ['clone-bee', cloneBee],
  ['promote', promote],
  ['retire', retire],
  ['dispose', dispose],
  ['releases', releases],
  ['release-show', releaseShow],
  ['release-diff', releaseDiffVerb],
  ['export', exportVerb],
  ['import', importVerb],
  ['gc-blobs', gcBlobsVerb],
  ['search', search],
  ['recent', recent],
  ['show', show]
]);

/** Dispatch a sediment verb argv to the matching implementation.
 *
 * Returns { ok: true, data? } on success and { ok: false, error }
 * on validation failure or SYSTEM_PATH_FORBIDDEN. Unknown verbs
 * return `{ ok: false, error: "UNKNOWN_VERB: <v>" }` so callers can
 * distinguish "not yet implemented" from "zod rejected".
 */
export async function runSediment(argv: string[], { home }: { home: string }): Promise<CliResult> {
  const { positional, flags } = parseFlags(argv);
  const verb = positional[0];
  try {
    const handler = verb === undefined ? undefined : VERBS.get(verb);
    if (handler === undefined) {
      return { ok: false, error: `UNKNOWN_VERB: ${verb ?? ''}` };
    }
    return await handler({ home, positional, flags });
  } catch (e: unknown) {
    if (e instanceof SYSTEM_PATH_FORBIDDEN) {
      return { ok: false, error: e.message };
    }
    const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : String(e);
    return { ok: false, error: msg };
  }
}

/** Resolve the `peaks skill` parent command from the program tree,
 *  creating it lazily when program.ts hasn't already registered
 *  the skill command (matches the pattern in
 *  src/cli/commands/workflow-plan-commands.ts:179).
 *
 *  Ordering note (T15a.1 future-proofing): `program.command("skill")` lazily
 *  registers a Command with description "Manage Peaks skills". If a future
 *  slice adds another `peaks skill <sub>` command (e.g. `peaks skill list`),
 *  it MUST be registered BEFORE sediment/adapter commands so that the first
 *  registration wins and the description is consistent. Today only sediment
 *  exists, so the lazy lookup is safe.
 */
function getOrCreateSkillCmd(program: Command): Command {
  const existing = program.commands.find((c) => c.name() === 'skill');
  if (existing !== undefined) return existing;
  return program.command('skill').description('Manage Peaks skills');
}

/** Register the `peaks skill sediment <verb>` subcommand group.
 *
 *  Task 15a wired 4 verbs; Task 15b adds 4 more (refine-bee / clone-bee /
 *  promote / retire). The subcommand accepts variadic args so caller-side
 *  code (peaks-cli action handler) can re-dispatch to `runSediment` for
 *  the actual verb routing. Subsequent tasks (15c / 15d) will add the
 *  remaining 10 verbs by extending the `runSediment` switch statement.
 */
export function registerSedimentCommands(program: Command, io: ProgramIO): void {
  const skill = getOrCreateSkillCmd(program);
  skill
    .command('sediment <args...>')
    .description('Sediment pool operations (LLM-coordinated; see peaks-maker skill)')
    .action(async (args: string[]) => {
      // D-018: peaks-loop's `state.db` (loop engineering + bee sediment pool)
      // lives at PEAKS_HOME-based path, NOT under the project root. The
      // original `process.env.HOME ?? USERPROFILE ?? process.cwd()` would
      // resolve `home` to cwd when invoked from a project (e.g.
      // `peaks skill sediment list` from peaks-loop/), producing
      // `<project>/.peaks/state.db` — wrong. Per design contract
      // (peaks-maker SKILL.md §22 + sop-paths.ts §29), the canonical
      // home is `~/.peaks` (or PEAKS_HOME override for test isolation).
      const home = peaksHome();
      const r = await runSediment(args, { home });
      // Delegate the JSON rendering AND the process.exitCode side-effect
      // to the shared CLI shim helper (Critical #1 fix). The library
      // function runSediment itself never mutates process.exitCode —
      // it just returns { ok, error? } — so non-CLI callers (vitest,
      // programmatic dispatch) can re-use it without leaking an exit
      // code into the host process.
      printCliEnvelope(io, r);
    });
}
