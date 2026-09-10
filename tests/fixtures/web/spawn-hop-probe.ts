/**
 * Prints the pid of the process that CREATED this one.
 *
 * `web-spawn-hardening.test.ts` launches it with the exact argv the daemon is
 * launched with (`process.execPath` + `interpreterArgs`). If the chain still
 * contained a shell — `cmd.exe /d /s /c node …`, which is what npm's own
 * `run-script` inserts under `npx` — the parent it reported would be that
 * intermediate process and not the spawner, which is a fact about the live
 * process tree rather than a reading of the argv.
 */
process.stdout.write(`${JSON.stringify({ ppid: process.ppid, pid: process.pid })}\n`);
