/**
 * `peaks skill lint --category loop-engineering-readiness` — M6 / spec §7.5 + §8.4
 *
 * Loop Engineering readiness gate for any new peaks-* skill that
 * participates in Loop Engineering (crystallization or evolution).
 *
 * Usage:
 *   peaks skill lint --category loop-engineering-readiness --path <skill-dir>
 *   peaks skill lint --category loop-engineering-readiness --path <skill-dir> --json
 *
 * The command:
 *   1. Resolves <skill-dir>/SKILL.md (default if the path is a file).
 *   2. Calls lintSkillLoopEngineeringReadiness() with the file contents.
 *   3. Prints a structured JSON envelope via printResult (or a
 *      human-readable summary when --json is omitted).
 *   4. Sets process.exitCode = 1 on a non-ok result, so the LLM
 *      gate can short-circuit a future peaks-* skill that fails the
 *      lint.
 *
 * The lint asserts three structural properties:
 *   1. the SKILL.md references
 *      `.peaks/standards/loop-engineering-guidelines.md`;
 *   2. the SKILL.md does not introduce a CLI verb the user is meant
 *      to type (only LLM-coordinated verbs from the sediment /
 *      asset / evolution surface are allowed; RL-1);
 *   3. the SKILL.md does not introduce a JSON / manifest
 *      hand-authoring surface (RL-1).
 *
 * The user never types `peaks skill lint …` — the LLM runs it on
 * the user's behalf. This command is also reachable as
 * `peaks skill ready --category loop-engineering-readiness
 *   --path <skill-dir>`
 * via a small alias added at the bottom of this file.
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Command } from 'commander';
import {
  lintSkillLoopEngineeringReadiness,
  type ReadinessLintResult,
} from '../../services/standards/loop-engineering-readiness-lint.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from '../../shared/result.js';

export const LOOP_ENGINEERING_READINESS_CATEGORY = 'loop-engineering-readiness';

type LintOptions = {
  category?: string;
  path?: string;
  json?: boolean;
};

/**
 * Resolve the SKILL.md file path from a `--path <skill-dir>` value.
 *
 * Accepts either:
 *   - a directory containing a SKILL.md (the common case for a
 *     peaks-* skill: `src/skills/<id>/`, `skills/<id>/`, etc.);
 *   - a direct file path to a SKILL.md.
 *
 * Returns the absolute path to the SKILL.md, or null if no SKILL.md
 * is found.
 */
export function resolveSkillMdPath(rawPath: string): string | null {
  const abs = resolve(rawPath);
  if (!existsSync(abs)) return null;
  const st = statSync(abs);
  if (st.isFile()) {
    return abs.toLowerCase().endsWith('skill.md') ? abs : null;
  }
  if (st.isDirectory()) {
    const candidate = join(abs, 'SKILL.md');
    return existsSync(candidate) ? candidate : null;
  }
  return null;
}

/**
 * Pure helper: run the readiness lint against the SKILL.md text and
 * return a CLI-shaped envelope. Kept separate from the Commander
 * action so unit + integration tests can drive it without spawning
 * a child process.
 */
export function runReadinessLint(rawPath: string): {
  ok: boolean;
  code: string;
  message: string;
  data: { path: string; category: string; findings: string[] };
  nextActions: string[];
} {
  const skillMdPath = resolveSkillMdPath(rawPath);
  if (!skillMdPath) {
    return {
      ok: false,
      code: 'SKILL_FILE_NOT_FOUND',
      message: `could not resolve SKILL.md from --path ${rawPath}`,
      data: { path: rawPath, category: LOOP_ENGINEERING_READINESS_CATEGORY, findings: [] },
      nextActions: [
        'Pass a directory containing SKILL.md or a direct path to a SKILL.md file.',
      ],
    };
  }
  const text = readFileSync(skillMdPath, 'utf-8');
  const result: ReadinessLintResult = lintSkillLoopEngineeringReadiness(text);
  if (result.ok) {
    return {
      ok: true,
      code: 'SKILL_READINESS_OK',
      message: 'SKILL.md passes the Loop Engineering readiness lint',
      data: {
        path: skillMdPath,
        category: LOOP_ENGINEERING_READINESS_CATEGORY,
        findings: [],
      },
      nextActions: [
        'The skill is allowed to participate in Loop Engineering (crystallization / evolution).',
      ],
    };
  }
  return {
    ok: false,
    code: 'SKILL_READINESS_FAILED',
    message: `SKILL.md failed the Loop Engineering readiness lint (${result.findings.length} finding(s))`,
    data: {
      path: skillMdPath,
      category: LOOP_ENGINEERING_READINESS_CATEGORY,
      findings: result.findings,
    },
    nextActions: [
      'Address every finding listed in data.findings, then re-run the lint.',
      'See src/services/standards/loop-engineering-readiness-lint.ts for the rule definitions.',
      'See .peaks/standards/loop-engineering-guidelines.md for the red lines the lint enforces.',
    ],
  };
}

