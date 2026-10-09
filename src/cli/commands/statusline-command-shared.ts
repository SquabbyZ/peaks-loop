// src/cli/commands/statusline-command-shared.ts
//
// What every `peaks statusline *` verb shares: the stdin seam, the install
// scope, the IDE resolution, and the option shapes the verbs declare. Split
// out of `statusline-commands.ts`; every value and every resolution order is
// unchanged.

import { findProjectRoot } from '../../services/config/config-safety.js';
import { detectIdeFromContext } from '../../services/ide/hook-translator.js';
import type { IdeId } from '../../services/ide/ide-types.js';
import type { StatusLineScope } from '../../services/skills/statusline-settings-service.js';

export const STDIN_READ_TIMEOUT_MS = 250;

/**
 * Read piped stdin if present; resolve quickly with '' when attached to a TTY.
 *
 * `PEAKS_STATUSLINE_STDIN` is a test seam (same shape as the `PEAKS_HOOK_STDIN`
 * seam in `gate-commands.ts`): the harness payload is the only channel that
 * carries the harness's own context numbers, and a test that cannot supply one
 * cannot verify the capture at all.
 *
 * WHY THIS SEAM IS ACCEPTABLE ON A DIFFERENT ARGUMENT (repair cycle 3). The
 * precedent does not transfer by itself: `PEAKS_HOOK_STDIN` is defended in
 * `.peaks/memory/peaks-hook-stdin-test-seam-pattern.md` because its payload
 * still routes through the `enforceBashCommand` SOP gate. This payload is
 * routed through no gate — it is PERSISTED verbatim as the record the witness
 * guard then reads. So the compensating control is different, not absent: the
 * record is observation-only and one-way. It reaches only `data` and the
 * `warnings` / `nextActions` arrays of `peaks code context-now`; the compact
 * `action` there is computed from `probe.ratio` alone, before and independently
 * of the witness. A forged payload can therefore make the instrument lie —
 * measured: a hand-written record yields a confident false `agree`, or a
 * self-contradictory false `disagree` — and can do nothing else. What it cannot
 * do is fire, block or delay a compact. Unconditional rather than NODE_ENV-
 * gated, for the reason already recorded for the sibling seam.
 */
export function readStdin(): Promise<string> {
  const override = process.env['PEAKS_STATUSLINE_STDIN'];
  if (override !== undefined) {
    return Promise.resolve(override);
  }
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    let data = '';
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve(data);
    };
    const timer = setTimeout(finish, STDIN_READ_TIMEOUT_MS);
    timer.unref?.();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      finish();
    });
    process.stdin.on('error', () => {
      clearTimeout(timer);
      finish();
    });
  });
}

export function resolveScope(options: { global?: boolean }): StatusLineScope {
  return options.global ? 'global' : 'project';
}

/** `--project <path>`, else the nearest project root, else cwd — unchanged order. */
export function resolveProjectRoot(project: string | undefined): string {
  return project ?? findProjectRoot(process.cwd()) ?? process.cwd();
}

/**
 * Resolve the IDE the install should target. The CLI user can override with
 * `--ide <id>`. Otherwise we delegate to `detectIdeFromContext` which checks
 * `process.env[adapter.envVar]` → stdin shape → cwd `.trae`/`.claude` →
 * fallback `'claude-code'`. Pass `parsedStdin: null` since `peaks statusline
 * install` is not invoked from inside an IDE hook — there's no stdin payload.
 */
export function resolveIdeForCommand(
  options: { ide?: string },
  projectRoot: string | undefined
): IdeId {
  if (options.ide !== undefined && options.ide.length > 0) {
    return options.ide as IdeId;
  }
  return detectIdeFromContext({
    env: process.env,
    cwd: projectRoot ?? process.cwd(),
    parsedStdin: null
  });
}

export type InstallOptions = {
  global?: boolean;
  project?: string;
  force?: boolean;
  dryRun?: boolean;
  json?: boolean;
  ide?: string;
};
export type UninstallOptions = { global?: boolean; project?: string; json?: boolean; ide?: string };
export type StatusOptions = { global?: boolean; project?: string; json?: boolean; ide?: string };
export type RenderOptions = { project?: string; json?: boolean; now?: number | string };
export type CompactOptions = {
  project?: string;
  sessionId?: string;
  json?: boolean;
  now?: number | string;
};
