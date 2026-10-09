// Split out of `core/skill-command.ts`:
// `skill runbook <name>` — inspect a skill's Default runbook section.
import type { Command } from 'commander';
import { inspectSkillRunbook } from '../../../services/skills/skill-runbook-service.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../../cli-helpers.js';

export function registerSkillRunbookCommand(skill: Command, io: ProgramIO): void {
  addJsonOption(
    skill
      .command('runbook <name>')
      .description(
        'Inspect a skill Default runbook section and its --apply authorization-note status'
      )
  ).action(async (name: string, options: { json?: boolean }) => {
    try {
      const inspection = await inspectSkillRunbook(name);
      const result = inspection.ok
        ? ok('skill.runbook', inspection)
        : fail(
            'skill.runbook',
            inspection.hasRunbook ? 'SKILL_RUNBOOK_APPLY_UNGATED' : 'SKILL_RUNBOOK_MISSING',
            inspection.hasRunbook
              ? `Skill ${inspection.name} has ${inspection.destructiveApplyLines.length} destructive --apply command(s) without an authorization/dry-run note`
              : `Skill ${inspection.name} is missing a ## Default runbook section`,
            inspection,
            inspection.hasRunbook
              ? [
                  'Add an authorization or --dry-run note next to destructive --apply lines in the runbook section'
                ]
              : ['Add a `## Default runbook` section to the skill SKILL.md']
          );
      printResult(io, result, options.json);
      if (!inspection.ok) {
        process.exitCode = 1;
      }
    } catch (error) {
      printResult(
        io,
        fail('skill.runbook', 'SKILL_NOT_FOUND', getErrorMessage(error), { name }),
        options.json
      );
      process.exitCode = 1;
    }
  });
}
