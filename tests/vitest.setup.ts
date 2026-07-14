// Vitest per-file setup: pin process.cwd() to the project root in every worker.
//
// The `.peaks/.session.json` + `.active-skill.json` stash/restore that used to
// live here moved to tests/vitest.global-setup.ts (runs once in the main
// process). That move is what lets vitest.config.ts enable file parallelism
// safely — see that file's header and
// .peaks/memory/slice-014-vitest-slowdown-and-race-repeat.md.
//
// Why pin cwd
// -----------
// vitest.config.ts sets `root` for test discovery, but production code paths
// under test (session-manager readers, skill loaders, openspec scanners) walk
// process.cwd() to resolve repo-relative paths. When the test runner inherits a
// Temp cwd from `peaks session init` (the orchestrator creates a workspace
// under AppData/Local/Temp), those walkers resolve to a directory that does not
// contain the repo and ENOENT. The Temp side-effect itself is a design choice
// (PRD 2026-06-24-baseline-92-triage risk R4) and is intentionally NOT
// modified; this chdir isolates each vitest worker from it.
//
// Parallel-safe: with `fileParallelism: true` each test file runs in its own
// forked worker; every worker runs this setup once before any of its tests see
// process.cwd(), and chdir is process-local so parallel workers cannot
// interfere. Tests that need a different cwd already override it via
// vi.spyOn(process, 'cwd') (e.g. tests/unit/doctor.test.ts).

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const setupProjectRoot = resolve(here, '..');
if (process.cwd() !== setupProjectRoot) {
  process.chdir(setupProjectRoot);
}
