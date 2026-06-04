// Vitest global setup: stash the real project's `.peaks/.session.json` so the
// test suite runs in a "no active session" state.
//
// Why this exists
// ---------------
// `src/shared/change-id.ts:buildArtifactRelativePath` walks
// `process.cwd()` to find the project root and reads `.peaks/.session.json`
// from it. When the file exists with a session id, the helper returns
// session-based paths like `.peaks/<sessionId>/<role>/<numberedFilename>`
// instead of legacy changeId-based paths like
// `.peaks/<changeId>/rd/architecture`. The 31 tests under
// `tests/unit/{tech,rd,workflow-autonomous,autonomous-resume-writer,
// workflow-autonomous-resume-validation,cli-program.workflow}.test.ts`
// assert the legacy changeId-based shape; they were written assuming the
// dev environment has no active session binding.
//
// When a developer (or a `peaks-solo` orchestrator) has run
// `peaks workspace init` in this repo, that file is created and the 31
// tests start failing even though the production code is correct for
// the "session active" code path. This setup moves the file out of the
// way for the duration of the test run, and restores it on process
// exit so the developer's peaks-solo session keeps working.
//
// Per-test-file semantics
// -----------------------
// vitest runs this file once per test file (not once per worker). The
// first test file in each worker finds the real file, renames it, and
// registers an `exit` handler. Subsequent test files in the same
// worker see the renamed file path empty and skip the rename. The
// exit handler is registered on the worker's process, so when the
// worker finishes its last test file the handler restores the file.
// Cross-worker behaviour: vitest spawns one process per worker
// (configurable), so each worker independently stashes / restores.
// Workers run in parallel; the worst case is that worker A stashes
// the file before worker B starts, worker B sees no file (skips
// stash), and worker A restores on exit. End state: file is back.
//
// This file is NOT a test (no `.test.ts` suffix) and is therefore not
// picked up by `test.include` as a test. It runs only as a setupFile
// declared in `vitest.config.ts`.
//
// We do NOT `vi.mock` the session-manager here, because three test
// files legitimately test session-aware behaviour and have their own
// per-file mocks:
//
//   - tests/unit/session-manager.test.ts (tests session-manager itself)
//   - tests/unit/session-workspace-service.test.ts (uses real session)
//   - tests/unit/change-id.test.ts (has its own `vi.mock('session-manager')`
//     and a `describe('buildArtifactRelativePath with session', ...)`
//     block that exercises the session branch on purpose)
//
// A global vi.mock would shadow those local mocks and break the
// session-aware tests. The file-stash approach is non-invasive.

import { existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const projectRoot = process.cwd();
const sessionPath = join(projectRoot, '.peaks', '.session.json');
const sessionBackupPath = join(projectRoot, '.peaks', '.session.json.test-bak');
const presencePath = join(projectRoot, '.peaks', '.active-skill.json');
const presenceBackupPath = join(projectRoot, '.peaks', '.active-skill.json.test-bak');

function stashIfPresent(path: string, backupPath: string): boolean {
  if (!existsSync(path)) return false;
  try {
    renameSync(path, backupPath);
    return true;
  } catch {
    // Another worker in the same vitest run already stashed the file.
    return false;
  }
}

const stashedSession = stashIfPresent(sessionPath, sessionBackupPath);
const stashedPresence = stashIfPresent(presencePath, presenceBackupPath);

if (stashedSession || stashedPresence) {
  // Best-effort restore on worker exit. The first test file in each
  // worker stashes; subsequent test files see no files to stash and
  // skip. Only the first file's setup runs the actual rename, so only
  // it ever sees the backup files to restore on exit.
  const restore = () => {
    if (existsSync(sessionBackupPath)) {
      try { renameSync(sessionBackupPath, sessionPath); } catch { /* best-effort */ }
    }
    if (existsSync(presenceBackupPath)) {
      try { renameSync(presenceBackupPath, presencePath); } catch { /* best-effort */ }
    }
  };

  process.once('exit', restore);
  process.once('SIGINT', () => {
    restore();
    process.exit(130);
  });
  process.once('SIGTERM', () => {
    restore();
    process.exit(143);
  });
}
