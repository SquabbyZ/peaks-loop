// tests/unit/cli/commands/code-context-now-mode-parity.test.ts
//
// Slice 2026-09-12-compact-band-policy, defect A.
//
// `peaks code context-now` downgraded the 0.85–0.95 band to `soft-warn`
// (advisory) whenever the session was NOT Job-shaped. Four other sources
// of truth said the band is MANDATORY auto-compact:
//   - the command's own --help text,
//   - `peaks skill presence`'s `context.action = 'pre-compact'`,
//   - skills/peaks-code/SKILL.md (the 0.85–0.95 pre-compact zone),
//   - `.peaks/memory/auto-compact-threshold-policy.md` (user-calibrated
//     2026-07-27: soft-mandatory).
// An LLM that follows the SKILL's designated "single source of truth"
// (`context-now`) therefore NEVER compacted in the zone — a direct
// violation of the zero-pause contract.
//
// These tests exercise the REAL CLI action (registered command +
// captured IO). No child process, no network.

import { afterEach, describe, expect, it } from 'vitest';
import { Command } from 'commander';

import { makeCapturedIo, withEnv } from '../../_setup/io.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';
import { registerCodeRuntimeCommands } from '../../../../src/cli/commands/code-runtime-commands.js';

/** The ratio is forced through the canonical Claude Code env seam. */
const RATIO_ENV = 'CLAUDE_CONTEXT_USAGE_PERCENT';

interface ContextNowEnvelope {
  readonly ok: boolean;
  readonly command: string;
  readonly data: {
    readonly ratio: number;
    readonly action: 'ok' | 'soft-warn' | 'auto-compact-now' | 'red-line';
    readonly verdict: 'ok' | 'soft-warn' | 'pre-compact' | 'red-line';
    readonly next: string | null;
    readonly jobMode: boolean;
  };
  readonly nextActions: readonly string[];
}

function parseEnvelope(text: string): ContextNowEnvelope {
  return JSON.parse(text) as ContextNowEnvelope;
}

