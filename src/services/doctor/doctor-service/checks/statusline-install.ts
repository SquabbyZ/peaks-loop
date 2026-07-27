/**
 * Check: statusline install discovery nudge (`statusline:install`).
 *
 * Informational only (always passes). When a Peaks skill is active
 * but the statusLine is not installed, the message suggests running
 * `peaks statusline install` so the active skill shows in the
 * terminal status bar. When no skill is active, the message
 * downgrades to "install is optional".
 *
 * The check is non-failing because the statusline is a UI
 * accelerator — its absence does not break the doctor pipeline.
 */

import type { DoctorCheck, DoctorCheckPlugin, DoctorContext } from '../types.js';

function run({ presence, statusLineInstalled }: DoctorContext): readonly DoctorCheck[] {
  if (presence !== null && !statusLineInstalled) {
    return [{
      id: 'statusline:install',
      ok: true,
      message: 'A Peaks skill is active but the statusLine is not installed; run `peaks statusline install` so the active skill shows in the terminal status bar'
    }];
  }
  return [{
    id: 'statusline:install',
    ok: true,
    message: statusLineInstalled
      ? 'Peaks statusLine is installed'
      : 'Peaks statusLine not installed (no active skill; install optional)'
  }];
}

export const check: DoctorCheckPlugin = {
  name: 'statusline-install',
  run
};