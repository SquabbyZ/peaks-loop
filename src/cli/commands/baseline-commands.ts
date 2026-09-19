// src/cli/commands/baseline-commands.ts
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import type { ProgramIO } from '../cli-helpers.js';
import {
  historySnapshot,
  readBaselineFile,
  writeBaselineFile
} from '../../services/capability-baseline/store.js';
import { validateBaselineFile } from '../../services/capability-baseline/validator.js';
import {
  P0_JOURNEY_IDS,
  type CapabilityBaselineFile,
  type JourneyId
} from '../../services/capability-baseline/types.js';
import {
  GUARD_CONTRACTS,
  getGuardContract,
  isJourneyId
} from '../../services/capability-guard-runner/registry.js';
import {
  exitCodeForGuardSummary,
  runAllGuards
} from '../../services/capability-guard-runner/runner.js';
import type { GuardContext, GuardContract } from '../../services/capability-guard-runner/types.js';
import { RUNTIME_SESSIONLESS_SCOPE } from '../../services/workspace/runtime-layout.js';

function fail(
  io: ProgramIO,
  code: string,
  message: string,
  data: Record<string, unknown> = {}
): void {
  io.stdout(
    JSON.stringify({
      ok: false,
      command: `baseline`,
      code,
      message,
      data,
      warnings: [],
      nextActions: []
    })
  );
  process.exitCode = 1;
}

function ok(
  io: ProgramIO,
  command: string,
  data: Record<string, unknown>,
  nextActions: ReadonlyArray<string> = []
): void {
  io.stdout(JSON.stringify({ ok: true, command, data, warnings: [], nextActions }));
}

const CURRENT_DIR = (root: string): string => join(root, 'openspec', 'baselines', 'current');
const HISTORY_DIR = (root: string, version: string): string =>
  join(root, 'openspec', 'baselines', 'history', version);

/** Whitelist of supported `--scorer` values for `peaks baseline audit`. */
const SCORER_MODES = ['live', 'stub'] as const;
type ScorerMode = (typeof SCORER_MODES)[number];
/**
 * `live` is the default because it is the credential-free one. Defaulting to
 * `stub` would leave the publish gate permanently inconclusive; defaulting to a
 * scorer that needs a key would leave it unrunnable in CI.
 */
const DEFAULT_SCORER_MODE: ScorerMode = 'live';

function isScorerMode(v: string | undefined): v is ScorerMode {
  return v !== undefined && (SCORER_MODES as ReadonlyArray<string>).includes(v);
}

/** The guard `run-guard` / `audit` execute against. */
function guardContext(projectRoot: string): GuardContext {
  return { projectRoot, sessionId: 'cli', contract: {} as never, baselineInvariant: 'auto' };
}

