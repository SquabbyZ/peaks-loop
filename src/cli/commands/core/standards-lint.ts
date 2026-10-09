import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  lintLoopEngineeringGuidelines,
  EXPECTED_RED_LINE_IDS
} from '../../../services/standards/loop-engineering-lint.js';

/** The only `--category` this subcommand implements today. */
export const LOOP_ENGINEERING_CATEGORY = 'loop-engineering';

/** Project-relative location of the file the `loop-engineering` lint reads. */
export const LOOP_ENGINEERING_GUIDELINES_RELATIVE_PATH =
  '.peaks/standards/loop-engineering-guidelines.md';

export interface StandardsLintEnvelope {
  ok: boolean;
  code: string;
  message: string;
  data: {
    category: string;
    path: string;
    redLineCount: number;
    redLineIds: string[];
    findings: string[];
  };
  nextActions: string[];
}

/**
 * Pure helper: read the loop-engineering guideline file under `projectRoot`
 * and lint it. Kept out of the Commander action so unit tests can drive it
 * without spawning a child process (same shape as
 * `runReadinessLint` in skill-loop-engineering-readiness-commands.ts).
 */
export function runLoopEngineeringLint(projectRoot: string): StandardsLintEnvelope {
  const root = resolve(projectRoot);
  const guidelinePath = join(root, LOOP_ENGINEERING_GUIDELINES_RELATIVE_PATH);
  const data = {
    category: LOOP_ENGINEERING_CATEGORY,
    path: guidelinePath,
    redLineCount: 0,
    redLineIds: [] as string[],
    findings: [] as string[]
  };

  if (!existsSync(guidelinePath)) {
    return {
      ok: false,
      code: 'LINT_FILE_NOT_FOUND',
      message: `no ${LOOP_ENGINEERING_GUIDELINES_RELATIVE_PATH} under ${root}`,
      data,
      nextActions: [
        `Pass --project pointing at a peaks-loop checkout (the lint reads its own guideline file).`
      ]
    };
  }

  const result = lintLoopEngineeringGuidelines(readFileSync(guidelinePath, 'utf-8'));
  const redLineIds = result.redLines.map((rl) => rl.id);
  const fullData = { ...data, redLineCount: redLineIds.length, redLineIds };

  if (result.ok) {
    return {
      ok: true,
      code: 'STANDARDS_LINT_OK',
      message: `${redLineIds.length} red line(s) present with all 4 sections (expected: ${EXPECTED_RED_LINE_IDS.join(', ')})`,
      data: fullData,
      nextActions: ['Any new red line must use the 4-section form or this lint will reject it.']
    };
  }
  return {
    ok: false,
    code: 'STANDARDS_LINT_FAILED',
    message: `guideline file failed the lint (${result.findings.length} finding(s))`,
    data: { ...fullData, findings: result.findings },
    nextActions: [
      'Address every finding in data.findings, then re-run the lint.',
      'Each red line must be a `## RL-N — <title>` heading with the 4 sections: Failure modes / Rewrite / Self-check / Out-of-scope.'
    ]
  };
}
