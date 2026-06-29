#!/usr/bin/env node
/**
 * CI integration driver — invoked as a child process by
 * `tests/integration/binding-store/multi-process.test.ts`.
 *
 * Each invocation represents ONE Claude Code window. The driver:
 *   1. Reads `process.env.PEAKS_TEST_PROJECT_ROOT` (the shared tmp project root).
 *   2. Reads `process.env.PEAKS_TEST_CLAUDE_SESSION_ID` (the simulated
 *      CLAUDE_CODE_SESSION_ID — both children get the SAME value to
 *      simulate two Claude windows on the same host sharing the env).
 *   3. Sets `CLAUDE_CODE_SESSION_ID` to that env value (so binding-store
 *      sees two callers with identical outer-session-id — the v2.17.0
 *      bug scenario).
 *   4. Imports the built `binding-store` from `dist/` (post-build
 *      requirement, matches the production code path).
 *   5. Calls `registerInstance` with a process-unique callerId (built
 *      from `<envSignal>#<process.pid>`, mirroring the v2.18.0
 *      production caller-id strategy).
 *   6. Writes a JSON envelope `{ pid, callerId, sid, instancesCount }`
 *      to stdout (one line, machine-readable).
 *
 * Exit 0 on success, non-zero on failure (with stderr detail).
 *
 * The driver is intentionally tiny — it does NOT exercise peaks-solo or
 * the full CLI surface; it tests the binding-store primitive that
 * v2.18.0 fixed, which is the regression surface.
 */
import { registerInstance, readBinding } from '../../dist/src/services/session/binding-store.js';

const projectRoot = process.env.PEAKS_TEST_PROJECT_ROOT;
const envSignal = process.env.PEAKS_TEST_CLAUDE_SESSION_ID;

if (!projectRoot) {
  process.stderr.write('[ci-binding-driver] PEAKS_TEST_PROJECT_ROOT is unset\n');
  process.exit(2);
}
if (!envSignal) {
  process.stderr.write('[ci-binding-driver] PEAKS_TEST_CLAUDE_SESSION_ID is unset\n');
  process.exit(2);
}

// Match the v2.18.0 production callerId strategy: env-signal + pid.
const callerId = `${envSignal}#${process.pid}`;

try {
  const result = registerInstance(projectRoot, {
    callerId,
    roles: ['peaks-solo']
  });
  const binding = readBinding(projectRoot);
  const instancesCount = binding ? Object.keys(binding.instances).length : 0;
  const envelope = {
    ok: true,
    pid: process.pid,
    callerId,
    sid: result.sid,
    instancesCount
  };
  process.stdout.write(JSON.stringify(envelope) + '\n');
  process.exit(0);
} catch (err) {
  process.stderr.write(`[ci-binding-driver] registerInstance failed: ${(err && err.stack) || String(err)}\n`);
  process.exit(1);
}