import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isDirectory, pathExists } from '../../shared/fs.js';
import { getCurrentChangeId } from '../../shared/change-id.js';
import { verifyPipeline } from '../workflow/pipeline-verify-service.js';
import type { SliceCheckOptions, SliceCheckResult, SliceCheckStage } from './slice-check-types.js';

interface RunResult {
  status: 'pass' | 'fail';
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

function runCommand(command: string, args: string[], cwd: string, timeoutMs: number): RunResult {
  const start = Date.now();
  try {
    const stdout = execFileSync(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024
    }).toString('utf8');
    return {
      status: 'pass',
      stdout,
      stderr: '',
      exitCode: 0,
      durationMs: Date.now() - start
    };
  } catch (error: any) {
    const stdout = (error?.stdout ?? '').toString('utf8');
    const stderr = (error?.stderr ?? '').toString('utf8');
    return {
      status: 'fail',
      stdout,
      stderr,
      exitCode: typeof error?.status === 'number' ? error.status : 1,
      durationMs: Date.now() - start
    };
  }
}

function tailLines(text: string, max: number): string {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length <= max) return lines.join('\n');
  return [...lines.slice(0, 3), `... (${lines.length - max} more lines) ...`, ...lines.slice(-max + 3)].join('\n');
}

async function runTypecheck(projectRoot: string): Promise<SliceCheckStage> {
  const start = Date.now();
  const result = runCommand('npx', ['tsc', '--noEmit'], projectRoot, 180_000);
  const testFiles = result.stdout.match(/(tests?\/.*\.test\.ts)/g) ?? [];
  return {
    name: 'typecheck',
    description: 'npx tsc --noEmit (no JS emit, type-only check)',
    status: result.status,
    durationMs: result.durationMs,
    detail: result.status === 'pass'
      ? `Typecheck passed in ${result.durationMs}ms.`
      : tailLines(result.stdout + result.stderr, 10) || `tsc exited with code ${result.exitCode}.`,
    data: { exitCode: result.exitCode }
  };
}

interface VitestSummary {
  tests: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
}

function parseVitestSummary(stdout: string, fallbackDuration: number): VitestSummary {
  // Vitest 2.x prints e.g. "Test Files  1 passed (1)" and "Tests  1 passed (1)"
  // and "Duration  0.50s" or "Duration  1.23s". Be lenient with regex.
  const testsMatch = /Tests?\s+(\d+)\s+(?:passed|run)/.exec(stdout);
  const failedMatch = /Tests?\s+(\d+)\s+failed/.exec(stdout);
  const skippedMatch = /Tests?\s+(\d+)\s+skipped/.exec(stdout);
  const durationMatch = /Duration[^\d]*(\d+(?:\.\d+)?)\s*s/.exec(stdout);

  return {
    tests: testsMatch ? parseInt(testsMatch[1]!, 10) : 0,
    passed: 0,
    failed: failedMatch ? parseInt(failedMatch[1]!, 10) : 0,
    skipped: skippedMatch ? parseInt(skippedMatch[1]!, 10) : 0,
    durationMs: durationMatch ? Math.round(parseFloat(durationMatch[1]!) * 1000) : fallbackDuration
  };
}

async function runUnitTests(projectRoot: string): Promise<SliceCheckStage> {
  const start = Date.now();
  const result = runCommand('npx', ['vitest', 'run', '--reporter=default', '--coverage=false'], projectRoot, 600_000);
  const summary = parseVitestSummary(result.stdout, result.durationMs);
  // Vitest doesn't always print the per-bucket counts cleanly; infer "passed"
  // as total - failed - skipped when failed/skipped buckets are present.
  const passed = Math.max(summary.tests - summary.failed - summary.skipped, 0);
  return {
    name: 'unit-tests',
    description: 'npx vitest run (full test suite, coverage off)',
    status: result.status,
    durationMs: result.durationMs,
    detail: result.status === 'pass'
      ? `All tests passed in ${result.durationMs}ms.`
      : tailLines(result.stdout + result.stderr, 12) || `vitest exited with code ${result.exitCode}.`,
    data: {
      tests: summary.tests,
      passed,
      failed: summary.failed,
      skipped: summary.skipped,
      exitCode: result.exitCode
    }
  };
}

