/**
 * peaks skill search — CLI primitive for S0 of the 4.0.0-beta.5
 * peaks-solo dispatcher release.
 *
 * Spec: docs/superpowers/specs/2026-07-08-peaks-solo-dispatcher-design.md §3.2
 * Plan: docs/superpowers/plans/2026-07-08-peaks-solo-dispatcher/s0-skill-search-cli.md
 *
 * Wired into the existing `peaks skill` group by
 * `src/cli/commands/core/skill-command.ts` (one import + one call).
 * The command ALWAYS emits a JSON array on stdout, even on the
 * no-match case (which exits 0 with `[]` per plan §"Match rules (v1)").
 *
 * Exit codes (locked in plan §"API Contract"):
 *   0 — success (may be empty array)
 *   1 — invalid args (Zod validation failure)
 *   2 — unexpected error (skill pool read fail, etc.)
 */
import type { Command } from 'commander';
import { searchSkills, SkillSearchInputSchema } from '../../services/skill/skill-search-service.js';
import { getErrorMessage } from 'peaks-loop-shared/result';

import type { ProgramIO } from '../cli-helpers.js';

/**
 * Validate the raw CLI flags, call the service, and emit a JSON
 * envelope on stdout. Errors flow through stderr + non-zero exit
 * codes per the plan §"API Contract" table.
 */
export function registerSkillSearchCommand(program: Command, io: ProgramIO): void {
  // The parent `skill` command is created by registerSkillCommand in
  // core/skill-command.ts. To keep the wiring self-contained we
  // resolve the parent by name; this also lets tests register the
  // subcommand in isolation.
  const skill = program.commands.find((c) => c.name() === 'skill');
  if (skill === undefined) {
    // Defensive: the parent must be registered before us. Surface the
    // error visibly — the dispatcher cannot triage without `peaks skill`
    // existing, so the LLM-side caller needs to know.
    throw new Error(
      'peaks skill search: parent `skill` command not found. ' +
        'Ensure registerSkillCommand is called before registerSkillSearchCommand.'
    );
  }

  skill
    .command('search')
    .description(
      'Search the in-tree skill pool by --query (substring on description + triggers) ' +
        'and/or --tag (exact match on metadata.tags) and/or --domain (exact match). ' +
        'Outputs a JSON array (always, even on no-match) to stdout. ' +
        'See docs/superpowers/specs/2026-07-08-peaks-solo-dispatcher-design.md §3.2.'
    )
    .option(
      '-q, --query <text>',
      'case-insensitive substring matched against skill description + triggers'
    )
    .option(
      '-t, --tag <tag>',
      'exact match on metadata.tags (e.g. "orchestrator", "loop-engineering")'
    )
    .option(
      '-d, --domain <domain>',
      'exact match on metadata.domain (locked enum: code | content | doctor | research | triage | sop | audit | final-review | resume | status | test | ide | slice-decompose | issue-fix-orchestrator | perf-audit | security-audit | reviewer)'
    )
    .option(
      '-l, --limit <n>',
      'max results returned (1..100, default 20)',
      (v: string) => Number.parseInt(v, 10)
    )
    .option(
      '--include-internal',
      'include skills with visibility: internal (default: hide them)'
    )
    .action(
      async (options: {
        query?: string;
        tag?: string;
        domain?: string;
        limit?: number;
        includeInternal?: boolean;
      }) => {
        // 1) Coerce + validate input via the service's Zod schema.
        //    The schema's refine rejects empty input — that is the
        //    "all-empty → error" contract the spec mandates.
        const raw: Record<string, unknown> = {};
        if (options.query !== undefined) raw['query'] = options.query;
        if (options.tag !== undefined) raw['tag'] = options.tag;
        if (options.domain !== undefined) raw['domain'] = options.domain;
        if (options.limit !== undefined) raw['limit'] = options.limit;
        if (options.includeInternal === true) raw['includeInternal'] = true;

        const parsed = SkillSearchInputSchema.safeParse(raw);
        if (!parsed.success) {
          // Exit code 1 = invalid args. Emit a human-readable message
          // on stderr so the LLM-side caller can act on it; do NOT
          // pollute stdout (which downstream tools parse as JSON).
          for (const issue of parsed.error.issues) {
            io.stderr(`${issue.path.join('.') || '<root>'}: ${issue.message}`);
          }
          process.exitCode = 1;
          return;
        }

        // 2) Call the service. Any unexpected error (skill pool read
        //    fail, etc.) maps to exit code 2.
        try {
          const results = await searchSkills(parsed.data);
          // Always emit a JSON array on stdout. The plan locks this
          // contract: even no-match returns `[]`, never `null`.
          io.stdout(JSON.stringify(results));
        } catch (error) {
          io.stderr(`skill.search failed: ${getErrorMessage(error)}`);
          process.exitCode = 2;
        }
      }
    );
}
