/**
 * `peaks code plan` — build and print a CodePlan without executing it.
 *
 * Extracted VERBATIM from `code-mode-gate-commands.ts` (job
 * strict-remediation-abc, slice c1-eslint-family-sweep, leaf c4w1-cli-b) so
 * the registration file clears the 300-line cap. The description, the
 * `<session-id>` argument, the `--fast` / `--json` options, the stdout
 * formatting (`SKIP`/`RUN ` + `repair=on|off` for `qa-cycle`), and the
 * JSON-envelope shape `{ ok: true, data: plan }` are the code that was already
 * there. Nothing here swallows anything and no new error handling was
 * introduced.
 */
import type { Command } from 'commander';

import { buildCodePlan } from './code-commands.js';

type PlanOptions = { fast?: boolean; json?: boolean };

export function registerCodeModePlan(code: Command): void {
  code
    .command('plan')
    .description('Build and print a CodePlan without executing it')
    .argument('<session-id>', 'session id to plan against')
    .option(
      '--fast',
      'fast mode: skip memory full-load, standards preflight, and QA repair loop',
      false
    )
    .option('--json', 'emit JSON envelope')
    .action((sessionId: string, opts: PlanOptions) => {
      const plan = buildCodePlan({ sessionId, fast: opts.fast === true });
      if (opts.json === true) {
        process.stdout.write(JSON.stringify({ ok: true, data: plan }) + '\n');
      } else {
        process.stdout.write(`session-id: ${plan.sessionId}\n`);
        for (const step of plan.steps) {
          const flag = step.skipped ? 'SKIP' : 'RUN ';
          const repair =
            step.id === 'qa-cycle' ? ` repair=${step.repairLoop === true ? 'on' : 'off'}` : '';
          process.stdout.write(`  [${flag}] ${step.id}${repair}\n`);
        }
      }
    });
}
