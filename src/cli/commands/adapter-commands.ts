/**
 * `peaks skill adapter <verb>` — adapter selection + detection CLI.
 *
 * Slice 2026-07-04-cli-15a (Task 15a of the 18-verb plan). Two verbs:
 *
 *   list        — return the known adapter id list
 *   set-active  — record which adapter is currently active
 *
 * Unknown verbs return an empty result so program.ts can render a
 * NOT_FOUND envelope without throwing.
 */
import type { Command } from "commander";
import type { ProgramIO } from "../cli-helpers.js";

export interface AdapterResult {
  adapters?: string[];
  active?: string;
}

/** Dispatch an adapter verb. `home` is accepted for API symmetry
 *  with runSediment, but the in-scope verbs don't read from disk yet. */
export async function runAdapter(
  argv: string[],
  { home: _home }: { home: string }
): Promise<AdapterResult> {
  const verb = argv[0];
  if (verb === "list") {
    return { adapters: ["claude", "codex", "copilot"] };
  }
  if (verb === "set-active") {
    const name = argv[1];
    if (name === undefined) return {};
    return { active: name };
  }
  return {};
}

/** Register the `peaks skill adapter <verb>` subcommand group.
 *
 *  Matches the pattern used by sediment-commands.ts: the `skill`
 *  parent command is reused when present, created lazily otherwise.
 *  See src/cli/commands/workflow-plan-commands.ts:179 for the
 *  precedent.
 */
export function registerAdapterCommands(program: Command, io: ProgramIO): void {
  const existingSkill = program.commands.find((c) => c.name() === "skill");
  const skill =
    existingSkill ??
    program.command("skill").description("Manage Peaks skills");

  skill
    .command("adapter <args...>")
    .description("Adapter selection and detection")
    .action(async (args: string[]) => {
      const home =
        process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();
      const r = await runAdapter(args, { home });
      io.stdout(JSON.stringify(r));
    });
}
