import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isDirectory, pathExists } from '../../shared/fs.js';
import { getCurrentChangeId } from '../../shared/change-id.js';
import { verifyPipeline } from '../workflow/pipeline-verify-service.js';
import { findMockViolations } from '../audit/enforcers/mock-placement.js';
import { runRedLinesAudit } from '../audit/red-lines-service.js';
import type { SliceCheckOptions, SliceCheckResult, SliceCheckStage } from './slice-check-types.js';

interface RunResult {
  status: 'pass' | 'fail';
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

interface ResolvedCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly shell: boolean;
}

/**
 * Resolve a CLI binary to a project-local path, falling back to
 * the system `npx`. pnpm (and npm/yarn) all create
 * `node_modules/.bin/<name>`:
 *
 *   - On Unix, this is a symlink to the package's executable.
 *   - On Windows, this is a `.cmd` shim; `execFileSync` only
 *     resolves `.cmd` through the shell (PATHEXT), so we pass
 *     `shell: true` when invoking one. Without this, the
 *     Windows `npx ENOENT` false-positive from
 *     observations 2317 + 2792 reproduces for every local
 *     binary.
 *
 * Returns the command + args + a `shell` flag that the
 * `runCommand` helper threads into `execFileSync`.
 */
function resolveLocalBinary(projectRoot: string, name: string): ResolvedCommand {
  // pnpm creates `node_modules/.bin/<name>` (symlink on Unix,
  // `.cmd` shim on Windows). We probe both shapes; the
  // `process.platform === 'win32'` extension probe is the most
  // portable approach.
  const isWin = process.platform === 'win32';
  const candidateNames = isWin ? [`${name}.cmd`, `${name}.ps1`, `${name}`] : [name];
  for (const candidate of candidateNames) {
    const cmdPath = join(projectRoot, 'node_modules', '.bin', candidate);
    if (existsSync(cmdPath)) {
      return { command: cmdPath, args: [], shell: isWin };
    }
  }
  // Fallback: system npx. On Windows this still has the ENOENT
  // issue, but the fallback is at least informative when it
  // fires (the user can see "npx not found" instead of a
  // silent exit 1).
  return { command: 'npx', args: [name], shell: false };
}

