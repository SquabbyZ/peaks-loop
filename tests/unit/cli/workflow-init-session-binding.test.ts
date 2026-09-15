// tests/unit/cli/workflow-init-session-binding.test.ts
//
// S6 (2026-09-15) — `peaks workflow init` did not resolve the session binding.
//
// THE DEFECT (diagnosis 3.25, reproduced live): `deriveSessionId` had two tiers
// — `--session-id`, then `PEAKS_SESSION_ID` — and no third. With neither
// present it returned the literal `unknown-sid` REGARDLESS of what the binding
// file said, so the graph landed in `.peaks/_runtime/unknown-sid/graphs/` and
// `peaks workflow node prepare`, running under the correct session dir, then
// failed with `PEAKS_GRAPH_NOT_FOUND` — it was asking the right bucket for a
// graph that had been written one bucket over. In the same project, on the same
// binding file, `peaks session info --active` and `peaks session checkpoint`
// resolved correctly; the `unknown-sid` bucket held artifacts from at least 4
// distinct caller ids between 2026-09-01 and 2026-09-15.
//
// These tests drive the REGISTERED COMMAND through commander, not the helper
// directly, so they exercise the same `deriveSessionId` the CLI does.
//
// Dimensions covered:
//   - behavior:    the graph lands in the bound session's tree; an unbound
//                  project fails loudly instead of writing to `unknown-sid`
//   - integration: real commander command + real fs binding + real graph write
//   - render:      the JSON envelope's `code` on the failure path
//   - a11y:        OMITTED — no human-facing text surface beyond the envelope

import { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo, withEnv } from '../_setup/io.js';
import { withTmpWorkspacePerTest } from '../_setup/tmp-workspace.js';
import { registerWorkflowLifecycleCommand } from '../../../src/cli/commands/workflow-lifecycle-commands.js';

declareDimensions(
  'tests/unit/cli/workflow-init-session-binding.test.ts',
  ['behavior', 'integration', 'render'],
  [
    { dim: 'a11y', reason: 'the CLI envelope is data; no human-facing rendering in this path' },
  ],
);

const BOUND_SESSION = '2026-09-15-session-784bf0';
const getWs = withTmpWorkspacePerTest('peaks-wfinit-');

/** Write the project-global binding the way `peaks workspace init` does. */
function writeProjectBinding(projectRoot: string, sessionId: string): void {
  const runtimeDir = join(projectRoot, '.peaks', '_runtime');
  mkdirSync(join(runtimeDir, sessionId), { recursive: true });
  writeFileSync(
    join(runtimeDir, 'session.json'),
    JSON.stringify({ sessionId, createdAt: '2026-09-15T00:00:00.000Z', projectRoot }, null, 2),
    'utf8'
  );
}

async function runWorkflowInit(argv: readonly string[]): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  registerWorkflowLifecycleCommand(program, io);
  const previousExitCode = process.exitCode;
  process.exitCode = 0;
  try {
    await program.parseAsync(['workflow', 'init', ...argv], { from: 'user' });
    return {
      stdout: captured.text(),
      stderr: captured.stderrText(),
      exitCode: typeof process.exitCode === 'number' ? process.exitCode : 0
    };
  } finally {
    process.exitCode = previousExitCode;
  }
}

describe('Scenario: behavior — `workflow init` resolves the session binding', () => {
  it('writes the graph into the BOUND session tree, not the unknown-sid bucket', async () => {
    const ws = getWs();
    writeProjectBinding(ws.path, BOUND_SESSION);
    withEnv('PEAKS_CALLER_ID', 'ci-runner');
    withEnv('PEAKS_SESSION_ID', undefined);

    const result = await runWorkflowInit(['--skill', 'peaks-code', '--project', ws.path, '--json']);

    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(result.stdout) as { ok: boolean; data: { graphRef: string } };
    expect(envelope.ok).toBe(true);
    // `graphRef` is session-relative by design, so it is the on-disk
    // assertions below — not this string — that pin which session tree the
    // graph went into.
    expect(envelope.data.graphRef).toMatch(/^graphs\/wf-[a-z0-9]+\.json$/);

    // The load-bearing assertion: the graph is on disk under the bound session.
    expect(existsSync(join(ws.path, '.peaks', '_runtime', BOUND_SESSION, 'graphs'))).toBe(true);
    // …and the bucket named after the failure was never created.
    expect(existsSync(join(ws.path, '.peaks', '_runtime', 'unknown-sid'))).toBe(false);
  });

  it('an explicit --session-id still wins over the binding', async () => {
    const ws = getWs();
    writeProjectBinding(ws.path, BOUND_SESSION);
    withEnv('PEAKS_CALLER_ID', 'ci-runner');
    withEnv('PEAKS_SESSION_ID', undefined);

    const result = await runWorkflowInit([
      '--skill',
      'peaks-code',
      '--project',
      ws.path,
      '--session-id',
      '2026-09-15-session-explicit',
      '--json'
    ]);

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(ws.path, '.peaks', '_runtime', '2026-09-15-session-explicit', 'graphs'))).toBe(true);
    expect(existsSync(join(ws.path, '.peaks', '_runtime', BOUND_SESSION, 'graphs'))).toBe(false);
  });

  it('PEAKS_SESSION_ID still wins over the binding (scripted / sub-process callers)', async () => {
    const ws = getWs();
    writeProjectBinding(ws.path, BOUND_SESSION);
    withEnv('PEAKS_CALLER_ID', 'ci-runner');
    withEnv('PEAKS_SESSION_ID', '2026-09-15-session-from-env');

    const result = await runWorkflowInit(['--skill', 'peaks-code', '--project', ws.path, '--json']);

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(ws.path, '.peaks', '_runtime', '2026-09-15-session-from-env', 'graphs'))).toBe(true);
    expect(existsSync(join(ws.path, '.peaks', '_runtime', BOUND_SESSION, 'graphs'))).toBe(false);
  });

  it('with NO binding anywhere it fails loudly (PEAKS_SESSION_NOT_BOUND) instead of writing to unknown-sid', async () => {
    const ws = getWs();
    withEnv('PEAKS_CALLER_ID', 'ci-runner');
    withEnv('PEAKS_SESSION_ID', undefined);

    const result = await runWorkflowInit(['--skill', 'peaks-code', '--project', ws.path, '--json']);

    expect(result.exitCode).toBe(1);
    const envelope = JSON.parse(result.stdout) as { ok: boolean; code: string };
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('PEAKS_SESSION_NOT_BOUND');
    // The whole point: a failure is not a bucket.
    expect(existsSync(join(ws.path, '.peaks', '_runtime', 'unknown-sid'))).toBe(false);
  });
});
