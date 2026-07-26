/**
 * rid-007 Family 1 merge: contract-commands + classify-classify-commands.
 *
 * Pre-merge originals (now deleted):
 *   - src/cli/commands/contract-commands.ts     (167 lines)
 *   - src/cli/commands/classify-classify-commands.ts (190 lines)
 *
 * Both exported `register*Commands` functions are preserved **verbatim**
 * (function name, signature, body). The merge is a structural refactor
 * only — no behavior change. `autoRegisterAllCommands` discovers both
 * exports from this single file.
 *
 * Why one file: the RD slice rid-007 user-confirmed one-family merge
 * minimum; Family 1 is the cleanest demonstration because both inputs
 * sit under 200 lines and the merged file lands at ~360 lines — well
 * below the 400-line AC-9 sanity guard and the 800-line scan gate.
 */

// ===========================================================================
// Shared imports (consolidated; both originals pulled names from these
// same modules — `cli-helpers.ts` re-exports `getErrorMessage` from
// `peaks-loop-shared/result`, so the single canonical import is
// functionally identical to either original line.)
// ===========================================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';

import { fail, ok, getErrorMessage } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  writeContract,
  type WriteContractInput
} from '../../services/dispatch/contract-store.js';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';
import { classifyTask } from '../../services/classify/classify-service.js';
import { TASK_LEVELS, type TaskLevel, type ClassifySignals } from '../../services/classify/classify-types.js';
import { loadPreferences } from '../../services/preferences/preferences-service.js';

// ===========================================================================
// Section 1: `peaks contract` CLI commands (was contract-commands.ts).
// ===========================================================================

const INPUT_LIMIT_BYTES = 256 * 1024;

type ContractWriteOptions = {
  project?: string;
  sessionId?: string;
  sliceId?: string;
  exports?: string;
  types?: string;
  signatures?: string;
  broadcastTo?: string;
  completedAt?: string;
  json?: boolean;
};

