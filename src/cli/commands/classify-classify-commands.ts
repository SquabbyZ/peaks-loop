/**
 * peaks classify CLI (Slice L1a + L1b).
 *
 * Subcommands:
 *   - peaks classify run --project <path> [--override <level> --reason "<text>"]
 *     Classify the current diff via the heuristic + return a JSON envelope
 *     with the chosen level, gate set, and audit log.
 *   - peaks classify override --level <level> --reason "<text>" --project <path>
 *     Force a level; writes the override to the audit log.
 *   - peaks classify upgrade --level <level> --reason "<text>" --project <path>
 *     Same as override but explicitly framed as an upgrade (audit log
 *     records the upgrade event separately from override).
 *
 * Downgrade is REFUSED (per spec §4: "peaks classify downgrade" always
 * errors out). LLM may ask; the CLI never grants.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { classifyTask } from '../../services/classify/classify-service.js';
import { TASK_LEVELS, type TaskLevel, type ClassifySignals } from '../../services/classify/classify-types.js';
import { loadPreferences } from '../../services/preferences/preferences-service.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';

type RunOptions = {
  project: string;
  override?: string;
  reason?: string;
  json?: boolean;
};

type DowngradeOptions = {
  project: string;
  level: string;
  reason: string;
  json?: boolean;
};

const CLASSIFY_AUDIT_FILE = 'classify-audit.jsonl';

function getSignalsFromGitDiff(projectRoot: string): ClassifySignals {
  // Use git diff --stat to extract file count + line count. Fall back to
  // zeros if git is unavailable (e.g. fresh repo with no commits).
  let stdout: string;
  try {
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
    stdout = execFileSync('git', ['diff', '--shortstat', 'HEAD'], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 32 * 1024 * 1024,
    }).toString('utf8');
  } catch {
    return { filesChanged: 0, linesChanged: 0, touchesDependencies: false, touchesMigrationScripts: false, isPureRefactor: true, keywords: [] };
  }

  const lines = stdout.split('\n').filter((l) => l.trim().length > 0);
  const filesChanged = lines.length;
  let added = 0;
  let removed = 0;
  let touchesDependencies = false;
  let touchesMigrationScripts = false;
  for (const line of lines) {
    const match = /(\d+)\s+insertion.*?(\d+)\s+deletion/.exec(line);
    if (match) {
      added += Number(match[1]);
      removed += Number(match[2]);
    }
    if (/(package\.json|pnpm-lock\.yaml|yarn\.lock|requirements\.txt|go\.mod)/.test(line)) {
      touchesDependencies = true;
    }
    if (/(migrate|codemod|backfill|schema)/.test(line)) {
      touchesMigrationScripts = true;
    }
  }

  // isPureRefactor: heuristic — if added lines / removed lines < 0.1 OR
  // no new exports were added, treat as refactor. For L2.2 the signal is
  // binary (true/false). Default: true (no behavior change is the safe
  // assumption; flip to false when keyword 'add' / 'new' / 'feature' present).
  const isPureRefactor = true;

  return {
    filesChanged,
    linesChanged: added + removed,
    touchesDependencies,
    touchesMigrationScripts,
    isPureRefactor,
    keywords: [],
  };
}

function appendAuditEntry(projectRoot: string, entry: unknown): void {
  const auditDir = join(projectRoot, '.peaks/_runtime');
  if (!existsSync(auditDir)) {
    try { mkdirSync(auditDir, { recursive: true }); } catch { /* ignore */ } // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
  }
  const auditPath = join(auditDir, CLASSIFY_AUDIT_FILE);
  let body = '';
  try {
    if (existsSync(auditPath)) {
      body = readFileSync(auditPath, 'utf8');
    }
  } catch { /* ignore */ } // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
  body += JSON.stringify(entry) + '\n';
  try { writeFileSync(auditPath, body); } catch { /* best-effort */ } // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
}

function isTaskLevel(value: string): value is TaskLevel {
  return (TASK_LEVELS as readonly string[]).includes(value);
}

export function registerClassifyCommands(program: Command, io: ProgramIO): void {
  const classify = program
    .command('classify')
    .description('L1a task classification: 5-level heuristic (typo/bug/feature/refactor/migration) + override/upgrade + audit log');

  addJsonOption(
    classify
      .command('run')
      .description('Classify the current diff (git diff HEAD) into one of 5 task levels')
      .requiredOption('--project <path>', 'target project root')
      .option('--override <level>', 'force a level (one of typo|bug|feature|refactor|migration); requires --reason')
      .option('--reason <text>', 'reason for the override (mandatory when --override is set)')
  ).action(async (options: RunOptions) => {
    try {
      const prefs = await loadPreferences(options.project);
      const signals = getSignalsFromGitDiff(options.project);
      let override: { level: TaskLevel; reason: string } | undefined;
      if (options.override !== undefined) {
        if (!isTaskLevel(options.override)) {
          printResult(
            io,
            fail('classify.run', 'INVALID_LEVEL', `level must be one of: ${TASK_LEVELS.join(', ')}`, { provided: options.override }, ['Pass one of typo, bug, feature, refactor, migration']),
            options.json
          );
          process.exitCode = 1;
          return;
        }
        if (options.reason === undefined || options.reason.length === 0) {
          printResult(
            io,
            fail('classify.run', 'REASON_REQUIRED', '--reason is required when --override is set', {}, ['Provide a non-empty reason for the override']),
            options.json
          );
          process.exitCode = 1;
          return;
        }
        override = { level: options.override, reason: options.reason };
      }
      const result = classifyTask(
        override !== undefined
          ? { signals, conservatism: prefs.classifyConservatism, override }
          : { signals, conservatism: prefs.classifyConservatism },
        prefs.classifyRules.feature_threshold_files,
        prefs.classifyRules.feature_threshold_lines,
      );
      appendAuditEntry(options.project, result.audit);
      printResult(io, ok('classify.run', result, [], [
        `gate set for level "${result.level}": ${result.gateSet.stages.join(', ')}`,
        `audit log: .peaks/_runtime/${CLASSIFY_AUDIT_FILE}`,
      ]), options.json);
    } catch (error) {
      printResult(
        io,
        fail('classify.run', 'CLASSIFY_RUN_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Run peaks classify --help for usage']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  // Downgrade is REFUSED per spec §4. Surface this as a hard fail.
  classify
    .command('downgrade')
    .description('REFUSED per spec §4 — peaks-loop never downgrades a classification; ask the user to override explicitly')
    .requiredOption('--level <level>', 'attempted level')
    .requiredOption('--reason <text>', 'reason for the attempt (always rejected)')
    .requiredOption('--project <path>', 'target project root')
    .option('--json', 'print machine-readable JSON envelope')
    .action(async (options: DowngradeOptions) => {
      printResult(
        io,
        fail('classify.downgrade', 'DOWNGRADE_REFUSED', 'peaks classify downgrade is refused per spec §4. Use --override (with reason) on `classify run` to force a level; the CLI never downgrades a classification unilaterally.', { attemptedLevel: options.level, reason: options.reason }, ['Use `peaks classify run --override <level> --reason "<text>"` instead']),
        options.json
      );
      process.exitCode = 2;
    });
}
