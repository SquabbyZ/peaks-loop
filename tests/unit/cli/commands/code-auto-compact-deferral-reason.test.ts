// tests/unit/cli/commands/code-auto-compact-deferral-reason.test.ts
//
// WHICH DEFERRAL WAS IT? The ledger-backed deferral fires in production for the
// first time in this slice, and it fires on two very different situations: a
// dispatch really is in flight (normal, expected), and the ledger could not be
// read or a record's status was not recognised (a problem nobody can see).
// Both reach the operator as the same decision — defer — and both used to reach
// the operator as the same SENTENCE, so "In-flight batch detected" could mean
// "this is normal" and "the ledger is unreadable" at once.
//
// These arms drive the REAL command over a REAL session ledger: one arm with a
// dispatch in flight, one with an index that cannot be parsed. They assert on
// the DIFFERENCE between the two envelopes — the reported reason and the codes
// — and on the decision, which must not move.
//
// Dimensions covered:
//   - behavior:    the reason the deferral reports, and the codes it carries
//   - integration: the real CLI action, a real session dir, a real ledger
//   - render:      the command's own JSON envelope
//   - a11y:        the deferral is stated in the command's own message

import { describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeCapturedIo, withEnv } from '../../_setup/io.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';
import { declareDimensions } from '../../_setup/4dim-template.js';
import { registerCodeRuntimeCommands } from '../../../../src/cli/commands/code-runtime-commands.js';
import { writeInitialDispatchRecord } from '../../../../src/services/dispatch/dispatch-record-writer.js';
import type { SubAgentToolCall } from '../../../../src/services/dispatch/sub-agent-dispatcher.js';

declareDimensions('tests/unit/cli/commands/code-auto-compact-deferral-reason.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

const RATIO_ENV = 'CLAUDE_CONTEXT_USAGE_PERCENT';
const SESSION_ID = '2026-10-23-session-deferral';
const MINUTE_MS = 60_000;
const TOOL_CALL: SubAgentToolCall = { name: 'Task', args: {} };

interface DeferralCodes {
  readonly code: string;
  readonly message: string;
}

interface AutoCompactEnvelope {
  readonly ok: boolean;
  readonly data: {
    readonly decision: string;
    readonly deferral?: {
      readonly reason: string;
      readonly unknown: boolean;
      readonly warnings: readonly DeferralCodes[];
      readonly errors: readonly DeferralCodes[];
    };
  };
  readonly warnings: readonly string[];
  readonly nextActions: readonly string[];
}

describe('peaks code auto-compact — the deferral says WHICH deferral it was', () => {
  const ws = withTmpWorkspacePerTest('peaks-auto-compact-deferral-reason-');

  /** Register one dispatch in the session's ledger, stamped `ageMinutes` old. */
  function writeLedgerDispatch(ageMinutes: number): void {
    writeInitialDispatchRecord({
      projectRoot: ws().path,
      sessionId: SESSION_ID,
      requestId: 'rid-deferral-reason',
      role: 'rd',
      prompt: 'do the thing',
      toolCall: TOOL_CALL,
      batchId: 'batch-11111111-2222-3333-4444-555555555555',
      now: () => new Date(Date.now() - ageMinutes * MINUTE_MS)
    });
  }

  /** Write an index the reader cannot parse — the ledger's state is unknown. */
  function writeUnreadableLedger(): void {
    const dir = join(ws().path, '.peaks', '_sub_agents', SESSION_ID);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'active-dispatches.json'), '{ this is not json', 'utf8');
  }

  /** Run the REAL command and capture the envelope it printed. */
  async function runAutoCompact(): Promise<AutoCompactEnvelope> {
    const { io, captured } = makeCapturedIo();
    const program = new Command();
    const code = program.command('code');
    registerCodeRuntimeCommands(code, io);
    await program.parseAsync(
      ['code', 'auto-compact', '--project', ws().path, '--session-id', SESSION_ID, '--json'],
      { from: 'user' }
    );
    return JSON.parse(captured.text()) as AutoCompactEnvelope;
  }

  it('when the ledger holds a dispatch in flight, should report a running batch', async () => {
    // given: a session whose ledger holds a dispatch issued a minute ago
    writeLedgerDispatch(1);
    withEnv(RATIO_ENV, '0.82');
    withEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    // when:  the real command runs
    const envelope = await runAutoCompact();
    // then:  the deferral names the running batch, not a ledger problem
    expect(envelope.data.deferral?.reason).toBe('fresh-dispatch');
    expect(envelope.data.deferral?.unknown).toBe(false);
    expect(envelope.nextActions.join('\n')).toContain('a dispatch IS in flight');
  });

  it('when the ledger cannot be read, should report an unknown ledger state', async () => {
    // given: a session whose dispatch index cannot be parsed
    writeUnreadableLedger();
    withEnv(RATIO_ENV, '0.82');
    withEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    // when:  the real command runs
    const envelope = await runAutoCompact();
    // then:  the deferral names the unknown state, and carries the code
    expect(envelope.data.deferral?.reason).toBe('unknown-ledger-state');
    expect(envelope.data.deferral?.unknown).toBe(true);
    expect(envelope.data.deferral?.errors.map((code) => code.code)).toContain(
      'PEAKS_DISPATCH_LEDGER_UNREADABLE'
    );
    expect(envelope.nextActions.join('\n')).toContain('the dispatch ledger state is UNKNOWN');
  });

  it('when the ledger cannot be read, should still defer the compaction', async () => {
    // given: a session whose dispatch index cannot be parsed
    writeUnreadableLedger();
    withEnv(RATIO_ENV, '0.82');
    withEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    // when:  the real command runs
    const envelope = await runAutoCompact();
    // then:  the DECISION is unchanged — the unknown still defers
    expect(envelope.data.decision).toBe('in-flight-batch');
    expect(envelope.ok).toBe(true);
  });

  it('when the ledger holds a dispatch in flight, should still defer the compaction', async () => {
    // given: a session whose ledger holds a dispatch issued a minute ago
    writeLedgerDispatch(1);
    withEnv(RATIO_ENV, '0.82');
    withEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    // when:  the real command runs
    const envelope = await runAutoCompact();
    // then:  the DECISION is unchanged — a live batch still defers
    expect(envelope.data.decision).toBe('in-flight-batch');
    expect(envelope.ok).toBe(true);
  });

  it('when the two deferrals are compared, should report different reasons', async () => {
    // given: one session whose ledger first holds a live dispatch
    writeLedgerDispatch(1);
    withEnv(RATIO_ENV, '0.82');
    withEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    const running = await runAutoCompact();
    // and: the same session's index is then made unreadable
    writeUnreadableLedger();
    const unreadable = await runAutoCompact();
    // when:  the two envelopes are compared
    const runningText = running.nextActions.join('\n');
    const unreadableText = unreadable.nextActions.join('\n');
    // then:  the reasons DIFFER — the shared part is the decision, not the report
    expect(running.data.deferral?.reason).not.toBe(unreadable.data.deferral?.reason);
    expect(runningText).not.toBe(unreadableText);
    expect(runningText).toContain('a dispatch IS in flight');
    expect(runningText).not.toContain('the dispatch ledger state is UNKNOWN');
    expect(unreadableText).toContain('the dispatch ledger state is UNKNOWN');
    expect(unreadableText).not.toContain('a dispatch IS in flight');
  });
});
