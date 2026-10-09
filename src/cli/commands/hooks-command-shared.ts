// src/cli/commands/hooks-command-shared.ts
//
// What every `peaks hooks *` verb shares: the option bag, the scope switch and
// the project-root / IDE resolution. Split out of `hooks-commands.ts`; the
// defaults and the detection order are unchanged.

import { findProjectRoot } from '../../services/config/config-safety.js';
import { detectIdeFromContext } from '../../services/ide/hook-translator.js';
import type { IdeId } from '../../services/ide/ide-types.js';
import type { HookScope } from '../../services/skills/hooks-settings-service.js';

export type HookCliOptions = {
  global?: boolean;
  project?: string;
  dryRun?: boolean;
  json?: boolean;
  ide?: string;
  progress?: boolean;
};

/** What a hook-script copy reported back: whether it landed, and where from / to. */
export type HookScriptCopy = { copied: boolean; source: string; target: string };

/** Both copies one install makes, for whichever scope it was asked about. */
export type HookScriptCopies = { bridgeCopy: HookScriptCopy; codeGateCopy: HookScriptCopy };

/** Everything the install verb derived once and hands to both of its envelopes. */
export type InstallContext = {
  scope: HookScope;
  projectRoot: string | undefined;
  ide: IdeId;
  skipProgress: boolean;
};

export function resolveScope(options: { global?: boolean }): HookScope {
  return options.global ? 'global' : 'project';
}

export function resolveProjectRoot(
  scope: HookScope,
  project: string | undefined
): string | undefined {
  return scope === 'project'
    ? (project ?? findProjectRoot(process.cwd()) ?? process.cwd())
    : undefined;
}

/**
 * Resolve the IDE the install should target. The CLI user can override with
 * `--ide <id>`. Otherwise we delegate to `detectIdeFromContext` which checks
 * `process.env[adapter.envVar]` → stdin shape → cwd `.trae`/`.claude` →
 * fallback `'claude-code'`. Pass `parsedStdin: null` since `peaks hooks
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
