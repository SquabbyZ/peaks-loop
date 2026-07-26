/**
 * Check: optional user config presence (`config:user`).
 *
 * Single informational check that flags whether the user has a
 * personal `~/.peaks/config.json`. This check NEVER fails
 * (presence is optional) — it just tells the operator the file
 * is present vs absent so they can correlate it with later
 * "user-config says X" surprises.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { DoctorCheck, DoctorCheckPlugin } from '../types.js';

function run(): readonly DoctorCheck[] {
  const userConfigPath = join(homedir(), '.peaks', 'config.json');
  const hasUserConfig = existsSync(userConfigPath);
  return [{
    id: 'config:user',
    ok: true,
    message: hasUserConfig
      ? 'User config exists at ~/.peaks/config.json'
      : 'Optional user config not found at ~/.peaks/config.json'
  }];
}

export const check: DoctorCheckPlugin = {
  name: 'user-config',
  run
};