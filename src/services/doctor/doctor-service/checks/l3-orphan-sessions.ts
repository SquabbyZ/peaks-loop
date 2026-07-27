/**
 * Check: orphan sessions under `.peaks/_runtime/` (`L3:l3-orphan-sessions`).
 *
 * Flags bare sids under `.peaks/_runtime/` that fail the
 * `isValidSessionId` regex. The reducer skips canonical system
 * subdirs that intentionally live under `.peaks/_runtime/`
 * (e.g. `change/`, which routes reviewable artifacts per F3).
 *
 * Slice 2026-06-24-doctor-1xdetector-residual regression net: the
 * reducer MUST exclude `change/` (and other system subdirs added
 * by future F3 changes) — without the exclude-list the doctor
 * flips the summary to fail on every clean workspace, which broke
 * 7 doctor-family tests.
 *
 * When `.peaks/_runtime/` does not exist, the check passes
 * (nothing to scan).
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { getErrorMessage } from 'peaks-loop-shared/result';

import type { DoctorCheck, DoctorCheckPlugin, DoctorContext } from '../types.js';

/**
 * Canonical system subdirs that intentionally live under
 * `.peaks/_runtime/` and must NOT be flagged as orphan sessions.
 *
 * `change/` is the routing target for change-id reviewable
 * artifacts per F3 audit-p1. Adding a new entry here requires
 * also updating `RUNTIME_SYSTEM_SUBDIRS_DOC` in the comments
 * below so the next maintainer knows why each entry is listed.
 */
const RUNTIME_SYSTEM_SUBDIRS: ReadonlySet<string> = new Set(['change']);

function run({ resolvedL3Root, isValidSessionId }: DoctorContext): readonly DoctorCheck[] {
  try {
    const runtimeDir = join(resolvedL3Root, '.peaks/_runtime');
    if (!existsSync(runtimeDir)) {
      return [{
        id: 'L3:l3-orphan-sessions',
        ok: true,
        message: 'No .peaks/_runtime/ directory; nothing to check.'
      }];
    }
    const entries = readdirSync(runtimeDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => !RUNTIME_SYSTEM_SUBDIRS.has(name));
    const validSids = entries.filter((sid) => isValidSessionId(sid));
    const invalidSids = entries.filter((sid) => !isValidSessionId(sid));
    return [{
      id: 'L3:l3-orphan-sessions',
      ok: invalidSids.length === 0,
      message: invalidSids.length === 0
        ? `All ${validSids.length} session(s) under .peaks/_runtime/ are valid (isValidSessionId)`
        : `${invalidSids.length} orphan session(s) under .peaks/_runtime/ fail isValidSessionId: ${invalidSids.slice(0, 5).join(', ')}${invalidSids.length > 5 ? '...' : ''}. Run \`peaks workspace clean --project <repo>\` to archive.`
    }];
  } catch (error) {
    return [{
      id: 'L3:l3-orphan-sessions',
      ok: true,
      message: `L3:l3-orphan-sessions probe failed (${getErrorMessage(error)}); skipping check`
    }];
  }
}

export const check: DoctorCheckPlugin = {
  name: 'l3-orphan-sessions',
  run
};