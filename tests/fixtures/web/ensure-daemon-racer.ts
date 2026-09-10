/**
 * One caller of `ensureDaemon`, run as a REAL child process by
 * `tests/unit/services/web/web-daemon-race.test.ts`.
 *
 * It exists as a process, not as a function call, because that is what Q10
 * actually permits: the orchestrator and a sub-agent are two separate `peaks`
 * processes touching one `(projectRoot, sessionId)`. Two in-process callers
 * would share a pid, and `acquireSpawnLock`'s ownership rule is pid-based — so
 * the cross-process case is the one that has to be measured.
 *
 * Usage: `tsx ensure-daemon-racer.ts <projectRoot> <sessionId> [readyFile] [triggerFile]`
 *
 * With `readyFile` + `triggerFile` the call is held until the test fires the
 * trigger: the process is loaded (the expensive part, ~300 ms of `node` + `tsx`
 * + import) and only THEN asks for a daemon. That turns "the second caller
 * arrives somewhere in the winner's cold-start window" from a timing guess into
 * a thing the test can aim.
 *
 * Prints one JSON line `{pid, port}` for the daemon it reached (or exits 1).
 */
import { existsSync, writeFileSync } from 'node:fs';

import { ensureDaemon } from '../../../src/services/web/daemon-supervisor.js';

const projectRoot = process.argv[2] ?? '';
const sessionId = process.argv[3] ?? '';
const readyFile = process.argv[4];
const triggerFile = process.argv[5];

function delay(ms: number): Promise<void> {
  return new Promise((resume) => {
    setTimeout(resume, ms);
  });
}

async function waitForFile(path: string): Promise<void> {
  while (!existsSync(path)) {
    await delay(5);
  }
}

async function main(): Promise<void> {
  if (readyFile !== undefined && triggerFile !== undefined) {
    writeFileSync(readyFile, 'ready', 'utf8');
    await waitForFile(triggerFile);
  }
  const info = await ensureDaemon(projectRoot, sessionId);
  process.stdout.write(`${JSON.stringify({ pid: info.pid, port: info.port })}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
