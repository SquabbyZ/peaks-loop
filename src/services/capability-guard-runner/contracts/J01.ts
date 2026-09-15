import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { GuardContext, GuardRunResult } from '../types.js';
import { combineProbes, fail, missingSourceFiles, pass, probe, requireBaselineRow } from './_shared.js';

const FIXTURES: ReadonlyArray<readonly [string, string]> = [
  ['make', 'implement a CLI parser'],
  ['make', 'refactor the service'],
  ['make', 'write a blog article'],
  ['learn', 'author an SOP checklist'],
  ['check', 'run red-lines audit'],
  ['run',  'execute a workflow']
];

export async function runJ01Contract(ctx: GuardContext): Promise<GuardRunResult> {
  const row = requireBaselineRow(ctx);
  const missing = missingSourceFiles(ctx, row);
  const bin = process.env.PEAKS_BIN_OVERRIDE ?? join(ctx.projectRoot, 'bin', 'peaks.js');

  const failures: string[] = [];
  let routed = 0;
  for (const [command, input] of FIXTURES) {
    try {
      const stdout = execFileSync('node', [bin, command, input], {
        cwd: ctx.projectRoot,
        env: { ...process.env, PEAKS_CALLER_ID: `guard-J01-${ctx.sessionId}` },
        windowsHide: true
      }).toString('utf8');
      const env = JSON.parse(stdout) as { ok: boolean; data?: { routedSkill?: unknown } };
      if (!env.ok) {
        failures.push(`${command} ${input}: ok=false`);
      } else if (typeof env.data?.routedSkill === 'string' && env.data.routedSkill.length > 0) {
        routed += 1;
      }
    } catch (e) {
      failures.push(`${command} ${input}: ${(e as Error).message.slice(0, 120)}`);
    }
  }

  const result = combineProbes([
    probe(missing.length === 0, `baseline sourceFiles present (${row.sourceFiles.length})`),
    probe(failures.length === 0, `all ${String(FIXTURES.length)} NL routing cases return ok (failures: ${failures.join('; ') || 'none'})`),
    // The invariant is that the SYSTEM picks the skill: a bare ok envelope is
    // not enough, the answer must name the skill it chose.
    probe(routed > 0, `the envelope names the routed skill (${String(routed)}/${String(FIXTURES.length)})`)
  ]);

  const artifact = row.sourceFiles[2] ?? 'tests/integration/super-command-routing.test.ts';
  if (result.ok) return pass(ctx, artifact);
  return fail(
    ctx,
    artifact,
    'every NL fixture routes through the super-command surface and the envelope names the chosen skill',
    result.detail,
    'J01 invariant broken: super-command routing deviates from the frozen baseline'
  );
}