function runCommand(command: string, args: string[], cwd: string, timeoutMs: number, shell: boolean = false): RunResult {
  const start = Date.now();
  try {
    const stdout = execFileSync(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
      shell
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
  // Per Windows npx ENOENT (observations 2317+2792 from
  // 2026-06-09), prefer the project-local `node_modules/.bin/tsc`
  // (symlink on Unix, .cmd on Windows). The local binary is
  // installed by pnpm at workspace-install time and avoids the
  // npx PATH-lookup issue.
  const tsc = resolveLocalBinary(projectRoot, 'tsc');
  const result = runCommand(tsc.command, [...tsc.args, '--noEmit'], projectRoot, 180_000, tsc.shell);
  const testFiles = result.stdout.match(/(tests?\/.*\.test\.ts)/g) ?? [];
  return {
    name: 'typecheck',
    description: `${tsc.command} --noEmit (no JS emit, type-only check)`,
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

async function runUnitTests(projectRoot: string, runTests: boolean): Promise<SliceCheckStage> {
  const start = Date.now();
  // Default: changed-only suite (`vitest run --changed`) — runs only tests
  // related to git-changed files. Cost drops from 30s+ to ~1-3s in steady
  // state. Opt-in to the full suite via `runTests: true` (CLI flag
  // `--run-tests`). See `references/runbook.md` for the rationale and
  // `tests/unit/slice-check-service.test.ts` for the regression net.
  // Per Windows npx ENOENT (observations 2317+2792), resolve
  // the project-local vitest binary instead of shelling out
  // through npx.
  const vitest = resolveLocalBinary(projectRoot, 'vitest');
  const vitestArgs: string[] = runTests
    ? ['run', '--reporter=default', '--coverage=false']
    : ['run', '--changed', '--reporter=default', '--coverage=false'];
  const description = runTests
    ? `${vitest.command} run (full test suite, coverage off)`
    : `${vitest.command} run --changed (tests for git-changed files only, coverage off)`;
  const result = runCommand(vitest.command, [...vitest.args, ...vitestArgs], projectRoot, 600_000, vitest.shell);
  const summary = parseVitestSummary(result.stdout, result.durationMs);
  // Vitest doesn't always print the per-bucket counts cleanly; infer "passed"
  // as total - failed - skipped when failed/skipped buckets are present.
  const passed = Math.max(summary.tests - summary.failed - summary.skipped, 0);
  return {
    name: 'unit-tests',
    description,
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
      mode: runTests ? 'full' : 'changed',
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
  // files can live under EITHER `.peaks/_runtime/<rid>/rd/` (active change-id) or
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
      description: 'peaks workflow verify-pipeline (RD/QA gate checks against .peaks/_runtime/change/<changeId>/)',
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
      description: 'peaks workflow verify-pipeline (RD/QA gate checks against .peaks/_runtime/change/<changeId>/)',
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
  let unitTestsRunMode: SliceCheckResult['unitTestsRunMode'] = 'skipped';

  // Stage 1: typecheck
  stages.push(await runTypecheck(options.projectRoot));

  // Stage 2: unit-tests — by default changed-only suite, opt-in to full
  if (options.skipTests) {
    stages.push({
      name: 'unit-tests',
      description: 'vitest run (skipped per --skip-tests)',
      status: 'skipped',
      durationMs: 0,
      detail: 'Skipped: --skip-tests was set. Use the peaks-solo-test skill to run the full suite manually.'
    });
    unitTestsRunMode = 'skipped';
  } else {
    const unitTests = await runUnitTests(options.projectRoot, options.runTests === true);
    // unit-test stage failed, downgrade `failed` to `skipped` with a
    // reason that names the failure count and points to the long-term
    // fix. Does NOT affect the other 3 stages. Only meaningful when
    // the stage actually runs (skipped-tests bypass short-circuits
    // above).
    if (
      options.allowPreExistingFailures === true &&
      unitTests.status === 'fail'
    ) {
      const failureCount = (unitTests.data?.failed as number | undefined) ?? 0;
      stages.push({
        name: 'unit-tests',
        description: `vitest run ${options.runTests === true ? '' : '--changed '} (overridden via --allow-pre-existing-failures)`.trim(),
        status: 'skipped',
        durationMs: unitTests.durationMs,
        detail: `pre-existing failures: ${failureCount} failing test(s) under coverage.exclude or unrelated to this slice; user opted in via --allow-pre-existing-failures. For the long-term fix, mark these tests .skip or move to coverage.exclude (see dogfood-2-f1-f4.md F17c).`,
        data: { ...(unitTests.data ?? {}), overriddenFrom: 'fail', failureCount }
      });
      unitTestsRunMode = 'overridden';
    } else {
      stages.push(unitTests);
      unitTestsRunMode = options.runTests === true ? 'full' : 'changed';
    }
  }

  // Stage 3: 3-way review fanout check
  stages.push(await runReviewFanout(options.projectRoot, rid, options.refreshFanout));

  // Stage 4: gate verify-pipeline
  stages.push(await runGateVerifyPipeline(options.projectRoot, rid, rid));

  // Stage 5: mock-placement (L2.1 P0 #5) — refuse inline mock data in src/ or skills/.
  // Lifts changed files via `git diff --name-only HEAD`; falls back to a
  // warning when the diff is empty (e.g. a fresh tree). Lighter than the
  // full `peaks scan diff-vs-scope` and keeps the slice check self-contained.
  stages.push(await runMockPlacement(options.projectRoot));

  // Stage 6 (Slice #7 L2.4 P2-b): audit-regression — assert
  // catalog integrity (no orphan enforcers, no orphan catalog
  // entries), catalog size lower bound, and runtime budget.
  // The stage runs `peaks audit red-lines` in-process (no
  // subprocess) and is gating: failure exits non-zero.
  stages.push(await runAuditRegression(options.projectRoot));

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
    unitTestsRunMode,
    boundaryReady,
    totalDurationMs: Date.now() - totalStart,
    nextActions
  };
}


async function runAuditRegression(projectRoot: string): Promise<SliceCheckStage> {
  const start = Date.now();
  try {
    const result = runRedLinesAudit({ projectRoot });
    const durationMs = Date.now() - start;
    // Slice #7 L2.4 P2-b acceptance A3 + A4:
    //   - totalRedLines >= 60 (catalog grew to 66; pins the lower bound)
    //   - enforcerFindings has no rl-audit-no-orphan-enforcer / rl-audit-no-orphan-catalog hits
    const issues: string[] = [];
    if (result.audit.totalRedLines < 60) {
      issues.push(`totalRedLines ${result.audit.totalRedLines} < 60`);
    }
    const orphanFindings = result.audit.enforcerFindings.filter((f) =>
      f.enforcerId === 'rl-audit-no-orphan-enforcer-001' ||
      f.enforcerId === 'rl-audit-no-orphan-catalog-001'
    );
    if (orphanFindings.length > 0) {
      issues.push(`${orphanFindings.length} orphan-enforcer / orphan-catalog finding(s)`);
    }
    if (issues.length > 0) {
      return {
        name: 'audit-regression',
        description: 'audit-regression: catalog integrity + runtime budget (L2.4 P2-b stage 6)',
        status: 'fail',
        durationMs,
        detail: issues.join('; '),
      };
    }
    return {
      name: 'audit-regression',
      description: 'audit-regression: catalog integrity + runtime budget (L2.4 P2-b stage 6)',
      status: 'pass',
      durationMs,
      detail: `catalog: ${result.audit.totalRedLines} entries (${result.audit.cliBacked} cli-backed, ${result.audit.proseOnly} prose-only); audit ran in ${durationMs}ms`,
    };
  } catch (error: any) {
    return {
      name: 'audit-regression',
      description: 'audit-regression: catalog integrity + runtime budget (L2.4 P2-b stage 6)',
      status: 'fail',
      durationMs: Date.now() - start,
      detail: 'audit-regression failed: ' + (error?.message ?? String(error)),
    };
  }
}

async function runMockPlacement(projectRoot: string): Promise<SliceCheckStage> {
  const start = Date.now();
  // List changed files via git. `--name-only` produces one path per line;
  // we filter to text files in scope and read each.
  const diffResult = runCommand('git', ['diff', '--name-only', '--diff-filter=ACMR', 'HEAD'], projectRoot, 30_000);
  if (diffResult.status !== 'pass') {
    return {
      name: 'mock-placement',
      description: 'mock-placement: no inline mock data in src/ or skills/ (L2.1 P0 #5)',
      status: 'skipped',
      durationMs: Date.now() - start,
      detail: 'git diff failed or returned no changed files; mock-placement scan skipped.'
    };
  }
  const changed = diffResult.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (changed.length === 0) {
    return {
      name: 'mock-placement',
      description: 'mock-placement: no inline mock data in src/ or skills/ (L2.1 P0 #5)',
      status: 'skipped',
      durationMs: Date.now() - start,
      detail: 'no changed files in HEAD diff; mock-placement scan skipped.'
    };
  }
  const files = changed
    .filter((p) => p.startsWith('src/') || p.startsWith('skills/'))
    .filter((p) => p.endsWith('.ts') || p.endsWith('.tsx') || p.endsWith('.js') || p.endsWith('.mjs'))
    .map((filePath) => {
      const abs = join(projectRoot, filePath);
      if (!existsSync(abs)) return null;
      const content = readFileSync(abs, 'utf-8');
      return { filePath, content };
    })
    .filter((f): f is { filePath: string; content: string } => f !== null);
  const violations = findMockViolations(files);
  return {
    name: 'mock-placement',
    description: 'mock-placement: no inline mock data in src/ or skills/ (L2.1 P0 #5)',
    status: violations.length === 0 ? 'pass' : 'fail',
    durationMs: Date.now() - start,
    detail: violations.length === 0
      ? `Scanned ${files.length} changed file(s); no inline mock data found.`
      : `${violations.length} violation(s): ${violations.map((v) => `${v.filePath} (${v.snippet})`).join('; ')}`,
    data: { scannedFiles: files.length, violations: violations.map((v) => ({ filePath: v.filePath, pattern: v.pattern, snippet: v.snippet })) }
  };
}
