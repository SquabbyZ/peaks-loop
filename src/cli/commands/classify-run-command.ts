// src/cli/commands/classify-run-command.ts
//
// `peaks classify run` — classify the current diff (git diff HEAD) into one of
// the 5 task levels, with an optional `--override` + `--reason`. Extracted from
// `governance-classify-contract-commands.ts`; the registered name, description,
// options, refusal codes, audit write and envelope are unchanged.
//
// `loadPreferences` is synchronous, so the action is too — the merged file said
// `await loadPreferences(...)`, which `@typescript-eslint/await-thenable`
// flagged as an await of a non-Promise. Dropping the keyword pair changes no
// byte of the envelope (the equivalence harness re-measured it).

import type { Command } from 'commander';
import { fail, getErrorMessage, ok, type ResultEnvelope } from 'peaks-loop-shared/result';
import { classifyTask } from '../../services/classify/classify-service.js';
import { TASK_LEVELS, type TaskLevel } from '../../services/classify/classify-types.js';
import { loadPreferences } from '../../services/preferences/preferences-service.js';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  appendAuditEntry,
  CLASSIFY_AUDIT_FILE,
  getSignalsFromGitDiff,
  isTaskLevel
} from './classify-signals.js';

export type ClassifyRunOptions = {
  project: string;
  override?: string;
  reason?: string;
  json?: boolean;
};

/** The validated `--override` pair, or the refusal envelope that replaced it. */
interface OverrideOutcome {
  readonly level: TaskLevel | undefined;
  readonly reason: string;
  readonly envelope: ResultEnvelope<unknown> | null;
}

export function registerClassifyRunCommand(classify: Command, io: ProgramIO): void {
  addJsonOption(
    classify
      .command('run')
      .description('Classify the current diff (git diff HEAD) into one of 5 task levels')
      .requiredOption('--project <path>', 'target project root')
      .option(
        '--override <level>',
        'force a level (one of typo|bug|feature|refactor|migration); requires --reason'
      )
      .option('--reason <text>', 'reason for the override (mandatory when --override is set)')
  ).action((options: ClassifyRunOptions) => {
    const envelope = classifyRunEnvelope(options);
    printResult(io, envelope, options.json);
    if (!envelope.ok) process.exitCode = 1;
  });
}

function classifyRunEnvelope(options: ClassifyRunOptions): ResultEnvelope<unknown> {
  try {
    const prefs = loadPreferences(options.project);
    const signals = getSignalsFromGitDiff(options.project);
    const override = readOverride(options);
    if (override.envelope !== null) return override.envelope;
    const result = classifyTask(
      override.level === undefined
        ? { signals, conservatism: prefs.classifyConservatism }
        : {
            signals,
            conservatism: prefs.classifyConservatism,
            override: { level: override.level, reason: override.reason }
          },
      prefs.classifyRules.feature_threshold_files,
      prefs.classifyRules.feature_threshold_lines
    );
    appendAuditEntry(options.project, result.audit);
    return ok(
      'classify.run',
      result,
      [],
      [
        `gate set for level "${result.level}": ${result.gateSet.stages.join(', ')}`,
        `audit log: .peaks/_runtime/${CLASSIFY_AUDIT_FILE}`
      ]
    );
  } catch (error) {
    return fail(
      'classify.run',
      'CLASSIFY_RUN_FAILED',
      getErrorMessage(error),
      { projectRoot: options.project },
      ['Run peaks classify --help for usage']
    );
  }
}

/** The two refusals `--override` / `--reason` can earn, in the order they fire. */
function readOverride(options: ClassifyRunOptions): OverrideOutcome {
  const empty: OverrideOutcome = { level: undefined, reason: '', envelope: null };
  if (options.override === undefined) return empty;
  if (!isTaskLevel(options.override)) {
    return {
      ...empty,
      envelope: fail(
        'classify.run',
        'INVALID_LEVEL',
        `level must be one of: ${TASK_LEVELS.join(', ')}`,
        { provided: options.override },
        ['Pass one of typo, bug, feature, refactor, migration']
      )
    };
  }
  if (options.reason === undefined || options.reason.length === 0) {
    return {
      ...empty,
      envelope: fail(
        'classify.run',
        'REASON_REQUIRED',
        '--reason is required when --override is set',
        {},
        ['Provide a non-empty reason for the override']
      )
    };
  }
  return { level: options.override, reason: options.reason, envelope: null };
}
