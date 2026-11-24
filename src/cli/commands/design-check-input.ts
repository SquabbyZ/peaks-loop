/**
 * The `design check` option record and the pure helpers both of its paths use.
 *
 * Kept out of `design-commands.ts` so the command module stays under the file
 * cap; nothing here reads the filesystem, spawns, or writes.
 */
import {
  acceptanceRefusal,
  CHECK_BLOCKED_ACTIONS,
  SOURCE_ONLY_DIAGNOSTIC,
  type AcceptanceRefusal
} from '../../services/design/acceptance.js';
import type { DesignCheckResult } from '../../services/design/design-check.js';

export type DesignCheckCliOptions = {
  project: string;
  app?: string;
  rid?: string;
  sessionId?: string | undefined;
  files?: string;
  base?: string;
  url?: string;
  pages?: string;
  start?: boolean;
  sourceOnly?: boolean;
  allowSourceOnly?: boolean;
  acceptNote?: string;
  skipExemplar?: boolean;
  baselineUrl?: string;
  json?: boolean;
  gate?: boolean;
};

/** A `--flag a,b,c` value as a list; an empty string is an empty list, not absent. */
export const splitList = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

/** The path and change-set half; its own function keeps each half under the complexity cap. */
function scopedInput(options: DesignCheckCliOptions) {
  return {
    projectRoot: options.project,
    ...(options.app === undefined ? {} : { appPath: options.app }),
    ...(options.rid === undefined ? {} : { rid: options.rid }),
    ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
    ...(options.files === undefined ? {} : { changedFiles: splitList(options.files) }),
    ...(options.base === undefined ? {} : { base: options.base }),
    ...(options.url === undefined ? {} : { url: options.url }),
    ...(options.pages === undefined ? {} : { pages: splitList(options.pages) })
  };
}

export function checkInput(options: DesignCheckCliOptions, allowSourceOnly: boolean) {
  return {
    ...scopedInput(options),
    ...(options.start === true ? { start: true } : {}),
    sourceOnly: options.sourceOnly === true,
    allowSourceOnly,
    ...(options.acceptNote === undefined ? {} : { acceptNote: options.acceptNote }),
    ...(options.skipExemplar === true ? { skipExemplar: true } : {}),
    ...(options.baselineUrl === undefined ? {} : { baselineUrl: options.baselineUrl })
  };
}

export function checkNextActions(result: DesignCheckResult): string[] {
  if (result.verdict === 'fail') return ['Fix the listed findings, then re-run the design check.'];
  if (result.verdict === 'not-adopted') {
    return ['Initialize the design contract for this app before checking it.'];
  }
  return result.errorCode === undefined ? [] : (CHECK_BLOCKED_ACTIONS[result.errorCode] ?? []);
}

/** The check's own warning; G2 contributes advisory slop/grade warnings separately. */
export function checkWarnings(options: DesignCheckCliOptions): string[] {
  return options.sourceOnly === true ? [SOURCE_ONLY_DIAGNOSTIC] : [];
}

/** The first acceptance refusal this run must report, or null when all were recorded. */
export function acceptanceFor(
  options: DesignCheckCliOptions,
  sessionId: string | undefined,
  ci: string | undefined
): AcceptanceRefusal | null {
  const input = { ...options, sessionId };
  const sourceOnly = options.allowSourceOnly === true ? acceptanceRefusal(input, ci) : null;
  if (sourceOnly !== null) return sourceOnly;
  return options.skipExemplar === true ? acceptanceRefusal(input, ci, 'exemplar') : null;
}
