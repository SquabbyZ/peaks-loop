/**
 * `peaks strat <sub>` / `peaks tact <sub>` — the STRAT → TACT producer chain.
 *
 * WHY this module exists (backlog §16 / §9.2): the documented chain
 * `strategy.md (STRAT.sig) → impl.json (TACT.sig) → mut-report.json` had no
 * CLI producer, so `mut/mut-report.json` could never receive a real
 * `inputSig`. These commands are thin wrappers over the unchanged rd
 * sub-stages; the service layer stays the single implementation.
 *
 * Hard rules carried over from the services:
 *   - H8: a TACT can only anchor to a STRAT whose recomputed sha256 matches
 *     the artifact content. `tact write` therefore never accepts a raw
 *     `--input-sig`; it re-verifies the strategy JSON first.
 *   - H6: AST-gate violations refuse before TACT.sig is written.
 *   - One-axis layout: every `--out` lives under
 *     `.peaks/_runtime/<sessionId>/`; `--session-id` is required on writes.
 */
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { Command } from 'commander';
import type { ProgramIO } from '../cli-helpers.js';
import { runAstGate } from '../../services/rd/ast-gate.js';
import { runStrategicStage } from '../../services/rd/strategic-stage.js';
import {
  registerStratSig,
  runTacticalStage,
  type RunTacticalInput
} from '../../services/rd/tactical-stage.js';
import type { ImplOutput } from '../../services/rd/types.js';
import {
  CommandRefusal,
  emitOk,
  guarded,
  parseAstContext,
  readImpl,
  readStrategy,
  requireSessionAxis
} from './strat-tact-command-helpers.js';

const CHANGED_FILES_REMEDY =
  'Pass --changed-files as existing project-relative paths; the AST gate reads only files inside --project.';

type StratWriteOptions = {
  project: string;
  sessionId: string;
  out: string;
  goal: string;
  rootCause: string;
  impact: string[];
  design: string;
  json: boolean;
};

type TactWriteOptions = {
  project: string;
  sessionId: string;
  strategy: string;
  out: string;
  changedFiles: string[];
  astContext?: string;
  json: boolean;
};

type TactReadOptions = {
  artifact: string;
  project: string;
  json: boolean;
};

async function isRegularFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** Containment check: the AST gate must never read outside --project. */
async function resolveChangedFiles(project: string, files: readonly string[]): Promise<string[]> {
  for (const file of files) {
    if (isAbsolute(file)) {
      throw new CommandRefusal(
        'INVALID_CHANGED_FILE',
        CHANGED_FILES_REMEDY,
        `--changed-files entry is absolute: ${file}`
      );
    }
    const absolute = resolve(project, file);
    const rel = relative(project, absolute);
    if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new CommandRefusal(
        'INVALID_CHANGED_FILE',
        CHANGED_FILES_REMEDY,
        `--changed-files entry escapes --project: ${file}`
      );
    }
    if (!(await isRegularFile(absolute))) {
      throw new CommandRefusal(
        'INVALID_CHANGED_FILE',
        CHANGED_FILES_REMEDY,
        `--changed-files entry does not exist as a file under --project: ${file}`
      );
    }
  }
  return [...files];
}

