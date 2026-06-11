/**
 * peaks skills audit-conformance CLI (Slice #12) — runs the
 * skill-conformance-service against all 12 peaks-* SKILL.md files and
 * reports the 5 standard checks (frontmatter, CLI-back, loadStrategy,
 * 800-line cap, outputStyle).
 */

import { Command } from 'commander';
import { auditSkillConformance } from '../../services/skills/skill-conformance-service.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from '../../shared/result.js';

type AuditConformanceOptions = {
  project: string;
  json?: boolean;
};

export function registerSkillConformanceCommands(program: Command, io: ProgramIO): void {
  program
    .command('skills:audit-conformance')
    .description('Slice #12: audit all 12 peaks-* SKILL.md against the 5 alignment standards')
    .requiredOption('--project <path>', 'target project root')
    .option('--json', 'print machine-readable JSON envelope')
    .action(async (options: AuditConformanceOptions) => {
      try {
        const report = auditSkillConformance({ projectRoot: options.project });
        const nextActions: string[] = [];
        if (report.failed > 0) {
          nextActions.push(`${report.failed} hard failure(s); fix before shipping.`);
          for (const c of report.checks.filter((c) => c.level === 'fail')) {
            nextActions.push(`  - ${c.skill}: ${c.id} — ${c.message}`);
          }
        }
        if (report.warned > 0) {
          nextActions.push(`${report.warned} advisory warning(s); see envelope.checks for details.`);
        }
        if (report.failed === 0 && report.warned === 0) {
          nextActions.push('All 13 skills pass the 5 alignment standards.');
        }
        printResult(io, ok('skills.audit-conformance', report, [], nextActions), options.json);
      } catch (error) {
        printResult(
          io,
          fail('skills.audit-conformance', 'AUDIT_CONFORMANCE_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Verify the project path']),
          options.json
        );
        process.exitCode = 1;
      }
    });
}