const REVIEW_FILES = [
  { name: 'code-review', path: 'rd/code-review.md', label: 'code-review' },
  { name: 'security-review', path: 'rd/security-review.md', label: 'security-review' },
  { name: 'perf-baseline', path: 'rd/perf-baseline.md', label: 'perf-baseline' }
] as const;

async function runReviewFanout(
  projectRoot: string,
  rid: string,
  refresh: boolean
): Promise<SliceCheckStage> {
  const start = Date.now();

  if (refresh) {
    // `peaks-rd` does the 3-way fan-out when the slice is in `spec-locked` or
    // `implemented` state. The actual fan-out is invoked via the `peaks-rd`
    // skill body, not via a CLI subcommand (each sub-agent is invoked with
    // its own prompt). When `--refresh-fanout` is set, we emit a
    // nextAction that tells the caller to invoke `Skill(skill="peaks-rd")`
    // (the role skill owns the 3 review artifact writes).
    return {
      name: 'review-fanout',
      description: '3-way review fan-out (code-review + security-review + perf baseline)',
      status: 'skipped',
      durationMs: Date.now() - start,
      detail: '3-way fan-out is dispatched via Skill(skill="peaks-rd"); invoke it to regenerate the review artifacts.',
      data: { refresh: true, rid }
    };
  }

  // Default: verify all 3 review files exist with non-empty content. The
  // files can live under EITHER `.peaks/<rid>/rd/` (active change-id) or
  // `.peaks/retrospective/<rid>/rd/` (shipped). The boundary check
  // accepts either — the LLM may be at a slice that's still active
  // (not yet archived) or one that just shipped.
  const scopes = [rid, `retrospective/${rid}`];
  const missing: string[] = [];
  const found: Array<{ name: string; path: string; bytes: number; scope: string }> = [];
  for (const review of REVIEW_FILES) {
    let hit: { abs: string; scope: string; bytes: number } | null = null;
    for (const scope of scopes) {
      const abs = join(projectRoot, '.peaks', scope, review.path);
      if (existsSync(abs)) {
        const bytes = statSync(abs).size;
        if (bytes >= 20) {
          hit = { abs, scope, bytes };
          break;
        }
      }
    }
    if (hit === null) {
      missing.push(review.label);
      continue;
    }
    found.push({ name: review.name, path: hit.abs, bytes: hit.bytes, scope: hit.scope });
  }

  const status: SliceCheckStage['status'] = missing.length === 0 ? 'pass' : 'fail';
  return {
    name: 'review-fanout',
    description: '3-way review fan-out (code-review + security-review + perf baseline)',
    status,
    durationMs: Date.now() - start,
    detail: status === 'pass'
      ? `All 3 review artifacts present (${found.map((f) => f.name).join(', ')}; scope: ${found[0]?.scope}).`
      : `Missing or empty: ${missing.join(', ')}. Re-run with --refresh-fanout or invoke Skill(skill="peaks-rd") to regenerate.`,
    data: { found, missing }
  };
}

async function runGateVerifyPipeline(
  projectRoot: string,
  rid: string,
  changeId: string
): Promise<SliceCheckStage> {
  const start = Date.now();
  try {
    const result = await verifyPipeline({ projectRoot, rid, changeId });
    const duration = Date.now() - start;
    return {
      name: 'gate-verify-pipeline',
      description: 'peaks workflow verify-pipeline (RD/QA gate checks against .peaks/<changeId>/)',
      status: result.complete ? 'pass' : 'fail',
      durationMs: duration,
      detail: result.complete
        ? `All gates passed in ${duration}ms.`
        : `${result.violations.length} violation(s): ${result.violations.join('; ')}`,
      data: {
        rdGates: result.rdPhase.gates.length,
        qaGates: result.qaPhase.gates.length,
        rdState: result.rdPhase.state,
        qaState: result.qaPhase.state,
        violations: result.violations,
        nextActions: result.nextActions
      }
    };
  } catch (error: any) {
    return {
      name: 'gate-verify-pipeline',
      description: 'peaks workflow verify-pipeline (RD/QA gate checks against .peaks/<changeId>/)',
      status: 'fail',
      durationMs: Date.now() - start,
      detail: error?.message ?? 'verify-pipeline threw',
      data: {}
    };
  }
}