function lintAction(options: LintOptions, io: ProgramIO): void {
  if (options.category !== LOOP_ENGINEERING_READINESS_CATEGORY) {
    printResult(
      io,
      fail(
        'skill.lint',
        'UNKNOWN_LINT_CATEGORY',
        `only --category ${LOOP_ENGINEERING_READINESS_CATEGORY} is implemented in M6`,
        { category: options.category ?? null },
        [
          `Pass --category ${LOOP_ENGINEERING_READINESS_CATEGORY}.`,
        ],
      ),
      options.json,
    );
    process.exitCode = 1;
    return;
  }
  if (!options.path) {
    printResult(
      io,
      fail(
        'skill.lint',
        'MISSING_PATH',
        '--path <skill-dir> is required',
        { category: options.category },
        ['Pass --path pointing at a peaks-* skill directory containing SKILL.md.'],
      ),
      options.json,
    );
    process.exitCode = 1;
    return;
  }
  try {
    const envelope = runReadinessLint(options.path);
    if (envelope.ok) {
      printResult(io, ok('skill.lint', envelope.data, [], envelope.nextActions), options.json);
      return;
    }
    printResult(
      io,
      fail('skill.lint', envelope.code, envelope.message, envelope.data, envelope.nextActions),
      options.json,
    );
    process.exitCode = 1;
  } catch (error) {
    printResult(
      io,
      fail('skill.lint', 'SKILL_READINESS_ERROR', getErrorMessage(error), { path: options.path }, ['Verify the path is readable.']),
      options.json,
    );
    process.exitCode = 1;
  }
}

export function registerSkillLoopEngineeringReadinessCommands(
  program: Command,
  io: ProgramIO,
): void {
  // `peaks skill lint --category loop-engineering-readiness --path <skill-dir>`
  // — primary surface, named to match the spec §7.5 / §8.4 wording.
  // We reuse the existing `skill` parent if one is registered; per
  // the add-a-new-subcommand-check-for-existing-top-level-first rule,
  // we never re-create `skill` when it's already there.
  const existingSkill = program.commands.find((c) => c.name() === 'skill');
  const skill = existingSkill ?? program
    .command('skill')
    .description('skill operations (M6: lint --category loop-engineering-readiness)');

  addJsonOption(
    skill
      .command('lint')
      .description(
        `M6: lint a peaks-* SKILL.md against a category. Currently supports --category ${LOOP_ENGINEERING_READINESS_CATEGORY} (spec §7.5 / §8.4 / RL-8).`,
      )
      .option(
        '--category <name>',
        `lint category; the M6 implementation only supports ${LOOP_ENGINEERING_READINESS_CATEGORY}`,
        LOOP_ENGINEERING_READINESS_CATEGORY,
      )
      .requiredOption(
        '--path <skill-dir>',
        'path to a peaks-* skill directory (containing SKILL.md) or directly to a SKILL.md file',
      ),
  ).action((options: LintOptions) => lintAction(options, io));

  // `peaks skill ready --category loop-engineering-readiness --path <skill-dir>`
  // — alias verb chosen by M6 for human-facing callouts. It points at
  // the same handler; both verbs are first-class so users (LLM
  // proxies) can pick whichever phrasing fits the conversation.
  // Per the spec, the user never types either verb; the LLM runs the
  // CLI on the user's behalf.
  skill
    .command('ready')
    .description(
      `M6 alias for \`peaks skill lint --category ${LOOP_ENGINEERING_READINESS_CATEGORY}\`; same flags, same exit codes.`,
    )
    .option(
      '--category <name>',
      `lint category; the M6 implementation only supports ${LOOP_ENGINEERING_READINESS_CATEGORY}`,
      LOOP_ENGINEERING_READINESS_CATEGORY,
    )
    .requiredOption('--path <skill-dir>', 'path to a peaks-* skill directory or SKILL.md file')
    .option('--json', 'print machine-readable JSON envelope')
    .action((options: LintOptions) => lintAction(options, io));
}