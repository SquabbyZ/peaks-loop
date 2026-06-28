#!/usr/bin/env node
/**
 * v2.14.0 G1 AC-1.4 — `peaks fixture capture` standalone entrypoint.
 *
 * This script is the Node-runnable CLI equivalent of the in-process
 * TypeScript command (`src/cli/commands/fixture-commands.ts`). It
 * exists so the fixture capture flow can be invoked from shell scripts,
 * CI pipelines, and release prep WITHOUT rebuilding the TypeScript
 * `dist/` output first.
 *
 * Usage (matches the TS sub-command 1:1):
 *   node scripts/fixture-capture.mjs \
 *        --from-rid 2026-06-27-verdict-aggregator-fixes \
 *        --sid 2026-06-27-session-83acf5 \
 *        --envelope audit-security \
 *        --out tests/fixtures/replay
 *
 *   node scripts/fixture-capture.mjs \
 *        --variant-from tests/fixtures/replay/2026-06-27-verdict-aggregator-fixes-audit-security.md \
 *        --variant chinese-colon \
 *        --out tests/fixtures/replay
 *
 * The actual work is delegated to the TypeScript service via `tsx`
 * (already a devDependency). We keep this script intentionally thin —
 * the rule logic lives in `src/services/fixture/`, this is only the
 * CLI glue.
 *
 * Exit codes:
 *   0 — capture succeeded; fixture pair written
 *   1 — validation / IO failure (printed as JSON to stderr)
 *   2 — bad CLI args (printed to stderr)
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write(
    'peaks fixture capture — Capture a real envelope as a replay fixture.\n' +
    '\n' +
    'Usage:\n' +
    '  node scripts/fixture-capture.mjs --from-rid <rid> --sid <sid> --envelope <kind> [--out <dir>]\n' +
    '  node scripts/fixture-capture.mjs --variant-from <path> --variant <edge-case> [--out <dir>]\n' +
    '\n' +
    'Envelope kinds: audit-security | audit-perf | karpathy-review | mut-report | qa-report | prd-handoff\n' +
    'Edge cases:     chinese-colon | yaml-frontmatter-variation | double-format | empty-body | multi-findings\n'
  );
  process.exit(argv.length === 0 ? 2 : 0);
}

// Delegate to the TS CLI via tsx. We forward argv verbatim.
const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', 'src/cli/index.ts', 'fixture', 'capture', ...argv],
  { cwd: projectRoot, stdio: 'inherit', env: process.env }
);

process.exit(result.status ?? 1);
