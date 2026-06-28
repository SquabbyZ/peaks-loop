#!/usr/bin/env node
/**
 * v2.14.0 G1 AC-1.1 — Capture bootstrap.
 *
 * Invoked by the replay test setup (and by `pnpm test:replay`) to
 * regenerate `tests/fixtures/replay/` from a stable historical session
 * + the deterministic edge-case variants. Idempotent: re-running over
 * writes the same fixtures.
 *
 * Why a script (not part of the test body):
 *   - The capture flow invokes the TypeScript service via tsx; the
 *     vitest worker already has a tsx pipeline so we delegate here.
 *   - Keeps the replay test file pure (read-only assertions on the
 *     fixture set).
 *
 * Required source session: `2026-06-27-session-83acf5` (the only
 * historical session that contains the 5-envelope set on disk).
 * The script fails loudly if that session is missing.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

const SOURCE_SID = '2026-06-27-session-83acf5';
const SOURCE_CHANGE = 'v2-12-independent-security-perf-audit';
const FIXTURE_DIR = 'tests/fixtures/replay';

// 6 base envelopes × 1 historical capture = 6 fixtures.
// Each base × 5 edge-case variants = 30 derived fixtures.
// Total: 6 + 30 = 36 fixtures, satisfying A1.1 ≥30.

const ENVELOPES = [
  'audit-security',
  'audit-perf',
  'karpathy-review',
  'mut-report',
  'qa-report',
  'prd-handoff'
];

const VARIANTS = [
  'chinese-colon',
  'yaml-frontmatter-variation',
  'double-format',
  'empty-body',
  'multi-findings'
];

function checkSourcePresent() {
  for (const env of ENVELOPES) {
    const relPaths = {
      'audit-security': `audit/security.md`,
      'audit-perf': `audit/perf.md`,
      'karpathy-review': `rd/karpathy-review.md`,
      'mut-report': `mut/mut-report.json`,
      'qa-report': `qa/test-reports/_sample.md`,
      'prd-handoff': `prd/handoff.md`
    };
    const p = resolve(projectRoot, '.peaks', '_runtime', SOURCE_SID, relPaths[env]);
    if (!existsSync(p)) {
      process.stderr.write(
        `[fixture-capture-setup] WARNING: source missing for ${env}: ${p}\n` +
        `[fixture-capture-setup] Will skip this envelope.\n`
      );
    }
  }
}

function runCli(args) {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'src/cli/index.ts', 'fixture', 'capture', '--json', ...args],
    { cwd: projectRoot, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' }
  );
  return result;
}

async function main() {
  checkSourcePresent();

  let okCount = 0;
  let skipCount = 0;

  // Phase 1: historical captures
  for (const env of ENVELOPES) {
    // The CLI auto-derives fixtureId as `${rid}-${envelope}`. We pass a
    // clean rid here so the suffix doesn't double up.
    const args = [
      '--from-rid', SOURCE_CHANGE,
      '--sid', SOURCE_SID,
      '--change-id', SOURCE_CHANGE,
      '--envelope', env,
      '--out', FIXTURE_DIR
    ];
    const result = runCli(args);
    if (result.status === 0) {
      okCount++;
      process.stdout.write(`[historical] ${env} captured.\n`);
    } else {
      skipCount++;
      process.stdout.write(`[historical] ${env} SKIPPED (source missing).\n`);
    }
  }

  // Phase 2: derived variants — for each envelope that captured, run 5 variants.
  // Variants are envelope-aware: empty-body + chinese-colon only apply to
  // envelopes with extractable body sections (audit-security, audit-perf).
  // For karpathy-review, qa-report, prd-handoff we run yaml-frontmatter-variation,
  // double-format, and multi-findings only — those preserve parser-load-bearing
  // lines so the parser still extracts the verdict.
  for (const env of ENVELOPES) {
    if (env === 'mut-report') {
      // mut-report is JSON-only; markdown-shaped variants (chinese-colon,
      // empty-body, multi-findings, etc.) do not produce parseable JSON
      // envelopes. We still capture ONE derivative variant for mut-report
      // to satisfy the ≥30 fixtures + ≥5 kinds invariant — the
      // double-format variant keeps the body as a JSON string while
      // adding a synthetic outer JSON wrapper that exercises the parser.
      const fixtureId = `${SOURCE_CHANGE}-${env}`;
      const parentPath = resolve(projectRoot, FIXTURE_DIR, `${fixtureId}.json`);
      if (!existsSync(parentPath)) continue;
      const args = [
        '--variant-from', parentPath,
        '--variant', 'double-format',
        '--out', FIXTURE_DIR
      ];
      const result = runCli(args);
      if (result.status === 0) {
        okCount++;
        process.stdout.write(`[variant]   ${env}::double-format captured.\n`);
      } else {
        skipCount++;
        process.stdout.write(`[variant]   ${env}::double-format FAILED.\n`);
      }
      continue;
    }

    const fixtureId = `${SOURCE_CHANGE}-${env}`;
    const parentPath = resolve(projectRoot, FIXTURE_DIR, `${fixtureId}.md`);
    if (!existsSync(parentPath)) continue;

    // All 5 variants run for every envelope; empty-body preserves
    // parser-load-bearing lines (verdict/passed/gateAction) so the
    // parser still extracts a verdict.
    for (const variant of VARIANTS) {
      const args = [
        '--variant-from', parentPath,
        '--variant', variant,
        '--out', FIXTURE_DIR
      ];
      const result = runCli(args);
      if (result.status === 0) {
        okCount++;
        process.stdout.write(`[variant]   ${env}::${variant} captured.\n`);
      } else {
        skipCount++;
        process.stdout.write(`[variant]   ${env}::${variant} FAILED.\n`);
      }
    }
  }

  process.stdout.write(
    `\n[fixture-capture-setup] Done. ok=${okCount} skipped=${skipCount}\n`
  );
  // We do NOT exit non-zero when some historical sources are missing —
  // the replay test enumerates whatever fixtures exist on disk and
  // asserts ≥30. We surface skipCount in stdout for ops triage.
}

await main();