/** Split a comma-separated flag value into a trimmed string array. */
function splitCsv(value: string | undefined): readonly string[] {
  if (value === undefined) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function registerContractCommands(program: Command, io: ProgramIO): void {
  const contract = program
    .command('contract')
    .description(
      'Slice contract store (skill-first / CLI-auxiliary). These commands ' +
      'are primitives that peaks-code / peaks-rd SKILL.md compose. The LLM-side ' +
      'runner (the IDE-resident sub-agent that finished a slice) calls ' +
      '`peaks contract write` to persist the slice\'s public surface; the ' +
      'orchestrator picks it up on the next dispatch run via listContracts() ' +
      'and splices it into downstream prompts via formatContractInjection().'
    );

  // ─────────────────────────────────────────────────────────────────
  // peaks contract write --project <root> --session-id <sid>
  //   --slice-id <id> --exports <a,b> --types <x,y> --signatures <s1,s2>
  //   [--broadcast-to <b1,b2>] [--completed-at <iso>]
  // ─────────────────────────────────────────────────────────────────
  addJsonOption(
    contract
      .command('write')
      .description(
        '2.7.0 slice-dag-dispatcher MVP: persist a finished slice\'s public ' +
        'surface (exports / types / publicSignatures) to disk at ' +
        '.peaks/_runtime/<sessionId>/dispatch/contracts/<slice-id>.json. ' +
        'The orchestrator picks it up on the next dispatch run. Idempotent: ' +
        're-running with the same inputs overwrites in place; the SHA-256 ' +
        'contractHash is content-derived so a contract write from a different ' +
        'runner (re-execution) is detected as a content change.'
      )
      .option('--project <path>', 'target project root (defaults to cwd)')
      .option('--session-id <sid>', 'session id (default: resolve from .peaks/_runtime/session.json; falls back to PEAKS_SESSION_ID env var; final fallback "unknown-sid")')
      .requiredOption('--slice-id <id>', 'slice id; must be non-empty; used as the contract filename basename')
      .option('--exports <list>', 'comma-separated public export names (e.g. "validateDag,topologicalLevels")')
      .option('--types <list>', 'comma-separated public type names (e.g. "SliceDag,SliceNode")')
      .option('--signatures <list>', 'comma-separated public function/method signatures (e.g. "validateDag(dag: SliceDag): void")')
      .option('--broadcast-to <list>', 'comma-separated downstream slice ids that should auto-inherit this contract (e.g. "B,C")')
      .option('--completed-at <iso>', 'ISO 8601 timestamp; defaults to now()')
  ).action((options: ContractWriteOptions) => {
    const asJson = options.json === true;
    const projectRoot = options.project ?? process.cwd();
    // Slice 2026-06-26-unknown-sid-fallback-fix: see dispatch-commands.ts.
    const sid = options.sessionId
      ?? process.env.PEAKS_SESSION_ID
      ?? getCurrentSessionId(projectRoot)
      ?? 'unknown-sid';
    const sliceId = options.sliceId;

    if (sliceId === undefined || sliceId.length === 0) {
      printResult(io, fail('contract.write', 'MISSING_SLICE_ID', '--slice-id is required', { path: null, contract: null } as never, [
        'Re-run with --slice-id <id> (must be non-empty; used as the contract filename basename).'
      ]), asJson);
      process.exitCode = 1;
      return;
    }

    const exports = splitCsv(options.exports);
    const types = splitCsv(options.types);
    const signatures = splitCsv(options.signatures);
    const broadcastTo = splitCsv(options.broadcastTo);

    // Cap the combined input to protect the file IO from runaway values
    // (e.g. a 10MB comma-separated --signatures flag).
    const inputSize =
      sliceId.length +
      sid.length +
      exports.join(',').length +
      types.join(',').length +
      signatures.join(',').length +
      broadcastTo.join(',').length +
      (options.completedAt?.length ?? 0);
    if (inputSize > INPUT_LIMIT_BYTES) {
      printResult(io, fail('contract.write', 'INPUT_TOO_LARGE', `combined input size ${inputSize} bytes exceeds ${INPUT_LIMIT_BYTES} (likely oversized --exports/--types/--signatures lists)`, { path: null, contract: null } as never, [
        'Split the slice into smaller surfaces or omit optional fields.'
      ]), asJson);
      process.exitCode = 1;
      return;
    }

    try {
      const input: WriteContractInput = {
        sliceId,
        sessionId: sid,
        exports,
        types,
        publicSignatures: signatures,
        ...(broadcastTo.length > 0 ? { broadcastTo } : {}),
        ...(options.completedAt !== undefined ? { completedAt: options.completedAt } : {})
      };
      const result = writeContract(projectRoot, sid, input);
      printResult(io, ok('contract.write', {
        path: result.path,
        contractHash: result.contract.contractHash,
        sliceId: result.contract.sliceId,
        sessionId: result.contract.sessionId,
        completedAt: result.contract.completedAt,
        exportCount: result.contract.exports.length,
        typeCount: result.contract.types.length,
        signatureCount: result.contract.publicSignatures.length,
        broadcastTo: result.contract.broadcastTo ?? []
      }, [], [
        `Contract written; orchestrator will pick it up on the next \`peaks sub-agent dispatch --from-dag\` run.`,
        `Re-running with the same inputs is idempotent (overwrites in place).`
      ]), asJson);
    } catch (err) {
      printResult(io, fail('contract.write', 'WRITE_ERROR', getErrorMessage(err), { path: null, contract: null } as never, [
        'See error message; check that --project is a writable directory and --slice-id is a valid filename basename (no path separators).'
      ]), asJson);
      process.exitCode = 1;
    }
  });
}

// ===========================================================================
// Section 2: `peaks classify` CLI (was classify-classify-commands.ts).
// ===========================================================================

/**
 * peaks classify CLI (Slice L1a + L1b).
 *
 * Subcommands:
 *   - peaks classify run --project <path> [--override <level> --reason "<text>"]
 *     Classify the current diff via the heuristic + return a JSON envelope
 *     with the chosen level, gate set, and audit log.
 *   - peaks classify override --level <level> --reason "<text>" --project <path>
 *     Force a level; writes the override to the audit log.
 *   - peaks classify upgrade --level <level> --reason "<text>" --project <path>
 *     Same as override but explicitly framed as an upgrade (audit log
 *     records the upgrade event separately from override).
 *
 * Downgrade is REFUSED (per spec §4: "peaks classify downgrade" always
 * errors out). LLM may ask; the CLI never grants.
 */

type RunOptions = {
  project: string;
  override?: string;
  reason?: string;
  json?: boolean;
};

type DowngradeOptions = {
  project: string;
  level: string;
  reason: string;
  json?: boolean;
};

const CLASSIFY_AUDIT_FILE = 'classify-audit.jsonl';

function getSignalsFromGitDiff(projectRoot: string): ClassifySignals {
  // Use git diff --stat to extract file count + line count. Fall back to
  // zeros if git is unavailable (e.g. fresh repo with no commits).
  let stdout: string;
  try {
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
    stdout = execFileSync('git', ['diff', '--shortstat', 'HEAD'], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 32 * 1024 * 1024,
    }).toString('utf8');
  } catch {
    return { filesChanged: 0, linesChanged: 0, touchesDependencies: false, touchesMigrationScripts: false, isPureRefactor: true, keywords: [] };
  }

  const lines = stdout.split('\n').filter((l) => l.trim().length > 0);
  const filesChanged = lines.length;
  let added = 0;
  let removed = 0;
  let touchesDependencies = false;
  let touchesMigrationScripts = false;
  for (const line of lines) {
    const match = /(\d+)\s+insertion.*?(\d+)\s+deletion/.exec(line);
    if (match) {
      added += Number(match[1]);
      removed += Number(match[2]);
    }
    if (/(package\.json|pnpm-lock\.yaml|yarn\.lock|requirements\.txt|go\.mod)/.test(line)) {
      touchesDependencies = true;
    }
    if (/(migrate|codemod|backfill|schema)/.test(line)) {
      touchesMigrationScripts = true;
    }
  }

  // isPureRefactor: heuristic — if added lines / removed lines < 0.1 OR
  // no new exports were added, treat as refactor. For L2.2 the signal is
  // binary (true/false). Default: true (no behavior change is the safe
  // assumption; flip to false when keyword 'add' / 'new' / 'feature' present).
  const isPureRefactor = true;

  return {
    filesChanged,
    linesChanged: added + removed,
    touchesDependencies,
    touchesMigrationScripts,
    isPureRefactor,
    keywords: [],
  };
}

