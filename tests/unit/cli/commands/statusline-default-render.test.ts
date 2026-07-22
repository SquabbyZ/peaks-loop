/**
 * Bug-02 regression suite (ice-cola surface check 2026-07-22).
 *
 * `peaks statusline` (no subcommand) is documented as "Run with no
 * subcommand to render" but, prior to the fix, fell through commander and
 * printed the CLI usage banner instead of invoking the hidden render
 * subcommand. The fix wires a default `.action(...)` on the top-level
 * `statusline` command that delegates to the shared
 * `runDefaultStatuslineRender` body. This suite covers the body in
 * isolation (stub IO + stdin) so a future refactor cannot silently
 * re-introduce the regression.
 */

import { describe, expect, test } from 'vitest';
import { Writable } from 'node:stream';

import {
  runDefaultStatuslineRender
} from '../../../../src/cli/commands/statusline-commands.js';
import type { ProgramIO } from '../../../../src/cli/cli-helpers.js';

class CollectingWritable extends Writable {
  public chunks: Buffer[] = [];
  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    callback();
  }
  get text(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

function makeIo(): { io: ProgramIO; stdout: CollectingWritable; stderr: CollectingWritable } {
  const stdout = new CollectingWritable();
  const stderr = new CollectingWritable();
  const io: ProgramIO = {
    stdout: (data: string) => stdout.write(data),
    stderr: (data: string) => stderr.write(data)
  };
  return { io, stdout, stderr };
}

describe('Bug-02 — peaks statusline default render dispatch (ice-cola regression)', () => {
  test('runDefaultStatuslineRender emits the rendered status line text', async () => {
    const { io, stdout } = makeIo();
    await runDefaultStatuslineRender({ project: '/home/dev/ice-cola' }, io);
    expect(stdout.text).toMatch(/⛰ Peaks/);
    expect(stdout.text.length).toBeGreaterThan(0);
    // Sanity: stdout captures a single line (no trailing newline from chunks).
    expect(stdout.text).not.toMatch(/\n/);
  });

  test('--json emits a JSON envelope with statusline.render command key', async () => {
    const { io, stdout } = makeIo();
    await runDefaultStatuslineRender({ project: '/home/dev/ice-cola', json: true }, io);
    const parsed = JSON.parse(stdout.text) as {
      ok: boolean;
      command: string;
      data: { text: string };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe('statusline.render');
    expect(parsed.data.text).toMatch(/⛰ Peaks/);
  });

  test('without --project, render still succeeds (uses cwd-fallback seed)', async () => {
    const { io, stdout } = makeIo();
    await runDefaultStatuslineRender({}, io);
    expect(stdout.text).toMatch(/⛰ Peaks/);
  });
});
