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

import { afterEach } from 'vitest';

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

const SAVED_ENV: Record<string, string | undefined> = {};

/**
 * Set `process.env[name] = value` for the duration of the current test and
 * restore the previous value (or delete it) on `afterEach`. Prevents
 * parallel test files from leaking env mutations.
 */
export function withEnv(name: string, value: string | undefined): void {
  if (!(name in SAVED_ENV)) {
    SAVED_ENV[name] = process.env[name];
  }
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
  afterEach(() => {
    const prev = SAVED_ENV[name];
    if (prev === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = prev;
    }
    delete SAVED_ENV[name];
  });
}
