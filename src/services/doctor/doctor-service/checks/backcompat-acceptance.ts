/**
 * Check: the project carries the commit-leg back-compat acceptance list
 * (`config:backcompat-acceptance`).
 *
 * Absence is a FAILURE, not a skip: without the list the commit-leg expiry gate
 * fails closed, so a feature / bugfix / refactor slice cannot complete. The
 * doctor reports the same state (`severity: 'error'`) and names the seed the
 * `peaks workspace init` command writes — the LLM runs it on the user's behalf.
 *
 * An uninitialized project (no `.peaks/`) is not this check's finding: the
 * workspace-init check owns that state, and reporting here too would name the
 * same root twice.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { DoctorCheck, DoctorCheckPlugin, DoctorContext } from '../types.js';

const CHECK_ID = 'config:backcompat-acceptance';
const RELATIVE = '.peaks/lint/backcompat-expired-acceptance.json';

function run({ projectRootResolver }: DoctorContext): readonly DoctorCheck[] {
  const projectRoot = projectRootResolver();
  if (projectRoot === null || !existsSync(join(projectRoot, '.peaks'))) {
    return [
      {
        id: CHECK_ID,
        ok: true,
        message: 'No initialized workspace to inspect for a back-compat acceptance list'
      }
    ];
  }
  const absolute = join(projectRoot, '.peaks', 'lint', 'backcompat-expired-acceptance.json');
  if (existsSync(absolute)) {
    return [
      {
        id: CHECK_ID,
        ok: true,
        message: `Back-compat acceptance list present (${RELATIVE})`
      }
    ];
  }
  return [
    {
      id: CHECK_ID,
      ok: false,
      severity: 'error',
      message:
        `Back-compat acceptance list is absent (${RELATIVE}); the commit-leg expiry gate ` +
        'fails closed. Ask the LLM to run `peaks workspace init --project <repo>` to seed it; ' +
        "the LLM edits the tracked file on the user's behalf."
    }
  ];
}

export const check: DoctorCheckPlugin = {
  name: 'backcompat-acceptance',
  run
};
