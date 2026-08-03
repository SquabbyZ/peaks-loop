import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GuardContext, GuardRunResult } from '../types.js';

const STATES: ReadonlyArray<string> = ['spec-locked', 'implemented', 'qa-handoff', 'handed-off'];

export async function runJ02Contract(ctx: GuardContext, projectRoot: string = ctx.projectRoot): Promise<GuardRunResult> {
  const bin = join(ctx.projectRoot, 'bin', 'peaks.js');
  const tmp = mkdtempSync(join(tmpdir(), 'cbl-J02-'));
  const ws = execFileSync('node', [bin, 'workspace', 'init', '--project', tmp, '--json'], { cwd: tmp }).toString('utf8');
  const { data: { sessionId } } = JSON.parse(ws) as { data: { sessionId: string } };
  const rid = '2026-08-03-j02-fixture';
  const initOut = execFileSync('node', [bin, 'request', 'init', '--role', 'rd', '--id', rid, '--project', tmp, '--session-id', sessionId, '--apply', '--json'], { cwd: tmp }).toString('utf8');
  const initEnv = JSON.parse(initOut) as { data: { path: string } };
  // `request init` writes the file as `NNN-<id-slug>.md`. The transition CLI accepts
  // the file's basename (without .md) as the requestId. Derive it from data.path.
  const baseName = initEnv.data.path.split(/[\\/]/).pop() ?? '';
  const requestId = baseName.replace(/\.md$/i, '');
  let last = '';
  for (const s of STATES) {
    const out = execFileSync('node', [bin, 'request', 'transition', requestId, '--role', 'rd', '--state', s,
      '--project', tmp, '--session-id', sessionId, '--confirm', '--allow-incomplete',
      '--reason', 'J02 contract fixture', '--json'], { cwd: tmp }).toString('utf8');
    const env = JSON.parse(out) as { data: { state: string } };
    last = env.data.state;
  }
  const ok = last === 'handed-off';
  return {
    journeyId: 'J02',
    contract: 'workflow-trace',
    status: ok ? 'pass' : 'fail',
    ...(ok ? {} : { diff: { before: 'handed-off', after: last, reason: 'J02#1 broken: RD state machine no longer reaches handed-off' } }),
    artifactPath: 'tests/integration/business-capability-e2e.test.ts'
  };
}