export function registerBaselineCommands(program: Command, io: ProgramIO): void {
  const baseline = program
    .command('baseline')
    .description('Manage the capability baseline (frozen product semantics for 15 P0 journeys).');

  baseline
    .command('freeze')
    .description('Freeze the capability baseline from a JSON file (SquabbyZ-signed).')
    .option('--from <path>', 'Path to the baseline JSON input.')
    .option('--project <path>', 'Project root', '.')
    .option('--json', 'Emit JSON envelope')
    .action((opts: { from?: string; project?: string }) => {
      const projectRoot = opts.project ?? '.';
      if (!opts.from) {
        fail(io, 'MISSING_ARG', '--from is required');
        return;
      }
      const file = JSON.parse(readFileSync(opts.from, 'utf8')) as CapabilityBaselineFile;
      const v = validateBaselineFile(file);
      if (!v.ok) {
        fail(io, v.error.code, v.error.message);
        return;
      }
      const out = writeBaselineFile({ projectRoot, file });
      historySnapshot({ projectRoot, version: file.version });
      ok(io, 'baseline.freeze', { path: out.path, lockPath: out.lockPath, version: file.version });
    });

  baseline
    .command('list')
    .description('List the 15 P0 journey rows in the frozen baseline.')
    .option('--project <path>', 'Project root', '.')
    .option('--json', 'Emit JSON envelope')
    .action((opts: { project?: string }) => {
      const projectRoot = opts.project ?? '.';
      const r = readBaselineFile(projectRoot);
      if (!r.ok) {
        fail(io, r.error.code, r.error.message);
        return;
      }
      const rows = r.file.rows.map((row) => ({
        journeyId: row.journeyId,
        intent: row.intent,
        invariantCount: row.invariants.length
      }));
      ok(io, 'baseline.list', { version: r.file.version, signedAt: r.file.signedAt, rows });
    });

  baseline
    .command('show <journeyId>')
    .description('Show one journey row.')
    .option('--project <path>', 'Project root', '.')
    .option('--json', 'Emit JSON envelope')
    .action((journeyId: string, opts: { project?: string }) => {
      const projectRoot = opts.project ?? '.';
      const r = readBaselineFile(projectRoot);
      if (!r.ok) {
        fail(io, r.error.code, r.error.message);
        return;
      }
      const row = r.file.rows.find((x) => x.journeyId === (journeyId as JourneyId));
      if (!row) {
        fail(io, 'BASELINE_ROW_SHAPE_INVALID', `row ${journeyId} not found`);
        return;
      }
      ok(io, 'baseline.show', row as unknown as Record<string, unknown>);
    });

  baseline
    .command('run-guard')
    .description(
      'Run the guard contracts over the frozen baseline. Runs all 15 journeys unless --journey is given.'
    )
    .option(
      '--journey <id>',
      `Run only one journey (${P0_JOURNEY_IDS.join('|')}); default is all 15.`
    )
    .option('--project <path>', 'Project root', '.')
    .option('--json', 'Emit JSON envelope')
    .action(async (opts: { journey?: string; project?: string }) => {
      const projectRoot = opts.project ?? '.';
      let contracts: ReadonlyArray<GuardContract>;
      if (opts.journey === undefined) {
        contracts = GUARD_CONTRACTS;
      } else if (!isJourneyId(opts.journey)) {
        fail(
          io,
          'UNKNOWN_JOURNEY',
          `unknown journey "${opts.journey}"; expected one of ${P0_JOURNEY_IDS.join(', ')}`
        );
        return;
      } else {
        const contract = getGuardContract(opts.journey);
        if (contract === undefined) {
          fail(io, 'UNKNOWN_JOURNEY', `no guard contract is registered for ${opts.journey}`);
          return;
        }
        contracts = [contract];
      }

      const summary = await runAllGuards(contracts, guardContext(projectRoot));
      const data = summary as unknown as Record<string, unknown>;
      const exitCode = exitCodeForGuardSummary(summary);
      if (exitCode === 0) {
        ok(io, 'baseline.run-guard', data);
        return;
      }
      fail(
        io,
        exitCode === 1 ? 'GUARD_FAILED' : 'GUARD_SKIPPED',
        `${String(summary.fail)} failed, ${String(summary.skipped)} skipped of ${String(summary.total)} guard contracts`,
        data
      );
      // `fail` sets 1; a skipped run is a distinct outcome from a failed one.
      process.exitCode = exitCode;
    });

  baseline
    .command('diff')
    .description('Show current implementation vs. frozen baseline.')
    .option('--project <path>', 'Project root', '.')
    .option('--json', 'Emit JSON envelope')
    .action((opts: { project?: string }) => {
      const projectRoot = opts.project ?? '.';
      const r = readBaselineFile(projectRoot);
      if (!r.ok) {
        fail(io, r.error.code, r.error.message);
        return;
      }
      ok(io, 'baseline.diff', {
        version: r.file.version,
        signedAt: r.file.signedAt,
        rowsCount: r.file.rows.length
      });
    });

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
    .action(async (opts: { scorer?: string; project?: string }) => {
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
      const { runAudit } = await import('../../services/capability-audit-service/runner.js');
      // `sessionId` is the on-disk scope for the audit artifacts. This command
      // has NO session — it is the credential-free scorer that runs inside the
      // secretless OIDC publish gate — and it used to pass the literal `'cli'`,
      // so every run wrote `.peaks/_runtime/cli/capability-audit/*.json` into
      // the operator's real workspace. That directory is indistinguishable from
      // a session dir whose id failed validation, so `peaks doctor`'s
      // orphan-session check failed on it permanently (`4 orphan session(s)
      // …: callers, cli, unknown-sid, x`, exit 1). The reserved
      // underscore-prefixed scope says "machinery, not a session" in the name.
      const audit = await runAudit({
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
    });

  baseline
    .command('freeze-update')
    .description(
      "Update one or more baseline rows. The LLM authors the JSON; --confirm records the user's approval."
    )
    .option('--from <path>', 'Path to the new baseline JSON input')
    .option(
      '--confirm',
      "Record the user's approval (collected via AskUserQuestion) for this ratchet change"
    )
    .option('--project <path>', 'Project root', '.')
    .option('--json', 'Emit JSON envelope')
    .action((opts: { from?: string; confirm?: boolean; project?: string }) => {
      const projectRoot = opts.project ?? '.';
      if (opts.confirm !== true) {
        fail(
          io,
          'HUMAN_NL_DECISION_REQUIRED',
          'freeze-update requires the user to approve the ratchet change via AskUserQuestion. The LLM must surface a multi-choice prompt, then re-run with --confirm.'
        );
        return;
      }
      if (!opts.from) {
        fail(io, 'MISSING_ARG', '--from is required');
        return;
      }
      const r = readBaselineFile(projectRoot);
      if (!r.ok) {
        fail(io, r.error.code, r.error.message);
        return;
      }
      const file = JSON.parse(readFileSync(opts.from, 'utf8')) as CapabilityBaselineFile;
      const v = validateBaselineFile(file);
      if (!v.ok) {
        fail(io, v.error.code, v.error.message);
        return;
      }
      const out = writeBaselineFile({ projectRoot, file });
      historySnapshot({ projectRoot, version: file.version });
      ok(io, 'baseline.freeze-update', {
        path: out.path,
        lockPath: out.lockPath,
        fromVersion: r.file.version,
        version: file.version
      });
    });

  baseline
    .command('rollback')
    .description(
      "Roll the baseline back to a historical version. --confirm records the user's approval."
    )
    .option('--to <version>', 'Historical version to roll back to')
    .option(
      '--confirm',
      "Record the user's approval (collected via AskUserQuestion) for this rollback"
    )
    .option('--project <path>', 'Project root', '.')
    .option('--json', 'Emit JSON envelope')
    .action((opts: { to?: string; confirm?: boolean; project?: string }) => {
      const projectRoot = opts.project ?? '.';
      if (opts.confirm !== true) {
        fail(
          io,
          'HUMAN_NL_DECISION_REQUIRED',
          'rollback requires the user to approve via AskUserQuestion. The LLM must surface a multi-choice prompt, then re-run with --confirm.'
        );
        return;
      }
      if (!opts.to) {
        fail(io, 'MISSING_ARG', '--to is required');
        return;
      }
      const source = HISTORY_DIR(projectRoot, opts.to);
      const from = join(source, 'capability-baseline.json');
      const fromLock = join(source, 'capability-baseline.lock');
      if (!existsSync(from) || !existsSync(fromLock)) {
        fail(io, 'BASELINE_HISTORY_GAP', `no frozen baseline recorded for version ${opts.to}`);
        return;
      }
      const r = readBaselineFile(projectRoot);
      if (!r.ok) {
        fail(io, r.error.code, r.error.message);
        return;
      }
      mkdirSync(CURRENT_DIR(projectRoot), { recursive: true });
      copyFileSync(from, join(CURRENT_DIR(projectRoot), 'capability-baseline.json'));
      copyFileSync(fromLock, join(CURRENT_DIR(projectRoot), 'capability-baseline.lock'));
      // Re-read through the locked store so a tampered history entry cannot be
      // installed: the copy is only reported successful if it verifies.
      const after = readBaselineFile(projectRoot);
      if (!after.ok) {
        fail(io, after.error.code, after.error.message);
        return;
      }
      ok(io, 'baseline.rollback', {
        fromVersion: r.file.version,
        toVersion: after.file.version,
        historyPath: source
      });
    });

  baseline
    .command('reset')
    .description(
      "Wipe the current baseline and require a re-freeze. --confirm records the user's approval."
    )
    .option('--confirm', "Record the user's approval (collected via AskUserQuestion) for the wipe")
    .option('--project <path>', 'Project root', '.')
    .option('--json', 'Emit JSON envelope')
    .action((opts: { confirm?: boolean; project?: string }) => {
      const projectRoot = opts.project ?? '.';
      if (opts.confirm !== true) {
        fail(
          io,
          'HUMAN_NL_DECISION_REQUIRED',
          'reset requires the user to approve via AskUserQuestion. The LLM must surface a multi-choice prompt, then re-run with --confirm.'
        );
        return;
      }
      const r = readBaselineFile(projectRoot);
      // A missing baseline is already "wiped" — but an unreadable one (hash
      // mismatch / unsigned lock) must not be silently discarded.
      if (!r.ok && r.error.code !== 'BASELINE_NOT_FOUND') {
        fail(io, r.error.code, r.error.message);
        return;
      }
      const wipedVersion = r.ok ? r.file.version : null;
      rmSync(join(CURRENT_DIR(projectRoot), 'capability-baseline.json'), { force: true });
      rmSync(join(CURRENT_DIR(projectRoot), 'capability-baseline.lock'), { force: true });
      ok(io, 'baseline.reset', {
        wipedVersion,
        nextAction: 're-freeze with `baseline freeze --from <path>`'
      });
    });
}
