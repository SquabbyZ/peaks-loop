// The two prompt blocks `composeDispatchPrompt` prepends: the Part 2.C worktree
// isolation envelope and the F5 `must_ls_files` anti-fake-green enforcement
// block. Split out of `dispatch-prompt-composition.ts` when compressing that
// module's long function pushed it past the 300-line cap; both bodies are the
// originals, moved verbatim.
import { runGitLsFiles } from '../../services/dispatch/dispatch-sub-agent.js';
import { type DispatchOptions } from './sub-agent-shared.js';

// Part 2.C: when --isolation worktree, prepend an isolation envelope
// block so the sub-agent sees the lease id + worktree path. The block
// is short (a few lines). We deliberately do NOT set
// process.env.PEAKS_WORKTREE_LEASE_ID here — sub-agents are spawned
// by the LLM in its own environment, not as children of this CLI;
// the lease id travels through the dispatch record + prompt body.
export function buildIsolationBlock(
  isolationMode: 'worktree' | 'container' | 'vm' | null,
  leaseId: string | null,
  worktreePath: string | null,
  worktreeBranch: string | null
): string {
  return isolationMode !== null && leaseId !== null
    ? `\n## Worktree isolation (Part 2.C)\n` +
        `leaseId: ${leaseId}\n` +
        `worktreePath: ${worktreePath}\n` +
        `branch: ${worktreeBranch}\n` +
        `You MAY ` +
        '`git worktree add` ' +
        `and ` +
        '`git worktree remove` ' +
        `against this lease without a separate ` +
        '`peaks worktree auth grant` ' +
        `— the PreToolUse gate reads the lease file. Run ` +
        '`peaks worktree release --lease-id ${leaseId}` ' +
        `when done.\n`
    : '';
}

// F5 follow-up: anti-fake-green gate. When `--must-ls-files <glob>`
// is supplied, run `git ls-files <glob>` upfront, surface the
// result in the envelope as `mustLsFilesVerification: { path,
// exists, files }`, and prepend a `## must_ls_files enforcement`
// frontmatter block to the sub-agent prompt that mandates the
// file-existence verification as the LLM's FIRST action (before
// any "completed"/"PASS" claim). When the flag is absent the
// field is `null` and no block is injected — old call sites
export function buildMustLsFilesBlock(
  options: DispatchOptions,
  projectRoot: string
): {
  mustLsFilesVerification: { path: string; exists: boolean; files: readonly string[] } | null;
  mustLsFilesBlock: string;
} {
  let mustLsFilesVerification: {
    path: string;
    exists: boolean;
    files: readonly string[];
  } | null = null;
  let mustLsFilesBlock = '';
  if (typeof options.mustLsFiles === 'string' && options.mustLsFiles.length > 0) {
    const glob = options.mustLsFiles;
    const files = runGitLsFiles(projectRoot, glob);
    const exists = files.length > 0;
    mustLsFilesVerification = { path: glob, exists, files };
    mustLsFilesBlock =
      `\n## must_ls_files enforcement (F5 anti-fake-green)\n` +
      `glob: ${glob}\n` +
      `verification: ${exists ? `EXISTS (${files.length} file${files.length === 1 ? '' : 's'} found)` : 'MISSING (no files matched the glob)'}\n` +
      (exists ? `first match: ${files[0] ?? ''}\n` : '') +
      `BEFORE any claim that work is "completed" or "PASS", you MUST run \`git ls-files ${glob}\` from the project root and ` +
      `confirm the file exists. Anti-fake-green rule (sediment 2026-08-11-rid-001-redo-fake-green-recovery-closure §Lesson 1): ` +
      `if the file does not exist, your verdict MUST be \`status: "blocked"\` with reason "must_ls_files_failed". Do NOT silently skip this step.\n`;
  }
  return { mustLsFilesVerification, mustLsFilesBlock };
}
