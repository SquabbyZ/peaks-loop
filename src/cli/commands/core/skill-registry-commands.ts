// Split out of `core/skill-command.ts`:
// `skill list`, `skill doctor` and `skill sync` — the registry / platform
// surface, as opposed to the presence and heartbeat families.
import type { Command } from 'commander';
import { runDoctor } from '../../../services/doctor/index.js';
import { listSkills } from '../../../services/skills/skill-registry.js';
import { runSkillSync, SYNC_PLATFORMS } from '../../../services/skills/sync-service.js';
import { ok, fail } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../../cli-helpers.js';

const PLATFORM_IDS = SYNC_PLATFORMS.join(', ');
const LIST_DESCRIPTION = 'List skills derived from skills/*/SKILL.md';
const LIST_INCLUDE_INTERNAL_HELP = 'include skills with visibility: internal (default: hide them)';
const DOCTOR_DESCRIPTION = 'Run skill-related doctor checks';
const SYNC_DESCRIPTION = `Sync the peaks-* skill family to one or all of the 8 supported LLM-CLI platforms (${PLATFORM_IDS}). Idempotent.`;
const SYNC_PLATFORM_HELP = `sync only one platform (default: --all). Valid: ${PLATFORM_IDS}`;
const SYNC_ALL_HELP = 'sync all 8 platforms (default if --platform is omitted)';
const SYNC_DRY_RUN_HELP = 'do not write; emit the same shape with applied=false';
const SYNC_RECONCILE_HELP =
  'repair Peaks-managed skill Junctions whose targets were deleted with a host worktree';
const SYNC_PROJECT_HELP = 'project root (default: cwd)';

type ListOptions = { json?: boolean; includeInternal?: boolean };
type DoctorOptions = { json?: boolean };
type SyncOptions = {
  platform?: string;
  all?: boolean;
  dryRun?: boolean;
  reconcileJunctions?: boolean;
  project?: string;
  json?: boolean;
};

function sortSkillsForDisplay<T extends { name: string }>(skills: readonly T[]): T[] {
  return [...skills].sort((a, b) => {
    // door) — list it FIRST so users discover the dispatcher before
    // any specific leaf. Followed by peaks-sop (current default
    // runbook showcase) and peaks-code (canonical code-domain
    // orchestrator); everything else falls back to alphabetical.
    if (a.name === 'peaks-solo') return -1;
    if (b.name === 'peaks-solo') return 1;
    if (a.name === 'peaks-sop') return -1;
    if (b.name === 'peaks-sop') return 1;
    if (a.name === 'peaks-code') return -1;
    if (b.name === 'peaks-code') return 1;
    return a.name.localeCompare(b.name);
  });
}

function runSkillList(options: ListOptions, io: ProgramIO): Promise<void> {
  return listSkills().then((all) => {
    const skills =
      options.includeInternal === true ? all : all.filter((s) => s.visibility !== 'internal');
    if (options.json === true) {
      printResult(io, ok('skill.list', { skills }), true);
      return;
    }
    for (const skill of sortSkillsForDisplay(skills)) {
      io.stdout(`  ${skill.name.padEnd(14)}${skill.description}`);
    }
    io.stdout(`\n  Invoke any skill by typing its name in conversation (e.g. \`peaks-sop\`).`);
  });
}

function runSkillDoctor(options: DoctorOptions, io: ProgramIO): Promise<void> {
  return runDoctor().then((report) => {
    const skillChecks = report.checks.filter((check) => check.id.startsWith('skill'));
    const failed = skillChecks.filter((check) => !check.ok).length;
    if (options.json === true) {
      printResult(io, ok('skill.doctor', { checks: skillChecks, ok: failed === 0 }), true);
    } else {
      for (const check of skillChecks) {
        const icon = check.ok ? '+' : '×';
        io.stdout(`  ${icon}  ${check.message}`);
      }
      io.stdout(`\n  ${skillChecks.length - failed} passed, ${failed} failed`);
      if (failed > 0) {
        io.stderr('\nOne or more skill checks failed.');
      }
    }
    if (failed > 0) {
      process.exitCode = 1;
    }
  });
}

async function runSkillSyncCommand(options: SyncOptions, io: ProgramIO): Promise<void> {
  try {
    const projectRoot = options.project ?? process.cwd();
    const platforms = options.platform !== undefined ? [options.platform as never] : undefined;
    const result = await runSkillSync({
      projectRoot,
      ...(platforms !== undefined ? { platforms } : {}),
      ...(options.dryRun === true ? { dryRun: true } : {}),
      ...(options.reconcileJunctions === true ? { reconcileJunctions: true } : {})
    });
    const envelope = ok(
      'skill.sync',
      result,
      [],
      [
        `syncedCount: ${result.syncedCount}/${result.perPlatform.length} platforms`,
        `totalInstalled: ${result.totalInstalled} skill symlinks`,
        result.failedCount > 0
          ? `failedCount: ${result.failedCount} (run \`peaks skill status\` for details)`
          : 'no failures'
      ]
    );
    printResult(io, envelope, options.json);
    if (result.failedCount > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    const message = getErrorMessage(error);
    printResult(
      io,
      fail('skill.sync', 'SKILL_SYNC_FAILED', message, { applied: false }, [message]),
      options.json
    );
    process.exitCode = 1;
  }
}

export function registerSkillRegistryCommands(skill: Command, io: ProgramIO): void {
  addJsonOption(
    skill
      .command('list')
      .description(LIST_DESCRIPTION)
      .option('--include-internal', LIST_INCLUDE_INTERNAL_HELP)
  ).action((options: ListOptions) => runSkillList(options, io));

  addJsonOption(skill.command('doctor').description(DOCTOR_DESCRIPTION)).action(
    (options: DoctorOptions) => runSkillDoctor(options, io)
  );

  // Slice #12 final piece (per spec §9 line 1105):
  // `peaks skills sync 8 平台分发`. Idempotent: re-running is a
  // no-op when the symlinks are already correct.
  addJsonOption(
    skill
      .command('sync')
      .description(SYNC_DESCRIPTION)
      .option('--platform <id>', SYNC_PLATFORM_HELP)
      .option('--all', SYNC_ALL_HELP)
      .option('--dry-run', SYNC_DRY_RUN_HELP)
      .option('--reconcile-junctions', SYNC_RECONCILE_HELP)
      .option('--project <path>', SYNC_PROJECT_HELP)
  ).action((options: SyncOptions) => runSkillSyncCommand(options, io));
}
