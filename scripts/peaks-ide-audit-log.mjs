#!/usr/bin/env node
/**
 * peaks-ide audit log writer — thin helper.
 *
 * Per slice #2 closeout (.peaks/memory/peaks-ide-skill-ac-10-audit-log-writer-is-a-thin-helper-not-a-separate-cli-primitive.md)
 * the audit log writer is a thin Node script the peaks-ide skill invokes from
 * its Step 5 escape hatch. It is NOT a separate `peaks <cmd>` CLI primitive
 * (dev-preference red line: "Default-no on new CLI commands").
 *
 * Contract (pinned by tests/unit/skills/peaks-ide/audit-log-helper.test.ts):
 *
 *   1. Resolves the audit log path to `<projectRoot>/.peaks/audit/peaks-ide-<UTC-date>.log`.
 *   2. With `--dry-run`, prints the would-be line in the JSON envelope and exits
 *      0 without writing.
 *   3. With `--event <name> --adapter <id> [--ok true|false] [--detail <json>]`,
 *      appends a single JSONL line containing `timestamp` (ISO-8601 UTC),
 *      `event`, `adapter`, and `ok` to the log file. Exits 0 on success.
 *   4. The log file path is gitignored (see /workspace/.gitignore `.peaks/audit/`).
 *
 * Usage:
 *   node scripts/peaks-ide-audit-log.mjs --project <repo> --event install --adapter claude-code --ok true
 *   node scripts/peaks-ide-audit-log.mjs --project <repo> --event statusline --adapter trae --ok true --detail '{"durationMs":120}'
 *   node scripts/peaks-ide-audit-log.mjs --project <repo> --event hook-handle --adapter claude-code --ok true --dry-run
 */
import { mkdir, appendFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === undefined || !flag.startsWith('--')) continue;
    const key = flag.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function resolveAuditLogPath(projectRoot) {
  const date = new Date().toISOString().slice(0, 10);
  return join(projectRoot, '.peaks', 'audit', `peaks-ide-${date}.log`);
}

function buildLine(args, now) {
  const line = {
    timestamp: now,
    event: typeof args.event === 'string' ? args.event : 'unknown',
    adapter: typeof args.adapter === 'string' ? args.adapter : 'unknown',
    ok: args.ok === 'false' || args.ok === false ? false : true
  };
  if (typeof args.detail === 'string') {
    try {
      line.detail = JSON.parse(args.detail);
    } catch {
      line.detail = args.detail;
    }
  }
  return line;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = typeof args.project === 'string' ? args.project : null;
  if (projectRoot === null) {
    process.stdout.write(JSON.stringify({ ok: false, code: 'AUDIT_LOG_PROJECT_MISSING', message: 'Missing --project <path>' }) + '\n');
    process.exitCode = 2;
    return;
  }
  const logPath = resolveAuditLogPath(projectRoot);
  const line = buildLine(args, new Date().toISOString());

  if (args['dry-run'] === true) {
    process.stdout.write(JSON.stringify({
      ok: true,
      dryRun: true,
      logPath,
      line
    }) + '\n');
    return;
  }

  if (!existsSync(dirname(logPath))) {
    await mkdir(dirname(logPath), { recursive: true });
  }
  await appendFile(logPath, JSON.stringify(line) + '\n', 'utf8');
  const stats = await stat(logPath).catch(() => null);
  process.stdout.write(JSON.stringify({
    ok: true,
    logPath,
    line,
    bytes: stats?.size ?? 0
  }) + '\n');
}

run().catch((err) => {
  process.stdout.write(JSON.stringify({
    ok: false,
    code: 'AUDIT_LOG_WRITE_FAILED',
    message: err?.message ?? String(err)
  }) + '\n');
  process.exitCode = 1;
});
