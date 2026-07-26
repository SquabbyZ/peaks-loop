/**
 * Check: statusline runtime diagnostic (`statusline:runtime`).
 *
 * Informational only (always passes). Reports the running peaks
 * version + platform string. On Windows, adds a hint that the
 * statusLine shows nothing in git bash when `peaks` is not on PATH
 * in the shell Claude Code spawns — the user must reinstall
 * globally if the version is older than `CLI_VERSION` and reload
 * Claude Code. On other platforms, the message is a short platform
 * marker.
 */

import { CLI_VERSION } from 'peaks-loop-shared/version';

import type { DoctorCheck, DoctorCheckPlugin, DoctorContext } from '../types.js';

function run({ platform }: DoctorContext): readonly DoctorCheck[] {
  if (platform === 'win32') {
    return [{
      id: 'statusline:runtime',
      ok: true,
      message: `peaks ${CLI_VERSION} (win32): if the statusLine shows nothing in git bash, verify \`peaks\` resolves on PATH in the shell Claude Code uses (run \`peaks -v\` there), reinstall globally with \`npm i -g peaks-loop@latest\` if the version is older than ${CLI_VERSION}, then re-run \`peaks statusline install\` and reload Claude Code`
    }];
  }
  return [{
    id: 'statusline:runtime',
    ok: true,
    message: `peaks ${CLI_VERSION} (${platform}): statusLine command is \`peaks statusline\``
  }];
}

export const check: DoctorCheckPlugin = {
  name: 'statusline-runtime',
  run
};