/** A TOCTOU failure inside the service still surfaces as a named refusal. */
async function runTacticalSafely(input: RunTacticalInput): Promise<ImplOutput> {
  try {
    return await runTacticalStage(input);
  } catch (err) {
    if (err instanceof CommandRefusal) {
      throw err;
    }
    throw new CommandRefusal(
      'TACT_WRITE_FAILED',
      'Re-run peaks tact write; if the AST gate now reports a violation, fix it first.',
      `tact write failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

async function runStratWrite(io: ProgramIO, a: StratWriteOptions): Promise<void> {
  const project = resolve(a.project);
  const out = requireSessionAxis(project, a.sessionId, a.out);
  await mkdir(dirname(out), { recursive: true });
  const result = await runStrategicStage({
    out,
    goal: a.goal,
    rootCauseAnalysis: a.rootCause,
    impactSurface: a.impact,
    designRationale: a.design
  });
  const jsonPath = `${out}.json`;
  await writeFile(jsonPath, JSON.stringify(result, null, 2), 'utf8');
  emitOk(io, a.json, { path: out, jsonPath, sha256: result.sha256 }, [
    `strategy.md: ${out}`,
    `json: ${jsonPath}`,
    `STRAT.sig: ${result.sha256}`
  ]);
}

async function runTactWrite(io: ProgramIO, a: TactWriteOptions): Promise<void> {
  const project = resolve(a.project);
  const out = requireSessionAxis(project, a.sessionId, a.out);
  const changedFiles = await resolveChangedFiles(project, a.changedFiles);
  const strategyPath = isAbsolute(a.strategy) ? resolve(a.strategy) : resolve(project, a.strategy);
  const strategy = await readStrategy(strategyPath);
  const context = parseAstContext(a.astContext);

  // Name the violations before the service throws its count-only error.
  const gate = await runAstGate({ project, changedFiles, context });
  if (!gate.passed) {
    throw new CommandRefusal(
      'AST_GATE_FAILED',
      'Fix the undocumented API call (or update the locked-version doc summary) and re-run peaks tact write.',
      `AST gate failed — ${gate.violations
        .map((v) => `${v.api} at ${v.file}:${v.line}`)
        .join('; ')}`
    );
  }

  await mkdir(dirname(out), { recursive: true });
  // H8: rehydrate the in-process registry from the verified artifact —
  // this CLI process never ran `runStrategicStage`.
  registerStratSig(dirname(out), strategy.sha256);
  const impl = await runTacticalSafely({
    project,
    changedFiles,
    inputSig: strategy.sha256,
    context,
    out
  });
  emitOk(
    io,
    a.json,
    {
      path: out,
      sha256: impl.sha256,
      inputSig: impl.inputSig,
      changedFiles: impl.changedFiles,
      astGateResult: impl.astGateResult
    },
    [`impl.json: ${out}`, `TACT.sig: ${impl.sha256}`, `inputSig: ${impl.inputSig}`]
  );
}

async function runTactRead(io: ProgramIO, a: TactReadOptions): Promise<void> {
  const project = resolve(a.project);
  const artifact = isAbsolute(a.artifact) ? resolve(a.artifact) : resolve(project, a.artifact);
  const impl = await readImpl(artifact);
  emitOk(
    io,
    a.json,
    {
      sha256: impl.sha256,
      inputSig: impl.inputSig,
      changedFiles: impl.changedFiles,
      astGateResult: impl.astGateResult
    },
    [
      `sha256: ${impl.sha256}`,
      `inputSig: ${impl.inputSig}`,
      `changedFiles: ${impl.changedFiles.join(', ')}`,
      `astGateResult: passed=${impl.astGateResult.passed} violations=${impl.astGateResult.violations.length}`
    ]
  );
}

export function registerStratTactCommands(program: Command, io: ProgramIO): void {
  const strat = program
    .command('strat')
    .description('STRAT producer: strategy.md + STRAT.sig (spec §4.2 战略审计)');
  registerStratWrite(strat, io);
  const tact = program
    .command('tact')
    .description('TACT producer/reader: impl.json + TACT.sig chained to STRAT.sig');
  registerTactWrite(tact, io);
  registerTactRead(tact, io);
}

function registerStratWrite(strat: Command, io: ProgramIO): void {
  strat
    .command('write')
    .description('Write strategy.md plus its <out>.json sibling. One-axis: --session-id required.')
    .requiredOption('--project <path>', 'project root')
    .requiredOption(
      '--session-id <sid>',
      'session id; --out must live under .peaks/_runtime/<sid>/'
    )
    .requiredOption('--out <path>', 'strategy markdown path (inside .peaks/_runtime/<sid>/)')
    .requiredOption('--goal <text>', 'goal of this slice')
    .requiredOption('--root-cause <text>', 'root-cause analysis')
    .requiredOption('--impact <items...>', 'impact surface entries')
    .requiredOption('--design <text>', 'design rationale')
    .option('--json', 'machine-readable output', false)
    .action((a: StratWriteOptions) =>
      guarded(io, a.json, 'strat write', () => runStratWrite(io, a))
    );
}

function registerTactWrite(tact: Command, io: ProgramIO): void {
  tact
    .command('write')
    .description(
      'Verify the strategy JSON, run the AST gate, then write impl.json + TACT.sig. One-axis: --session-id required.'
    )
    .requiredOption('--project <path>', 'project root')
    .requiredOption(
      '--session-id <sid>',
      'session id; --out must live under .peaks/_runtime/<sid>/'
    )
    .requiredOption('--strategy <path>', 'strategy JSON sibling written by `peaks strat write`')
    .requiredOption('--out <path>', 'impl.json path (inside .peaks/_runtime/<sid>/)')
    .requiredOption('--changed-files <paths...>', 'files the tactical stage changed')
    .option('--ast-context <json>', 'AstGateContext JSON ({ deps, docSummaries })')
    .option('--json', 'machine-readable output', false)
    .action((a: TactWriteOptions) => guarded(io, a.json, 'tact write', () => runTactWrite(io, a)));
}

function registerTactRead(tact: Command, io: ProgramIO): void {
  tact
    .command('read')
    .description('Re-read impl.json, recompute TACT.sig, and print the chain anchor.')
    .requiredOption('--artifact <path>', 'impl.json written by `peaks tact write`')
    .option('--project <path>', 'project root (default: cwd)', '.')
    .option('--json', 'machine-readable output', false)
    .action((a: TactReadOptions) => guarded(io, a.json, 'tact read', () => runTactRead(io, a)));
}
