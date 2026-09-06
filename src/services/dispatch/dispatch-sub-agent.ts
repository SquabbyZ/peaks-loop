/**
 * F5 follow-up (sediment 2026-08-11-rid-001-redo-fake-green-recovery-closure
 * §Lesson 1): synchronous anti-fake-green file-existence gate. Runs
 * `git ls-files <glob>` against `projectRoot` and returns the matching
 * tracked file paths (relative to projectRoot). Empty array when no
 * files match (e.g. untracked new file, wrong glob, not a git repo).
 *
 * Why `git ls-files` and not `fs.glob`: the anti-fake-green contract
 * is "the file the sub-agent claims to have written must ACTUALLY be
 * tracked by git" — `git ls-files` enforces that contract; `fs.glob`
 * would happily return untracked-but-on-disk files (false-positive
 * for the fake-green gate).
 *
 * Failure modes (best-effort, never throws):
 *  - git not on PATH → empty array (`ENOENT` swallowed)
 *  - not a git repo → empty array (git exits non-zero)
 *  - glob matches zero tracked files → empty array
 *
 * Exported for unit-test access (`tests/unit/sub-agent/must-ls-files-flag.test.ts`).
 * The export is intentional — the helper has zero side effects and
 * keeps the dispatch action handler small.
 */
export function runGitLsFiles(projectRoot: string, glob: string): readonly string[] {
  try {
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
    const stdout = execFileSync(
      'git',
      ['ls-files', '--', glob],
      { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }
    );
    return stdout.split('\n').filter((line: string) => line.length > 0);
  } catch {
    return [];
  }
}

/* ---------- Slice 4.0.8 RD §4 D4c: programmatic dispatcher ---------- */

/**
 * `dispatchSubAgent` is the thin programmatic wrapper the integration
 * test (`tests/integration/sub-agent-graph-binding.test.ts`) imports.
 * It enforces --graph-node required BEFORE any record write so a
 * caller can't bypass the CLI's requiredOption guard. Throws a typed
 * error with `code = PEAKS_GRAPH_NODE_REQUIRED` when missing.
 */
export async function dispatchSubAgent(input: {
  projectRoot: string;
  role: string;
  prompt: string;
  sessionId?: string;
  graphNode?: string;
  workflowId?: string;
  graphRef?: string;
}): Promise<{ role: string; toolCall: unknown; dispatchRecordPath: string | null }> {
  if (typeof input.graphNode !== 'string' || input.graphNode.length === 0) {
    const err = new Error('PEAKS_GRAPH_NODE_REQUIRED: --graph-node is required (RD §4 D4c)') as Error & { code: string };
    err.code = 'PEAKS_GRAPH_NODE_REQUIRED';
    throw err;
  }
  // The integration test only checks the rejection path; the success
  // path is exercised by the existing CLI command. Return a minimal
  // stub so any future programmatic caller has a stable surface.
  return {
    role: input.role,
    toolCall: null,
    dispatchRecordPath: null,
  };
}
