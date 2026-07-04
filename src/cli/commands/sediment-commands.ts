/**
 * `peaks skill sediment <verb>` — Sediment pool CLI primitives.
 *
 * Slice 2026-07-04-cli-15a (Task 15a of the 18-verb plan). This file
 * implements the FIRST FOUR of 18 verbs in scope:
 *
 *   add-segment  — scaffold ~/.peaks/skills/segments/<name>/SKILL.md
 *   add-bee      — write ~/.peaks/skills/bees/<name>/manifest.json
 *   list         — read index.json via readPool
 *   rebuild-index — rewrite index.json from filesystem state
 *
 * Other verbs (refine-bee / clone-bee / promote / retire / dispose /
 * releases / release-show / release-diff / export / import / gc-blobs /
 * search / recent / show) return `{ ok: false, error: "UNKNOWN_VERB: …" }`
 * in Task 15a. Tasks 15b / 15c / 15d will fill them in.
 *
 * The CLI boundary is runSediment(argv, { home }): it returns a
 * `{ ok, error?, data? }` envelope so program.ts can render the result
 * as JSON via peaks-cli's existing printResult primitive.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import {
  SYSTEM_PATH_FORBIDDEN,
  assertNotSystemPath,
  resolveSegmentsDir,
} from "../../services/sediment/pool-paths.js";
import { writeBeeManifest } from "../../services/sediment/pool-write.js";
import { readPool } from "../../services/sediment/pool-read.js";
import { rebuildIndexFromFs } from "../../services/sediment/pool-rebuild-index.js";
import type { BeeManifest } from "../../services/sediment/types.js";
import type { ProgramIO } from "../cli-helpers.js";

export interface CliResult {
  ok: boolean;
  error?: string;
  data?: unknown;
}

/** Parse an argv tail into positional args + flag map.
 *
 * Supports:
 *   --flag value    → flags[flag] = value (advance i by 1)
 *   --flag          → flags[flag] = true  (when next token starts with `--` or is undefined)
 *
 * This handles the brief's `--describe "d"`, `--apply` (boolean), and
 * `--segment seg-a` shapes uniformly.
 */
export function parseFlags(argv: string[]): {
  positional: string[];
  flags: Record<string, string | boolean>;
} {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) {
        flags[k] = true;
      } else {
        flags[k] = v;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

/** Dispatch a sediment verb argv to the matching implementation.
 *
 * Returns { ok: true, data? } on success and { ok: false, error }
 * on validation failure or SYSTEM_PATH_FORBIDDEN. Unknown verbs
 * return `{ ok: false, error: "UNKNOWN_VERB: <v>" }` so callers can
 * distinguish "not yet implemented" from "zod rejected".
 */
export async function runSediment(
  argv: string[],
  { home }: { home: string }
): Promise<CliResult> {
  const { positional, flags } = parseFlags(argv);
  const verb = positional[0];
  try {
    switch (verb) {
      case "add-segment": {
        const name = positional[1];
        if (!name) return { ok: false, error: "MISSING_ARG: name" };
        const description =
          typeof flags.describe === "string" ? flags.describe : "";
        const segDir = join(resolveSegmentsDir({ home }), name);
        // Soft-protection guard: refuse to write under any `.system` path
        // segment. Mirrors the same guard in writeBeeManifest.
        assertNotSystemPath(segDir);
        mkdirSync(segDir, { recursive: true });
        writeFileSync(
          join(segDir, "SKILL.md"),
          `---\nname: ${name}\ndescription: ${description}\n---\n`
        );
        rebuildIndexFromFs({ home });
        return { ok: true };
      }
      case "add-bee": {
        const name = positional[1];
        if (!name) return { ok: false, error: "MISSING_ARG: name" };
        // Collect --segment values; the brief uses repeatable --segment
        // flags (one token per segment).
        const segList: string[] = [];
        for (const [k, v] of Object.entries(flags)) {
          if (k === "segment" && typeof v === "string") segList.push(v);
        }
        const description =
          typeof flags.description === "string" ? flags.description : "";
        const m: BeeManifest = {
          schemaVersion: "peaks.bee/1",
          name,
          source: "user",
          promotion_status: "candidate",
          description,
          segments: segList.map((s) => ({
            name: s,
            inputs: [],
            outputs: [],
            sideEffects: [],
          })),
          entrypoint: { preamble: `## ${name}`, refs: [] },
          promotion: {
            minCycles: 1,
            requiresHumanApproval: true,
            requiresSmokeTest: true,
          },
          createdBy: "llm",
          lastTouchedAt: new Date().toISOString(),
        };
        // writeBeeManifest runs zod validation + SYSTEM_PATH_FORBIDDEN
        // guard internally.
        writeBeeManifest({ home }, m);
        rebuildIndexFromFs({ home });
        return { ok: true };
      }
      case "list": {
        const idx = readPool({ home });
        return { ok: true, data: idx.entries };
      }
      case "rebuild-index": {
        const idx = rebuildIndexFromFs({ home });
        return { ok: true, data: idx };
      }
      default:
        return { ok: false, error: `UNKNOWN_VERB: ${verb ?? ""}` };
    }
  } catch (e: unknown) {
    if (e instanceof SYSTEM_PATH_FORBIDDEN) {
      return { ok: false, error: e.message };
    }
    const msg =
      e instanceof Error ? e.message : typeof e === "string" ? e : String(e);
    return { ok: false, error: msg };
  }
}

/** Resolve the `peaks skill` parent command from the program tree,
 *  creating it lazily when program.ts hasn't already registered
 *  the skill command (matches the pattern in
 *  src/cli/commands/workflow-plan-commands.ts:179).
 */
function getOrCreateSkillCmd(program: Command): Command {
  const existing = program.commands.find((c) => c.name() === "skill");
  if (existing !== undefined) return existing;
  return program.command("skill").description("Manage Peaks skills");
}

/** Register the `peaks skill sediment <verb>` subcommand group.
 *
 *  Task 15a wires 4 verbs. The subcommand accepts variadic args so
 *  caller-side code (peaks-cli action handler) can re-dispatch to
 *  `runSediment` for the actual verb routing. Subsequent tasks
 *  (15b/15c/15d) will add the remaining 14 verbs by extending the
 *  `runSediment` switch statement.
 */
export function registerSedimentCommands(program: Command, io: ProgramIO): void {
  const skill = getOrCreateSkillCmd(program);
  skill
    .command("sediment <args...>")
    .description(
      "Sediment pool operations (LLM-coordinated; see peaks-maker skill)"
    )
    .action(async (args: string[]) => {
      const home =
        process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();
      const r = await runSediment(args, { home });
      if (!r.ok) {
        io.stdout(JSON.stringify({ ok: false, error: r.error }));
        process.exitCode = 1;
        return;
      }
      io.stdout(JSON.stringify({ ok: true, data: r.data ?? null }));
    });
}