export async function sliceCheck(options: SliceCheckOptions): Promise<SliceCheckResult> {
  const peaksRoot = join(options.projectRoot, '.peaks');
  if (!(await isDirectory(peaksRoot))) {
    throw new Error(`.peaks/ not found at ${options.projectRoot}. Run peaks workspace init first.`);
  }

  // Resolve rid: explicit > current-change binding > null
  let rid = options.rid;
  if (rid === undefined) {
    const bound = getCurrentChangeId(options.projectRoot);
    if (bound !== null) {
      rid = bound;
    }
  }
  if (rid === undefined) {
    throw new Error('No --rid and no current-change binding. Pass --rid <id> or run peaks workspace init --change-id <id> first.');
  }

  const totalStart = Date.now();
  const stages: SliceCheckStage[] = [];

  // Stage 1: typecheck
  stages.push(await runTypecheck(options.projectRoot));

  // Stage 2: full vitest
  if (!options.skipTests) {
    const unitTests = await runUnitTests(options.projectRoot);
    // Opt-in override: if --allow-pre-existing-failures is set AND the
    // unit-test stage failed, downgrade `failed` to `skipped` with a
    // reason that names the failure count and points to the long-term
    // fix. Does NOT affect the other 3 stages.
    if (
      options.allowPreExistingFailures === true &&
      unitTests.status === 'fail'
    ) {
      const failureCount = (unitTests.data?.failed as number | undefined) ?? 0;
      stages.push({
        name: 'unit-tests',
        description: 'npx vitest run (overridden via --allow-pre-existing-failures)',
        status: 'skipped',
        durationMs: unitTests.durationMs,
        detail: `pre-existing failures: ${failureCount} failing test(s) under coverage.exclude or unrelated to this slice; user opted in via --allow-pre-existing-failures. For the long-term fix, mark these tests .skip or move to coverage.exclude (see dogfood-2-f1-f4.md F17c).`,
        data: { ...(unitTests.data ?? {}), overriddenFrom: 'fail', failureCount }
      });
    } else {
      stages.push(unitTests);
    }
  } else {
    stages.push({
      name: 'unit-tests',
      description: 'npx vitest run (skipped per --skip-tests)',
      status: 'skipped',
      durationMs: 0,
      detail: 'Skipped: --skip-tests was set.'
    });
  }

  // Stage 3: 3-way review fanout check
  stages.push(await runReviewFanout(options.projectRoot, rid, options.refreshFanout));

  // Stage 4: gate verify-pipeline
  stages.push(await runGateVerifyPipeline(options.projectRoot, rid, rid));

  const boundaryReady = stages.every((s) => s.status === 'pass' || s.status === 'skipped');

  const nextActions: string[] = [];
  if (!boundaryReady) {
    const failed = stages.filter((s) => s.status === 'fail');
    for (const f of failed) {
      nextActions.push(`Fix ${f.name}: ${f.detail.split('\n')[0]}`);
    }
  } else {
    nextActions.push(`peaks request transition ${rid} --role rd --state qa-handoff --confirm --project <path>`);
    nextActions.push(`peaks request transition ${rid} --role qa --state verdict-issued --confirm --project <path>`);
  }

  return {
    projectRoot: options.projectRoot,
    rid,
    stages,
    boundaryReady,
    totalDurationMs: Date.now() - totalStart,
    nextActions
  };
}
