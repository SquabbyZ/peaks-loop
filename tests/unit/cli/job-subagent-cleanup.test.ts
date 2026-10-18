// tests/unit/cli/job-subagent-cleanup.test.ts
//
// Backlog §2.29: `peaks job subagent-cleanup` reported `cleaned: true` while
// removing nothing. The pending set lived in an in-memory `Map` that a fresh
// CLI process can never populate, so every invocation took the "this process
// never dispatched anything" branch — for an absent batch too. `--force` was
// declared and never read.
//
// What is pinned here:
//   - a batch present in the ON-DISK ledger is finalized (record `done`, index
//     row removed) and reports `cleaned: true`;
//   - a batch absent from the ledger reports `cleaned: false` and fails;
//   - `--force` cleans rows in a non-`queued` status, which are skipped
//     without it (the same skip `sub-agent finalize --batch` applies).
//
// Run with: pnpm vitest run tests/unit/cli/job-subagent-cleanup.test.ts

import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { parseCliEnvelopeWith } from '../../../src/cli/cli-envelope.js';
import { registerJobCommands } from '../../../src/cli/commands/job-commands.js';
import {
  readActiveDispatchIndex,
  unregisterActiveDispatch
} from '../../../src/services/dispatch/active-dispatch-index.js';
import {
  readRecord,
  writeInitialDispatchRecord
} from '../../../src/services/dispatch/dispatch-record-writer.js';
import type { JobStateStore } from '../../../src/services/job/job-state-store.js';
import { SubAgentJobWrapper } from '../../../src/services/job/subagent-job-wrapper.js';
import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import { cleanupTmpWorkspace, useTmpWorkspace } from '../_setup/tmp-workspace.js';

declareDimensions('tests/unit/cli/job-subagent-cleanup.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const SID = '2026-10-18-session-cleanup';
const JOB = 'cleanup-job';
const BATCH = 'batch-cleanup-fixture';

const cleanupPayload = z.looseObject({
  cleaned: z.boolean(),
  cleanedRecords: z.array(z.string()),
  skipped: z.array(z.looseObject({ recordPath: z.string(), reason: z.string() }))
});

const exitCodeBefore = process.exitCode;

afterEach(() => {
  process.exitCode = exitCodeBefore;
  cleanupTmpWorkspace();
});

interface SeedResult {
  projectRoot: string;
  recordPath: string;
}

/** Bind a job and write one queued dispatch record for BATCH via the product writer. */
async function seed(): Promise<SeedResult> {
  const { path: projectRoot } = useTmpWorkspace('peaks-job-cleanup-');
  await runJob(
    ['init', '--job-id', JOB, '--slice-list', 'rid-cleanup', '--session-id', SID],
    projectRoot
  );
  const { path: recordPath } = writeInitialDispatchRecord({
    projectRoot,
    sessionId: SID,
    requestId: 'rid-cleanup',
    role: 'rd',
    prompt: 'cleanup fixture',
    toolCall: { name: 'Task', args: { description: 'cleanup fixture' } },
    batchId: BATCH
  });
  return { projectRoot, recordPath };
}

async function runJob(args: string[], projectRoot: string) {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  registerJobCommands(program, io);
  await program.parseAsync(['job', ...args, '--project', projectRoot, '--json'], {
    from: 'user'
  });
  return captured;
}

function parseCleanup(captured: ReturnType<typeof makeCapturedIo>['captured']) {
  return parseCliEnvelopeWith(captured.stdout.join(''), cleanupPayload);
}

function ledgerPaths(projectRoot: string): string[] {
  return Object.keys(readActiveDispatchIndex(projectRoot, SID));
}

describe('Scenario: behavior — subagent-cleanup reads the on-disk ledger', () => {
  it('when the batch is queued in the ledger, should finalize it and report cleaned: true', async () => {
    // given: a fresh process with one queued ledger row for BATCH
    const { projectRoot, recordPath } = await seed();
    expect(ledgerPaths(projectRoot)).toEqual([recordPath]);

    // when: cleanup runs in its own CLI invocation
    const captured = await runJob(
      ['subagent-cleanup', '--job-id', JOB, '--batch-id', BATCH, '--session-id', SID],
      projectRoot
    );

    // then: the envelope says cleaned, and the disk agrees
    const envelope = parseCleanup(captured);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.cleaned).toBe(true);
    expect(envelope.data.cleanedRecords).toEqual([recordPath]);
    expect(ledgerPaths(projectRoot)).toEqual([]);
    expect(readRecord(recordPath).status).toBe('done');
  });

  it('when the batch is absent from the ledger, should report cleaned: false and fail', async () => {
    // given: a ledger that holds BATCH, and a batch id it does not hold
    const { projectRoot, recordPath } = await seed();

    // when: cleanup targets the absent batch
    const captured = await runJob(
      ['subagent-cleanup', '--job-id', JOB, '--batch-id', 'batch-not-there', '--session-id', SID],
      projectRoot
    );

    // then: the miss is reported, the command fails, and nothing was removed
    const envelope = parseCleanup(captured);
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('BATCH_NOT_CLEANED');
    expect(envelope.data.cleaned).toBe(false);
    expect(process.exitCode).toBe(1);
    expect(ledgerPaths(projectRoot)).toEqual([recordPath]);
    expect(readRecord(recordPath).status).toBe('queued');
  });

  it('when a matching row is not queued, should skip it without --force and clean it with --force', async () => {
    // given: a ledger row whose status was promoted out of queued
    const { projectRoot, recordPath } = await seed();
    unregisterActiveDispatch({
      projectRoot,
      sessionId: SID,
      recordPath,
      status: 'running'
    });

    // when: cleanup runs without --force
    const withoutForce = await runJob(
      ['subagent-cleanup', '--job-id', JOB, '--batch-id', BATCH, '--session-id', SID],
      projectRoot
    );

    // then: the row is skipped, not cleaned
    expect(parseCleanup(withoutForce).data.cleaned).toBe(false);
    expect(parseCleanup(withoutForce).data.skipped[0]?.reason).toContain('status is running');
    expect(ledgerPaths(projectRoot)).toEqual([recordPath]);

    // when: cleanup runs again with --force
    const forced = await runJob(
      ['subagent-cleanup', '--job-id', JOB, '--batch-id', BATCH, '--session-id', SID, '--force'],
      projectRoot
    );

    // then: the row is cleaned
    expect(parseCleanup(forced).data.cleaned).toBe(true);
    expect(ledgerPaths(projectRoot)).toEqual([]);
    expect(readRecord(recordPath).status).toBe('done');
  });

  it('when cleanup runs in the dispatching process, should clean the in-memory pending set', async () => {
    // given: a wrapper whose own wrap() registered the batch (no ledger context)
    const wrapper = new SubAgentJobWrapper({} as JobStateStore, async () => ({ batchId: BATCH }));
    const { batchId } = await wrapper.wrap({ jobId: JOB, role: 'rd', prompt: 'in-memory' });
    expect(wrapper.canCheckpointDone(JOB, batchId)).toBe(false);

    // when: cleanup is called without projectRoot/sessionId
    const result = await wrapper.cleanup({ jobId: JOB, batchId, force: false });

    // then: the batch is gone from the in-memory set
    expect(result.cleaned).toBe(true);
    expect(wrapper.canCheckpointDone(JOB, batchId)).toBe(true);
  });
});
