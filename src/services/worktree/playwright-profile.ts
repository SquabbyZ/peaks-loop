/**
 * playwright-profile — deterministic Chromium user-data-dir +
 * profile-name pair generator for a (session, dispatch) tuple.
 *
 * Slice 2026-08-01-subagent-merge-and-e2e (Task 2). Each sub-agent
 * dispatch with `--isolation worktree` MUST land its Playwright MCP
 * browser session in a unique Chromium profile so concurrent
 * dispatches do not share cookies / localStorage / IndexedDB. The
 * pair is:
 *
 *   userDataDir = <projectRoot>/.peaks/_runtime/<sessionId>/pw-profiles/<dispatchId>
 *   profileName = "dispatch-<dispatchId>"
 *
 * The userDataDir is gitignored (it lives under `.peaks/_runtime/`)
 * so cookies do not leak across slices. The profileName is the
 * Chromium `--profile-directory` flag the Playwright MCP server
 * reads when it spawns the browser.
 */
import { join } from 'node:path';

export function playwrightProfilePaths(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly dispatchId: string;
}): { readonly userDataDir: string; readonly profileName: string } {
  const userDataDir = join(
    input.projectRoot,
    '.peaks',
    '_runtime',
    input.sessionId,
    'pw-profiles',
    input.dispatchId,
  );
  return { userDataDir, profileName: `dispatch-${input.dispatchId}` };
}
