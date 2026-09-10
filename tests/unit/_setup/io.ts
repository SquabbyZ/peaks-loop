// tests/unit/_setup/io.ts
//
// IO capture helpers. The peaks-loop CLI takes a `ProgramIO` (see
// src/cli/cli-helpers.ts) so we never need to monkey-patch `process.stdout`
// / `process.stderr`. The default is to construct a fresh in-memory sink
// pair per test and inspect what was written.
//
// Env vars are also process-wide side-effects. The rebuild rule: every test
// that mutates `process.env.X` must restore the previous value, ideally via
// this helper.

import { afterEach, onTestFinished } from 'vitest';

export interface CapturedIo {
  readonly stdout: string[];
  readonly stderr: string[];
  readonly text: () => string;
  readonly stderrText: () => string;
  readonly lines: () => string[];
}

export function makeCapturedIo(): {
  io: { stdout(s: string): void; stderr(s: string): void };
  captured: CapturedIo;
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: (s: string) => stdout.push(s),
      stderr: (s: string) => stderr.push(s),
    },
    captured: {
      stdout,
      stderr,
      text: () => stdout.join('\n'),
      stderrText: () => stderr.join('\n'),
      lines: () => stdout,
    },
  };
}

/**
 * Set `process.env[name] = value` for the duration of the current test and
 * restore the previous value (or delete it) when that test ends.
 *
 * Each call captures its own `prev` in a closure, so stacking N calls for the
 * same name unwinds LIFO: the last call restores to the second-to-last call's
 * value, and the first restores the pre-test value. No shared save map.
 *
 * The restore is registered with `onTestFinished`, which binds to the test
 * that made the call. `afterEach` cannot serve here: a hook registered from
 * inside a test body is appended to the suite's hook list and never runs for
 * the test that registered it, so the mutation used to outlive the test and
 * leak into the next one in the file.
 *
 * `onTestFinished` is only valid inside a test lifecycle (a test body, or
 * `beforeEach`/`afterEach`). The describe-body call sites that run at
 * collection time — `cli/program.test.ts`, `services/dispatch/batch-counter.test.ts`,
 * `services/karpathy-cost/karpathy-cost-check-service.test.ts` — would throw
 * there, so they fall back to `afterEach`, which at collection time is
 * correctly scoped to that describe's tests.
 */
export function withEnv(name: string, value: string | undefined): void {
  const prev = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
  const restore = (): void => {
    if (prev === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = prev;
    }
  };
  try {
    onTestFinished(restore);
  } catch {
    // Collection time: no current test to bind to, so scope to the describe.
    afterEach(restore);
  }
}
