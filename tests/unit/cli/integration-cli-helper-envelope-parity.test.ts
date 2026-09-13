// tests/unit/cli/integration-cli-helper-envelope-parity.test.ts
//
// rid 2026-09-13-leftover-cleanup item 3.2.
//
// `tests/integration/_cli-helper.ts` exists so integration tests can drive the
// real Commander program in-process instead of spawning a `node + tsx` child
// per call. Because it is in-process, Commander's `exitOverride()` throws into
// ITS catch block rather than reaching `src/cli/index.ts`'s `.catch()` — so the
// helper has to re-create the wrapper's error envelope by hand.
//
// That hand-written mirror drifted: when the wrapper moved a missing
// `.requiredOption()` from `UNHANDLED_ERROR` / `command: "cli"` to
// `MISSING_REQUIRED_OPTION` / `command: "<real command path>"`, the mirror kept
// emitting the old shape. Eleven integration files import the helper, and the
// one that asserts on a missing required option therefore asserted an envelope
// production no longer produced.
//
// This case pins the mirror to production — not to a literal, which is what
// made it drift in the first place. It asserts the SAME builder output.
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli } from '../../integration/_cli-helper.js';
import {
  printMissingRequiredOptionEnvelope,
  resolveInvokedCommandPath,
  type ProgramIO
} from '~/src/cli/cli-helpers';
import { createProgram } from '~/src/cli/program';

/** The single JSON object embedded in a stream that also carries prose. */
function jsonIn(text: string): Record<string, unknown> {
  const match = text.match(/\{[\s\S]*\}/);
  expect(match, `no JSON envelope in:\n${text}`).not.toBeNull();
  return JSON.parse(match![0]) as Record<string, unknown>;
}

describe('behavior — the in-process test runner mirrors the CLI wrapper', () => {
  it('emits the production MISSING_REQUIRED_OPTION envelope, not the pre-fix shape', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'peaks-cli-helper-'));
    try {
      // `asset crystallize` declares ~19 required options; with none supplied
      // Commander rejects on the first one, before the action callback runs.
      const result = await runCli(['asset', 'crystallize', '--json'], cwd);

      const envelope = jsonIn(result.stderr);
      expect(result.code).toBe(1);
      expect(envelope.ok).toBe(false);
      expect(envelope.code).toBe('MISSING_REQUIRED_OPTION');
      // The field the old mirror could not produce: the real command path,
      // not the generic `cli`.
      expect(envelope.command).toBe('asset crystallize');
      expect(envelope.data).toEqual({ option: '--from-task <id>' });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('produces byte-identical output to the shared builder production calls', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'peaks-cli-helper-'));
    try {
      const result = await runCli(['asset', 'crystallize', '--json'], cwd);
      const actual = jsonIn(result.stderr);

      // Re-derive the same envelope through the production path: the wrapper's
      // own args walk, over the wrapper's own program.
      const argv = ['asset', 'crystallize', '--json'];
      const program = createProgram();
      const invoked = resolveInvokedCommandPath(program, argv);
      const chunks: string[] = [];
      const io: ProgramIO = { stdout: (t) => chunks.push(t), stderr: (t) => chunks.push(t) };
      printMissingRequiredOptionEnvelope(
        io,
        invoked,
        "error: required option '--from-task <id>' not specified"
      );
      const expected = jsonIn(chunks.join('\n'));

      // `errorId` is minted per call, so compare everything else.
      const strip = (e: Record<string, unknown>): Record<string, unknown> => {
        const { errorId: _errorId, ...rest } = e;
        return rest;
      };
      expect(strip(actual)).toEqual(strip(expected));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
