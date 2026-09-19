import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { GuardContext, GuardRunResult } from '../types.js';
import {
  combineProbes,
  fail,
  missingSourceFiles,
  pass,
  probe,
  requireBaselineRow
} from './_shared.js';

const STATES: ReadonlyArray<string> = ['spec-locked', 'implemented', 'qa-handoff', 'handed-off'];

// Per-child timeout. J02 runs six peaks CLIs in a fresh cwd; on cold CI
// runners the first invocation pays tsx startup before the resolved file is
// hot, and any single child that hangs would block the whole guard run until
// the default node timeout (forever). 60s is comfortable on warm hosts and
// tight enough that a genuine hang surfaces in the gate step within the
// publish workflow's per-step budget.
const CHILD_TIMEOUT_MS = 60_000;

export async function runJ02Contract(ctx: GuardContext): Promise<GuardRunResult> {
  const row = requireBaselineRow(ctx);
  const missing = missingSourceFiles(ctx, row);
  // Must be ABSOLUTE: the child runs with `cwd: tmp`, so a relative
  // `bin/peaks.js` would be resolved against the temp workspace.
  const bin = resolve(ctx.projectRoot, 'bin', 'peaks.js');
  const tmp = mkdtempSync(join(tmpdir(), 'cbl-J02-'));
  // Each peaks-CLI invocation in this contract is wrapped so a child that
  // hangs (or a child that produces no stdout) cannot silently pin the gate
  // step until CI's job-level timeout fires. `execFileSync` already throws on
  // non-zero exit; we additionally enforce timeout and surface the actual
  // stderr in the error so a future failure can be diagnosed without re-running
  // with a debugger.
  const run = (args: ReadonlyArray<string>): { stdout: string; stderr: string } => {
    try {
      const stdout = execFileSync('node', [bin, ...args], {
        cwd: tmp,
        windowsHide: true,
        timeout: CHILD_TIMEOUT_MS,
        encoding: 'utf8',
        // The contract spawns peaks CLIs in a temp workspace; on a CI runner
        // there is no IDE context, so peaks would refuse every `request.*`
        // command with CALLER_ID_INVALID. Provide a deterministic caller id
        // tied to the contract name. The contract is the only producer of
        // this artifact, so the synthetic id cannot collide with anything
        // real a developer is working on.
        env: { ...process.env, PEAKS_CALLER_ID: `guard-J02-${ctx.sessionId}` }
      });
      return { stdout, stderr: '' };
    } catch (e) {
      const err = e as Error & { stdout?: Buffer | string; stderr?: Buffer | string };
      const stderr =
        typeof err.stderr === 'string'
          ? err.stderr
          : Buffer.isBuffer(err.stderr)
            ? err.stderr.toString('utf8')
            : '';
      const stdout =
        typeof err.stdout === 'string'
          ? err.stdout
          : Buffer.isBuffer(err.stdout)
            ? err.stdout.toString('utf8')
            : '';
      // Preserve the original error type/message but attach stderr so the
      // outer try-catch's `e.message.slice(0, 160)` sees something useful.
      // Truncate stdout aggressively to keep the audit envelope bounded, but
      // pick the HEAD and TAIL of the buffer so the leading envelope header
      // and the trailing error are both visible.
      const stdoutHead = stdout.slice(0, 600);
      const stdoutTail = stdout.length > 1200 ? stdout.slice(-400) : '';
      const stdoutPart = stdoutTail
        ? `${stdoutHead}...<truncated ${stdout.length - 1000}B>...${stdoutTail}`
        : stdoutHead;
      const wrapped = new Error(
        `${err.message} | stderr=${stderr.slice(0, 400)} | stdout=${stdoutPart}`
      ) as Error & { stdout: string };
      wrapped.stdout = stdout;
      throw wrapped;
    }
  };
  try {
    const ws = run(['workspace', 'init', '--project', tmp, '--json']);
    const {
      data: { sessionId }
    } = JSON.parse(ws.stdout) as { data: { sessionId: string } };
    const rid = '2026-08-03-j02-fixture';
    const initOut = run([
      'request',
      'init',
      '--role',
      'rd',
      '--id',
      rid,
      '--project',
      tmp,
      '--session-id',
      sessionId,
      '--apply',
      '--json'
    ]);
    const initEnv = JSON.parse(initOut.stdout) as { data: { path: string } };
    // `request init` writes the file as `NNN-<id-slug>.md`. The transition CLI accepts
    // the file's basename (without .md) as the requestId. Derive it from data.path.
    const baseName = initEnv.data.path.split(/[\\/]/).pop() ?? '';
    const requestId = baseName.replace(/\.md$/i, '');

    const transition = (state: string, extra: ReadonlyArray<string>): string =>
      run([
        'request',
        'transition',
        requestId,
        '--role',
        'rd',
        '--state',
        state,
        '--project',
        tmp,
        '--session-id',
        sessionId,
        '--confirm',
        '--reason',
        'J02 contract fixture',
        ...extra,
        '--json'
      ]).stdout;

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
        const env = JSON.parse(transition(s, ['--allow-incomplete'])) as {
          data: { state: string };
        };
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