describe('peaks code context-now — single-rid / job-mode threshold parity', () => {
  const ws = withTmpWorkspacePerTest('peaks-ctx-now-parity-');

  afterEach(() => {
    process.exitCode = undefined;
  });

  async function runContextNow(
    args: readonly string[],
  ): Promise<ContextNowEnvelope> {
    const { io, captured } = makeCapturedIo();
    const program = new Command();
    const code = program.command('code');
    registerCodeRuntimeCommands(code, io);
    await program.parseAsync(['code', 'context-now', '--json', ...args], { from: 'user' });
    return parseEnvelope(captured.text());
  }

  it('when invoked, should ratio=0.87 single-rid → action=auto-compact-now / verdict=pre-compact (MANDATORY, not advisory)', async () => {
    // given: no job-shape.json, no --enforce-job-mode (the single-rid case)
    withEnv(RATIO_ENV, '0.87');
    withEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    // when: the canonical probe runs
    const env = await runContextNow(['--project', ws().path, '--session-id', '2026-09-12-parity']);
    // then: the band is mandatory here too
    expect(env.ok).toBe(true);
    expect(env.data.ratio).toBeGreaterThanOrEqual(0.85);
    expect(env.data.action).toBe('auto-compact-now');
    expect(env.data.verdict).toBe('pre-compact');
    expect(env.data.next).toBe('peaks code auto-compact');
    expect(env.data.jobMode).toBe(false);
    // The old "advisory mode (single-rid) ... not mandatory" notice was
    // false once the downgrade was removed and must not come back.
    expect(env.nextActions.join('\n')).not.toMatch(/not mandatory/i);
    expect(env.nextActions.join('\n')).not.toMatch(/advisory mode/i);
  });

  it('when invoked, should ratio=0.87 with --enforce-job-mode → the SAME action as single-rid (parity)', async () => {
    // given: the identical ratio, this time labelled Job-shaped
    withEnv(RATIO_ENV, '0.87');
    withEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    // when: the canonical probe runs with --enforce-job-mode
    const env = await runContextNow([
      '--project', ws().path,
      '--session-id', '2026-09-12-parity',
      '--enforce-job-mode',
    ]);
    // then: only the label differs — the thresholds no longer do
    expect(env.data.action).toBe('auto-compact-now');
    expect(env.data.verdict).toBe('pre-compact');
    expect(env.data.jobMode).toBe(true);
  });

  it('when invoked, should ratio=0.96 stays red-line in both modes', async () => {
    withEnv(RATIO_ENV, '0.96');
    withEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    const singleRid = await runContextNow(['--project', ws().path, '--session-id', '2026-09-12-parity']);
    expect(singleRid.data.action).toBe('red-line');
    expect(singleRid.data.verdict).toBe('red-line');
    expect(singleRid.data.next).toBe('peaks code auto-compact');
  });

  it('when invoked, should ratio=0.40 stays ok in both modes (the band below the warning line is untouched)', async () => {
    withEnv(RATIO_ENV, '0.40');
    withEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    const env = await runContextNow(['--project', ws().path, '--session-id', '2026-09-12-parity']);
    expect(env.data.action).toBe('ok');
    expect(env.data.verdict).toBe('ok');
    expect(env.data.next).toBeNull();
  });

  // Slice 2026-09-13-auto-compact-trigger-ownership, round 2 — defect 2.
  //
  // This command's success path hard-coded `printResult(..., true)`, so its
  // declared `--json` flag was a no-op and the notices it emits as
  // `nextActions` were NEVER printed as text: a person running the command saw
  // a JSON blob and nothing else. Since peaks-loop rewrites the user's own
  // harness settings on this path, "the user cannot see it" was the exact
  // failure the write was accepted on condition of avoiding — 要告知.
  describe('output mode parity — the notice must reach a human, and --json must still be machine-readable', () => {
    async function runRaw(args: readonly string[]): Promise<{ text: string; stderrText: string }> {
      const { io, captured } = makeCapturedIo();
      const program = new Command();
      const code = program.command('code');
      registerCodeRuntimeCommands(code, io);
      await program.parseAsync(['code', 'context-now', ...args], { from: 'user' });
      return { text: captured.text(), stderrText: captured.stderrText() };
    }

    it('when --json is passed, should emit ONE parseable envelope with nextActions carried inside it (machines unchanged)', async () => {
      withEnv(RATIO_ENV, '0.87');
      withEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
      // when: the machine path runs
      const { text } = await runRaw(['--json', '--project', ws().path, '--session-id', '2026-09-12-parity']);
      // then: byte-compatible with the pre-round-2 behaviour — a bare envelope,
      //       no `next:` lines spliced into stdout
      const env = parseEnvelope(text);
      expect(env.ok).toBe(true);
      expect(env.nextActions.length).toBeGreaterThan(0);
      expect(text.startsWith('{')).toBe(true);
      expect(text).not.toContain('next: ');
    });

    it('when --json is OMITTED, should print the notices as human-readable `next:` lines', async () => {
      withEnv(RATIO_ENV, '0.87');
      withEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
      // when: a human runs the command with no flag
      const { text } = await runRaw(['--project', ws().path, '--session-id', '2026-09-12-parity']);
      // then: every notice is a readable line — including the harness-window
      //       one, which is the only place a user can learn what was written
      //       to their settings and how to undo it
      expect(text).toContain('next: ');
      expect(text).toContain('next: Harness window');
    });
  });

  it('when invoked, should report the harness-window sync in the envelope (skipped, never a silent write)', async () => {
    // given: a percent-based probe — the harness handles the ratio itself, so
    //        peaks-loop has NO token window to write (slice
    //        2026-09-13-auto-compact-trigger-ownership)
    withEnv(RATIO_ENV, '0.90');
    withEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    // when: the canonical probe runs
    const env = await runContextNow(['--project', ws().path, '--session-id', '2026-09-12-parity']);
    // then: the field is present and says what happened — peaks-loop never
    //       invents a window it did not measure, and never writes silently
    const harnessWindow = (env.data as { harnessWindow?: { action: string; reason?: string } }).harnessWindow;
    expect(harnessWindow).toBeDefined();
    expect(harnessWindow!.action).toBe('skipped');
    expect(harnessWindow!.reason).toBe('no-window-resolved');
  });
});
