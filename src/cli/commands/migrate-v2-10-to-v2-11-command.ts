/**
 * v2.11.0 — Group E (Tier 8): `peaks migrate v2-10-to-v2-11` command.
 *
 * Deprecation helper for projects upgraded from 2.10.0 → 2.11.0. The
 * peaks-rd `tech-doc.md` output was removed in 2.11.0 (Group A). This
 * migration prepends a YAML banner to every pre-2.11.0 session's
 * `rd/tech-doc.md` file marking it as `deprecated: historical`. The
 * immutable peaks-prd handoff at `prd/handoff.md` is the new source
 * of truth; old files coexist (text-only — no file moves per
 * Karpathy §3 surgical changes).
 *
 * Default: dry-run. Pass `--apply` to actually write.
 * Idempotent: re-running on an already-migrated tree is a no-op
 * (all files report `reason: 'already-deprecated'`).
 *
 * === Source: .peaks/memory/2026-06-26-v2-11-rm-rd-techdoc-immutable-handoff.md §"Tier 8" ===
 */

import type { Command } from 'commander';

import { addJsonOption, type ProgramIO } from '../cli-helpers.js';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { planV2ToV11Migration, applyV2ToV11Migration, dryRunV2ToV11Migration } from '../../services/migration/v2-10-to-v2-11-service.js';
import { ok, fail, type ResultEnvelope } from 'peaks-loop-shared/result';

type MigrateV2ToV11Options = {
  project: string;
  apply?: boolean;
  json?: boolean;
};

export function registerMigrateV2ToV11Command(workspace: Command, io: ProgramIO): void {
  addJsonOption(
    workspace
      .command('migrate-v2-10-to-v2-11')
      .description(
        'v2.11.0 Group E (Tier 8): prepend a YAML deprecation banner to every pre-v2.11.0 session\'s ' +
          '`rd/tech-doc.md` file. Marks them `deprecated: historical` and points to the new peaks-prd ' +
          'handoff as the source of truth. Text-only — no file moves. Default: dry-run; pass `--apply` ' +
          'to actually write. Idempotent: re-running on an already-migrated tree is a no-op. Different ' +
          'migration family from the legacy 0.5 to 1.4.1 runtime-layout helper — this command does NOT ' +
          'move files, only prepends the banner.'
      )
      .requiredOption('--project <path>', 'target project root')
      .option('--apply', 'actually prepend the deprecation banner to each `rd/tech-doc.md` (idempotent); without it, dry-run only', false)
  ).action(async (options: MigrateV2ToV11Options) => {
    try {
      const projectRoot = resolveCanonicalProjectRoot(options.project);
      const apply = options.apply === true;
      const result = apply
        ? applyV2ToV11Migration(planV2ToV11Migration(projectRoot))
        : dryRunV2ToV11Migration(projectRoot);
      const envelope: ResultEnvelope<typeof result> = ok('workspace.migrate-v2-10-to-v2-11', result);
      io.stdout(`${JSON.stringify(envelope, null, 2)}\n`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const envelope = fail('workspace.migrate-v2-10-to-v2-11', 'MIGRATE_V2_10_TO_V2_11_FAILED', message, null, [
        'Run with --apply to attempt the deprecation banner write (default is dry-run only)',
        'Verify the project path exists and contains at least one .peaks/_runtime/<sid>/rd/tech-doc.md'
      ]);
      io.stdout(`${JSON.stringify(envelope, null, 2)}\n`);
      process.exitCode = 1;
    }
  });
}
