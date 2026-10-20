// src/cli/commands/lint-rules-command.ts
//
// `peaks lint rules` — the CLI surface of the rule pre-read.
//
// It answers one question for a given file set: what are the rules in force?
// The answer has three parts, and each rule names the layer it came from —
// the project's own lint tooling, the language rule channel, the curated rule
// sets. A reader that cannot tell the layers apart cannot act on them.
//
// THE REFUSAL IS THE POINT. A call with no files is REFUSED with a named
// code rather than answered with an empty rule set: "you named no files" and
// "there are no rules" are different answers, and only one of them is a
// finding about the code.
//
// The read itself lives in `src/services/lint/rule-pre-read.ts`; this file is
// the verb around it, nothing more.

import { resolve } from 'node:path';
import { printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { readEffectiveRules, RULES_RESOLVED_REASON } from '../../services/lint/rule-pre-read.js';

/** The `peaks lint rules` options. */
export type RulesOptions = {
  files?: string[];
  project?: string;
  json?: boolean;
};

/**
 * Read the rules in force for a file set and print them.
 *
 * The project root defaults to the current directory and is resolved against
 * it, so a relative `--project` means what the user typed.
 */
export function emitRules(io: ProgramIO, options: RulesOptions): void {
  const files = options.files ?? [];
  if (files.length === 0) {
    printResult(
      io,
      fail(
        'code.lint.rules',
        'NO_FILES',
        'No files were given, so there is nothing to read the rules for.',
        { files: [] },
        ['Pass the files to read: --files <file...>']
      ),
      options.json
    );
    process.exitCode = 1;
    return;
  }
  const cwd = process.cwd();
  const projectRoot = options.project === undefined ? cwd : resolve(cwd, options.project);
  const ruleSet = readEffectiveRules(projectRoot, files);
  // The reason names every layer that could not be read. A read that found
  // nothing because a layer never ran must not read as a read that found
  // nothing wrong.
  const warnings = ruleSet.reason === RULES_RESOLVED_REASON ? [] : [ruleSet.reason];
  printResult(
    io,
    ok('code.lint.rules', ruleSet, warnings, [
      'Each rule names the layer it came from: project, language, or curated.'
    ]),
    options.json
  );
}
