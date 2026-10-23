// tests/unit/cli/commands/code-auto-compact-inflight-deferral.test.ts
//
// The END-TO-END effect of the ledger-backed deferral, through the REAL command.
//
// Before this, the production path handed the probe an empty graph list, so
// `inFlightBatch` was always false and the deferral could never fire. These
// tests drive `peaks code auto-compact` itself, with a session whose dispatch
// ledger says a dispatch is in flight, and with one whose ledger says it is
// not — and they read the command's own output to see which happened.
//
// Dimensions covered:
//   - behavior:    the deferral fires on a ledger that says in flight, and does
//                  not fire on one that says not in flight
//   - integration: the real CLI action, a real session dir, a real ledger
//   - render:      the command's own JSON envelope
//   - a11y:        the deferral is stated in the command's own message
//
// EVERY ARM PINS ITS OWN ENVIRONMENT. `PEAKS_TEST_SEAM` decides whether the
// command wires the LEDGER-backed probe at all, so an arm that needs the
// production path must CLEAR it and an arm that needs the seam must SET it —
// otherwise the arm reads whatever the ambient environment happens to hold.
// This host exports `PEAKS_TEST_SEAM` in some contexts and CI does not, so an
// inherited value makes the same test green in one place and red in another.

import { describe, expect, it } from 'vitest';
import { Command } from 'commander';

import { makeCapturedIo, withEnv } from '../../_setup/io.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';
import { declareDimensions } from '../../_setup/4dim-template.js';
import { registerCodeRuntimeCommands } from '../../../../src/cli/commands/code-runtime-commands.js';
import { writeInitialDispatchRecord } from '../../../../src/services/dispatch/dispatch-record-writer.js';
import type { SubAgentToolCall } from '../../../../src/services/dispatch/sub-agent-dispatcher.js';

declareDimensions('tests/unit/cli/commands/code-auto-compact-inflight-deferral.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

const RATIO_ENV = 'CLAUDE_CONTEXT_USAGE_PERCENT';
const SESSION_ID = '2026-10-22-session-b0e6e2';
const MINUTE_MS = 60_000;
const TOOL_CALL: SubAgentToolCall = { name: 'Task', args: {} };

interface AutoCompactEnvelope {
  readonly ok: boolean;
  readonly command: string;
  readonly data: {
    readonly sessionId: string;
    readonly ratio: number;
    readonly decision: string;
  };
  readonly nextActions: readonly string[];
}

describe('peaks code auto-compact — the deferral reads the dispatch ledger', () => {
  const ws = withTmpWorkspacePerTest('peaks-auto-compact-ledger-');

  /** Register one dispatch in the session's ledger, stamped `ageMinutes` old. */
  function writeLedgerDispatch(ageMinutes: number): void {
    writeInitialDispatchRecord({
      projectRoot: ws().path,
      sessionId: SESSION_ID,
      requestId: 'rid-inflight',
      role: 'rd',
      prompt: 'do the thing',
      toolCall: TOOL_CALL,
      batchId: 'batch-11111111-2222-3333-4444-555555555555',
      now: () => new Date(Date.now() - ageMinutes * MINUTE_MS)
    });
  }

  /** Run the REAL command and capture what it printed. */
  async function runAutoCompact(extraArgs: readonly string[] = []): Promise<AutoCompactEnvelope> {
    const { io, captured } = makeCapturedIo();
    const program = new Command();
    const code = program.command('code');
    registerCodeRuntimeCommands(code, io);
    await program.parseAsync(
      [
        'code',
        'auto-compact',
        '--project',
        ws().path,
        '--session-id',
        SESSION_ID,
        '--json',
        ...extraArgs
      ],
      { from: 'user' }
    );
    return JSON.parse(captured.text()) as AutoCompactEnvelope;
  }

  it('when the ledger says a dispatch is in flight, should defer the compaction', async () => {
    // given: a session whose ledger holds a dispatch issued a minute ago
    // when:  the real command runs
    // then:  the compaction is deferred, and the command says so
    writeLedgerDispatch(1);
    withEnv('PEAKS_TEST_SEAM', undefined);
    withEnv(RATIO_ENV, '0.82');
    withEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    const envelope = await runAutoCompact();
    expect(envelope.ok).toBe(true);
    expect(envelope.data.decision).toBe('in-flight-batch');
    expect(envelope.nextActions.join('\n')).toContain('In-flight batch detected');
  });

  it('when the ledger says no dispatch is in flight, should compact', async () => {
    // given: a session whose ledger holds a dispatch issued 31 minutes ago —
    //        outside the freshness window, so nothing is in flight
    // when:  the real command runs
    // then:  the deferral does not apply and the compaction proceeds
    writeLedgerDispatch(31);
    withEnv('PEAKS_TEST_SEAM', undefined);
    withEnv(RATIO_ENV, '0.82');
    withEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    const envelope = await runAutoCompact();
    expect(envelope.data.decision).not.toBe('in-flight-batch');
    expect(envelope.data.ratio).toBeGreaterThan(0.8);
  });

  it('when the session has no ledger at all, should compact', async () => {
    // given: a session that never registered a dispatch
    // when:  the real command runs
    // then:  there is nothing to defer for
    withEnv('PEAKS_TEST_SEAM', undefined);
    withEnv(RATIO_ENV, '0.82');
    withEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    const envelope = await runAutoCompact();
    expect(envelope.data.decision).not.toBe('in-flight-batch');
  });

  it('when the test seam is on, should the --in-flight-batch flag still force the deferral', async () => {
    // given: the TEST-ONLY seam, and a session with no ledger at all
    // when:  the real command runs with the legacy flag
    // then:  the seam still forces the deferral
    withEnv('PEAKS_TEST_SEAM', '1');
    withEnv(RATIO_ENV, '0.82');
    withEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    const envelope = await runAutoCompact(['--in-flight-batch']);
    expect(envelope.data.decision).toBe('in-flight-batch');
  });

  it('when the test seam is off, should the --in-flight-batch flag not reach the decision', async () => {
    // given: a PRODUCTION run (no seam) and a session with no ledger
    // when:  the real command runs with the legacy flag
    // then:  the production path is unreachable from a CLI boolean
    withEnv('PEAKS_TEST_SEAM', undefined);
    withEnv(RATIO_ENV, '0.82');
    withEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    const envelope = await runAutoCompact(['--in-flight-batch']);
    expect(envelope.data.decision).not.toBe('in-flight-batch');
  });
});