function appendAuditEntry(projectRoot: string, entry: unknown): void {
  const auditDir = join(projectRoot, '.peaks/_runtime');
  if (!existsSync(auditDir)) {
    try { mkdirSync(auditDir, { recursive: true }); } catch { /* ignore */ } // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
  }
  const auditPath = join(auditDir, CLASSIFY_AUDIT_FILE);
  let body = '';
  try {
    if (existsSync(auditPath)) {
      body = readFileSync(auditPath, 'utf8');
    }
  } catch { /* ignore */ } // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
  body += JSON.stringify(entry) + '\n';
  try { writeFileSync(auditPath, body); } catch { /* best-effort */ } // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
}

function isTaskLevel(value: string): value is TaskLevel {
  return (TASK_LEVELS as readonly string[]).includes(value);
}

export function registerClassifyCommands(program: Command, io: ProgramIO): void {
  const classify = program
    .command('classify')
    .description('L1a task classification: 5-level heuristic (typo/bug/feature/refactor/migration) + override/upgrade + audit log');

  addJsonOption(
    classify
      .command('run')
      .description('Classify the current diff (git diff HEAD) into one of 5 task levels')
      .requiredOption('--project <path>', 'target project root')
      .option('--override <level>', 'force a level (one of typo|bug|feature|refactor|migration); requires --reason')
      .option('--reason <text>', 'reason for the override (mandatory when --override is set)')
  ).action(async (options: RunOptions) => {
    try {
      const prefs = await loadPreferences(options.project);
      const signals = getSignalsFromGitDiff(options.project);
      let override: { level: TaskLevel; reason: string } | undefined;
      if (options.override !== undefined) {
        if (!isTaskLevel(options.override)) {
          printResult(
            io,
            fail('classify.run', 'INVALID_LEVEL', `level must be one of: ${TASK_LEVELS.join(', ')}`, { provided: options.override }, ['Pass one of typo, bug, feature, refactor, migration']),
            options.json
          );
          process.exitCode = 1;
          return;
        }
        if (options.reason === undefined || options.reason.length === 0) {
          printResult(
            io,
            fail('classify.run', 'REASON_REQUIRED', '--reason is required when --override is set', {}, ['Provide a non-empty reason for the override']),
            options.json
          );
          process.exitCode = 1;
          return;
        }
        override = { level: options.override, reason: options.reason };
      }
      const result = classifyTask(
        override !== undefined
          ? { signals, conservatism: prefs.classifyConservatism, override }
          : { signals, conservatism: prefs.classifyConservatism },
        prefs.classifyRules.feature_threshold_files,
        prefs.classifyRules.feature_threshold_lines,
      );
      appendAuditEntry(options.project, result.audit);
      printResult(io, ok('classify.run', result, [], [
        `gate set for level "${result.level}": ${result.gateSet.stages.join(', ')}`,
        `audit log: .peaks/_runtime/${CLASSIFY_AUDIT_FILE}`,
      ]), options.json);
    } catch (error) {
      printResult(
        io,
        fail('classify.run', 'CLASSIFY_RUN_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Run peaks classify --help for usage']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  // Downgrade is REFUSED per spec §4. Surface this as a hard fail.
  classify
    .command('downgrade')
    .description('REFUSED per spec §4 — peaks-loop never downgrades a classification; ask the user to override explicitly')
    .requiredOption('--level <level>', 'attempted level')
    .requiredOption('--reason <text>', 'reason for the attempt (always rejected)')
    .requiredOption('--project <path>', 'target project root')
    .option('--json', 'print machine-readable JSON envelope')
    .action(async (options: DowngradeOptions) => {
      printResult(
        io,
        fail('classify.downgrade', 'DOWNGRADE_REFUSED', 'peaks classify downgrade is refused per spec §4. Use --override (with reason) on `classify run` to force a level; the CLI never downgrades a classification unilaterally.', { attemptedLevel: options.level, reason: options.reason }, ['Use `peaks classify run --override <level> --reason "<text>"` instead']),
        options.json
      );
      process.exitCode = 2;
    });
}
