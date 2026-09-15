import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { GuardContext, GuardRunResult } from '../types.js';
import { combineProbes, fail, missingSourceFiles, pass, probe, requireBaselineRow } from './_shared.js';

const STATES: ReadonlyArray<string> = ['spec-locked', 'implemented', 'qa-handoff', 'handed-off'];

export async function runJ02Contract(ctx: GuardContext): Promise<GuardRunResult> {
  const row = requireBaselineRow(ctx);
  const missing = missingSourceFiles(ctx, row);
  // Must be ABSOLUTE: the child runs with `cwd: tmp`, so a relative
  // `bin/peaks.js` would be resolved against the temp workspace.
  const bin = resolve(ctx.projectRoot, 'bin', 'peaks.js');
  const tmp = mkdtempSync(join(tmpdir(), 'cbl-J02-'));
  try {
  const ws = execFileSync('node', [bin, 'workspace', 'init', '--project', tmp, '--json'], { cwd: tmp, windowsHide: true }).toString('utf8');
  const { data: { sessionId } } = JSON.parse(ws) as { data: { sessionId: string } };
  const rid = '2026-08-03-j02-fixture';
  const initOut = execFileSync('node', [bin, 'request', 'init', '--role', 'rd', '--id', rid, '--project', tmp, '--session-id', sessionId, '--apply', '--json'], { cwd: tmp, windowsHide: true }).toString('utf8');
  const initEnv = JSON.parse(initOut) as { data: { path: string } };
  // `request init` writes the file as `NNN-<id-slug>.md`. The transition CLI accepts
  // the file's basename (without .md) as the requestId. Derive it from data.path.
  const baseName = initEnv.data.path.split(/[\\/]/).pop() ?? '';
  const requestId = baseName.replace(/\.md$/i, '');

  const transition = (state: string, extra: ReadonlyArray<string>): string =>
    execFileSync('node', [bin, 'request', 'transition', requestId, '--role', 'rd', '--state', state,
      '--project', tmp, '--session-id', sessionId, '--confirm',
      '--reason', 'J02 contract fixture', ...extra, '--json'], { cwd: tmp, windowsHide: true }).toString('utf8');

  // Hard-gate probe, run FIRST: from the freshly initialised state, jumping
  // straight to the terminal state skips every intermediate gate and must not
  // be accepted without the explicit incomplete-work escape hatch. Doing this
  // before the legal walk is what makes it a skip (from `qa-handoff` the move
  // to `handed-off` is legal and proves nothing).
  let gateSkipRefused = false;
  let skipError = 'not attempted';
  try {
    transition('handed-off', []);
    skipError = 'transition was accepted';
  } catch (e) {
    gateSkipRefused = true;
    skipError = (e as Error).message.slice(0, 160);
  }

  let last = '';
  try {
    for (const s of STATES) {
      const env = JSON.parse(transition(s, ['--allow-incomplete'])) as { data: { state: string } };
      last = env.data.state;
    }
  } catch (e) {
    last = `error: ${(e as Error).message.slice(0, 160)}`;
  }

  const result = combineProbes([
    probe(missing.length === 0, `baseline sourceFiles present (${row.sourceFiles.length})`),
    probe(gateSkipRefused, `an incomplete jump to handed-off is refused (${skipError})`),
    probe(last === 'handed-off', `the RD state machine reaches handed-off (saw ${last})`)
  ]);

  const artifact = row.sourceFiles[3] ?? 'tests/integration/job-e2e.test.ts';
  if (result.ok) return pass(ctx, artifact);
  return fail(
    ctx,
    artifact,
    'every hard gate is enforced and the RD state machine still reaches handed-off',
    result.detail,
    'J02 invariant broken: the RD state machine or its hard-gate enforcement changed'
  );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
