/**
 * The scratch-path block: the ABSOLUTE directory a dispatched sub-agent writes
 * its temporary files to, machine-injected into every dispatch prompt.
 *
 * WHY THIS MODULE EXISTS. The rule "a leaf's scratch must not depend on the
 * cwd it happens to be in" lived only as prose in an orchestrator's brief, so
 * it was exactly as strong as the orchestrator's memory at 3am. Measured
 * 2026-10-02: five zero-byte `*.err` captures — the `2> name.err` of five
 * per-file test runs — landed at the repository root and were COMMITTED;
 * `git status` stayed clean because the files were tracked, and neither the
 * file-size census nor eslint reads a `.err`. An obligation a busy caller can
 * forget is not an executor; this is the same shape as the Karpathy block
 * (`src/services/dispatch/karpathy-block.ts`), which replaced the same class
 * of prose obligation for the same reason.
 *
 * SOURCE OF TRUTH: the fenced block in
 * `skills/bee/peaks-rd/references/rd-sub-agent-dispatch.md` is the canonical
 * human-facing text; `SCRATCH_PATH_BLOCK_TEMPLATE` below is its machine copy,
 * and `tests/unit/cli/commands/dispatch-scratch-path-block.test.ts` asserts
 * the two are byte-equal, so the copy cannot drift silently. A second copy
 * that CAN drift is the same defect class as the dropped block; a pinned one
 * is not.
 *
 * WHY THE PATH IS ABSOLUTE, AND WHY IT IS THIS SHAPE.
 * - Absolute: a redirect that depends on the cwd writes wherever the task
 *   happens to `cd`. The path is derived from the project root alone.
 * - Under the session's runtime dir (`.peaks/_runtime/<sessionId>/<role>/`):
 *   the shape the backlog names, and the runtime tree is gitignored, so a
 *   stray capture written there can never be committed by accident.
 * - Per role: two leaves dispatched in parallel get two directories, so
 *   their captures cannot collide.
 *
 * The block is injected for EVERY role and regardless of which optional
 * blocks a dispatch carries: the point of the block is that the rule is not
 * per-brief.
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { getSessionDir, isSinglePathSegment } from '../../services/session/getSessionDir.js';

/** The heading the block carries, and the marker a reader looks for. */
export const SCRATCH_PATH_BLOCK_HEADING =
  'Scratch path (REQUIRED — absolute path; never a cwd-relative redirect)';

/** Where the absolute path goes in the template. */
export const SCRATCH_DIR_PLACEHOLDER = '{{scratchDir}}';

/**
 * The canonical block, verbatim, with the path left as a placeholder: the
 * path differs for every dispatch, so the template is what can be pinned
 * against the reference file's fenced copy.
 */
export const SCRATCH_PATH_BLOCK_TEMPLATE = `${SCRATCH_PATH_BLOCK_HEADING}

Write every temporary file for this task under this ABSOLUTE path:
${SCRATCH_DIR_PLACEHOLDER}

Never redirect to a path that depends on the working directory — \`2> out.err\`, \`> run.log\`, \`./scratch/\`. A cwd-relative redirect writes wherever the task happens to \`cd\`: measured 2026-10-02, five zero-byte \`*.err\` captures landed at the repository root and were committed, and \`git status\` stayed clean because the files were tracked. Use the absolute path above; it lives under the session's runtime dir, which is gitignored, so nothing written there can be committed by accident.
`;

/** The session id the dispatch context itself uses when none is bound. */
const UNKNOWN_SESSION_ID = 'unknown-sid';

/** The role segment used when the role is not a single safe path segment. */
const UNKNOWN_ROLE = 'unknown-role';

/**
 * The path in the form every shell accepts: forward slashes on every
 * platform.
 *
 * A Windows path spelled with backslashes is an ESCAPE SEQUENCE to a POSIX
 * shell — `> D:\repo\x.log` there writes a file named `D:repox.log` into the
 * CURRENT directory, which is the exact leak this block exists to stop. The
 * forward-slash form is accepted by bash, cmd, PowerShell and Node alike.
 */
export function toShellPath(path: string): string {
  return path.split('\\').join('/');
}

/**
 * The absolute scratch directory for one dispatch.
 *
 * Pure, and independent of the working directory: the only input that is not
 * the project root and the two id segments is the filesystem separator. A
 * RELATIVE project root is resolved against the cwd — the dispatch CLI passes
 * an absolute one (`options.project ?? process.cwd()`), and the emitted path
 * is absolute either way.
 */
export function resolveScratchDir(projectRoot: string, sid: string, role: string): string {
  const root = resolve(projectRoot);
  const sessionId = isSinglePathSegment(sid) ? sid : UNKNOWN_SESSION_ID;
  const roleSegment = isSinglePathSegment(role) ? role : UNKNOWN_ROLE;
  return join(getSessionDir(root, sessionId), roleSegment, 'scratch');
}

/**
 * The block for one dispatch, with the absolute path substituted.
 *
 * Pure. The replacement is done with a FUNCTION so a path that contains a
 * `$` sequence is inserted literally rather than read as a replacement
 * pattern.
 */
export function buildScratchPathBlock(scratchDir: string): string {
  return SCRATCH_PATH_BLOCK_TEMPLATE.replace(SCRATCH_DIR_PLACEHOLDER, () =>
    toShellPath(scratchDir)
  );
}

/** The outcome of creating the scratch directory. */
export type ScratchDirState =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Create the scratch directory so the FIRST redirect into it works.
 *
 * A redirect into a directory that does not exist fails, and an agent that
 * hits that failure is an agent that may fall back to a cwd-relative path —
 * the leak this block exists to stop. The failure is reported rather than
 * swallowed: the caller turns it into a dispatch warning, so a scratch
 * directory that could not be created is visible instead of silent.
 */
export function ensureScratchDir(scratchDir: string): ScratchDirState {
  try {
    mkdirSync(scratchDir, { recursive: true });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** What one dispatch's prompt gains. */
export type ScratchPathInjection = {
  /** The block, with the absolute path substituted. */
  readonly block: string;
  /** The absolute scratch directory, with the platform's own separators. */
  readonly scratchDir: string;
  /** Null when the directory exists; the reason when it does not. */
  readonly warning: string | null;
};

/**
 * The scratch-path block for one dispatch, and the one side effect that makes
 * it usable: the directory is created so the first redirect into it works.
 */
export function buildScratchPathInjection(input: {
  projectRoot: string;
  sid: string;
  role: string;
}): ScratchPathInjection {
  const scratchDir = resolveScratchDir(input.projectRoot, input.sid, input.role);
  const state = ensureScratchDir(scratchDir);
  return {
    scratchDir,
    block: buildScratchPathBlock(scratchDir),
    warning:
      state.ok === true
        ? null
        : `scratch directory could not be created (${state.reason}); the sub-agent must ` +
          'create it before writing scratch into it, and must not fall back to a ' +
          'cwd-relative path'
  };
}
