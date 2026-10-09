// src/cli/commands/baseline-audit-command.ts
//
// `peaks baseline audit` — the independent-context capability scorer. Split
// out of `baseline-commands.ts`; the scorer vocabulary, the guard summary the
// audit is handed, the sessionless scope and the verdict rule are unchanged.

import type { Command } from 'commander';
import { readBaselineFile } from '../../services/capability-baseline/store.js';
import { GUARD_CONTRACTS } from '../../services/capability-guard-runner/registry.js';
import { runAllGuards } from '../../services/capability-guard-runner/runner.js';
import { RUNTIME_SESSIONLESS_SCOPE } from '../../services/workspace/runtime-layout.js';
import type { ProgramIO } from '../cli-helpers.js';
import {
  DEFAULT_SCORER_MODE,
  fail,
  guardContext,
  isScorerMode,
  ok,
  SCORER_MODES,
  type BaselineOptions
} from './baseline-command-shared.js';

async function runAudit(io: ProgramIO, opts: BaselineOptions & { scorer?: string }): Promise<void> {
  const projectRoot = opts.project ?? '.';
  if (!isScorerMode(opts.scorer)) {
    fail(
      io,
      'UNKNOWN_SCORER',
      `unknown scorer "${String(opts.scorer)}"; expected one of ${SCORER_MODES.join(', ')}`
    );
    return;
  }
  const r = readBaselineFile(projectRoot);
  if (!r.ok) {
    fail(io, r.error.code, r.error.message);
    return;
  }

  // The guard summary is the REAL aggregate of the 15 contracts. It used to
  // be a literal `{pass:15,fail:0,skipped:0,total:15}` that no run produced.
  const guardSummary = await runAllGuards(GUARD_CONTRACTS, guardContext(projectRoot));

  // `live` is the deterministic independent checker: a real
  // separate-context evaluation that needs no credentials, which is why it
  // is the only kind that can run inside the secretless OIDC publish gate.
  // It is handed the frozen rows and the registry, not just the guard
  // summary — a scorer that only sees the guard result is a restatement.
  //
  // `sessionId` is the on-disk scope for the audit artifacts. This command
  // has NO session — it is the credential-free scorer that runs inside the
  // secretless OIDC publish gate — and it used to pass the literal `'cli'`,
  // so every run wrote `.peaks/_runtime/cli/capability-audit/*.json` into
  // the operator's real workspace. That directory is indistinguishable from
  // a session dir whose id failed validation, so `peaks doctor`'s
  // orphan-session check failed on it permanently. The reserved
  // underscore-prefixed scope says "machinery, not a session" in the name.
  const { runAudit: runIndependentAudit } =
    await import('../../services/capability-audit-service/runner.js');
  const audit = await runIndependentAudit({
    projectRoot,
    sessionId: RUNTIME_SESSIONLESS_SCOPE,
    journeyId: 'J01',
    scorerMode: opts.scorer,
    baselineRows: r.file.rows,
    contracts: GUARD_CONTRACTS,
    guardSummary
  });

  const data = audit as unknown as Record<string, unknown>;
  if (audit.verdict === 'consistent' && !audit.degraded) {
    ok(io, 'baseline.audit', data);
    return;
  }
  fail(
    io,
    'AUDIT_NOT_CONSISTENT',
    `capability audit verdict is "${audit.verdict}"${audit.degraded ? ' (degraded: stub scorer)' : ''}`,
    data
  );
}

export function registerBaselineAuditCommand(baseline: Command, io: ProgramIO): void {
  baseline
    .command('audit')
    .description(
      'Run the capability audit (independent-context scorer). Exits non-zero unless the verdict is consistent.'
    )
    .option(
      '--scorer <mode>',
      `Scorer to run: ${SCORER_MODES.join('|')}. 'live' (default) runs the deterministic independent checker, which needs no credentials; 'stub' performs no evaluation and can never be consistent.`,
      DEFAULT_SCORER_MODE
    )
    .option('--project <path>', 'Project root', '.')
    .option('--json', 'Emit JSON envelope')
    .action((opts: { scorer?: string; project?: string }) => runAudit(io, opts));
}
