#!/usr/bin/env node
// scripts/coverage-c8.mjs
//
// Slice 2026-07-25-vitest-coverage-tooling c8 approach (option 4 from
// slice-b-v3-closure.md §5). Sidesteps vitest's coverage pipeline entirely.
//
// Why c8 works when vitest's built-in coverage pipeline doesn't (per
// slice-b-deferred.md §2 + slice-b-v5-evidence.md §3 + subslice-b6-2-evidence.md §3):
//
//   - c8 reads V8 native coverage counters (collected automatically by
//     Node.js when a process is launched with NODE_V8_COVERAGE set, or
//     when run as a wrapper). It does NOT go through vitest's
//     resolveConfig.ts / initCoverageProvider() path that overwrites
//     project-level coverage with root's coverage on vitest 4.x AND
//     5.0.0-beta.7 (same workspace.ts configResolved hook).
//   - c8 merges per-process V8 counter files in a single Node.js
//     process — no cross-fork race, no Windows file-locking cliff on
//     `coverage/.tmp/`, no per-project provider override being silently
//     dropped.
//
// Usage:
//   node scripts/coverage-c8.mjs                 # run vitest on tests/unit
//   node scripts/coverage-c8.mjs <files...>      # run vitest on specific files
//
// Hard rule: do NOT weaken the 100% threshold (G5 no-fake-green).

import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

const isWin = platform() === 'win32';
const localBin = (bin) => resolve(projectRoot, 'node_modules', '.bin', bin + (isWin ? '.cmd' : ''));

function log(msg) {
  process.stdout.write(`[coverage-c8] ${msg}\n`);
}

function killVitestProcesses() {
  try {
    if (isWin) {
      execSync(
        'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name=\'node.exe\'\\" | Where-Object { $_.CommandLine -like \'*vitest*\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"',
        { stdio: 'ignore' }
      );
    } else {
      execSync('pkill -f vitest 2>/dev/null', { stdio: 'ignore' });
    }
  } catch {
    /* ignore */
  }
}

function clean(dir) {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// Step 1: pre-clean coverage dirs so c8 --clean starts fresh.
const v8CoverageDir = resolve(projectRoot, 'coverage', 'tmp');
const coverageOutDir = resolve(projectRoot, 'coverage');
clean(v8CoverageDir);
clean(coverageOutDir);
ensureDir(v8CoverageDir);

// Step 2: build the vitest command (NO --coverage — c8 handles that).
const vitestBin = localBin('vitest');
const vitestArgs = ['run'];
const userFiles = process.argv.slice(2);
if (userFiles.length > 0) {
  vitestArgs.push(...userFiles);
} else {
  vitestArgs.push('tests/unit');
}

// Step 3: wrap vitest with `c8 --check-coverage --100`.
// c8 will:
//   - run vitest with NODE_V8_COVERAGE pointing at coverage/tmp
//   - collect V8 native counters
//   - emit text-summary + json-summary reports under ./coverage
//   - check thresholds (--100 = lines/functions/branches/statements at 100%)
//   - exit non-zero if any threshold is below 100%
//
// We also pass --exclude to skip the same files the project's existing
// vitest coverage config excludes (commands, types, the shared package,
// etc.) — those files are not exercised by unit tests by design.
const c8Bin = localBin('c8');
const c8Args = [
  '--check-coverage',
  '--100',
  '--reporter=text-summary',
  '--reporter=json-summary',
  '--reports-dir=' + coverageOutDir,
  '--temp-directory=' + v8CoverageDir,
  '--exclude=src/cli/index.ts',
  '--exclude=src/cli/program.ts',
  '--exclude=src/cli/commands/shadcn-commands.ts',
  '--exclude=src/cli/commands/core-artifact-commands.ts',
  '--exclude=src/cli/commands/codegraph-commands.ts',
  '--exclude=src/cli/commands/project-commands.ts',
  '--exclude=src/cli/commands/workflow-commands.ts',
  '--exclude=src/cli/commands/request-commands.ts',
  '--exclude=src/cli/commands/scan-commands.ts',
  '--exclude=packages/peaks-loop-shared/src/paths.ts',
  '--exclude=packages/peaks-loop-shared/src/result.ts',
  '--exclude=src/services/recommendations/recommendation-types.ts',
  '--exclude=src/services/artifacts/artifact-service.ts',
  '--exclude=src/services/artifacts/workspace-service.ts',
  '--exclude=src/services/config/config-service.ts',
  '--exclude=src/services/config/config-safety.ts',
  '--exclude=src/shared/frontmatter.ts',
  '--exclude=src/services/skills/skill-registry.ts',
  '--exclude=src/services/doctor/doctor-service.ts',
  '--exclude=src/services/proxy/proxy-service.ts',
  '--exclude=src/services/codegraph/codegraph-process-runner.ts',
  '--exclude=src/services/shadcn/shadcn-service.ts',
  '--exclude=src/services/mcp/mcp-types.ts',
  '--exclude=src/services/mcp/mcp-stdio-transport.ts',
  '--exclude=src/services/openspec/openspec-types.ts',
  '--exclude=src/services/understand/understand-types.ts',
  '--exclude=src/services/scan/scan-types.ts',
  '--exclude=src/services/session/index.ts',
  '--src=' + projectRoot,
  vitestBin,
  ...vitestArgs,
];

log(`Running: c8 --check-coverage --100 ${vitestArgs.join(' ')}`);
log(`V8 counters → ${v8CoverageDir}`);
log(`Reports     → ${coverageOutDir}`);

const c8Res = spawnSync(c8Bin, c8Args, {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: isWin,
});

// Sanity: did V8 emit any counters? Even if c8 exited 0 (meaning the
// thresholds were met on files that WERE counted), zero counter files
// would be a fake-green signal — refuse to emit one.
const counterCount = existsSync(v8CoverageDir)
  ? readdirSync(v8CoverageDir).filter((f) => f.endsWith('.json')).length
  : 0;
log(`V8 native coverage counters collected: ${counterCount} file(s)`);

if (counterCount === 0) {
  log('ERROR: zero V8 counter files written — instrumentation never fired.');
  log('Common causes: NODE_V8_COVERAGE not propagated to vitest workers,');
  log('or vitest ran zero tests. Refusing to emit a fake-green report.');
  process.exit(1);
}

if (c8Res.status !== 0) {
  log(`c8 exited with code ${c8Res.status ?? 'null'} — vitest or threshold(s) failed.`);
  process.exit(c8Res.status ?? 1);
}

log('All coverage thresholds met (100% lines/functions/branches/statements).');
process.exit(0);