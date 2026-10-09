// src/cli/commands/classify-signals.ts
//
// What `peaks classify` reads and writes outside its own envelope: the diff
// signals the heuristic classifies, the audit-log append, and the task-level
// guard. Extracted from `governance-classify-contract-commands.ts` (which had
// merged `classify-classify-commands.ts` verbatim); the parsing, the audit file
// name and the level guard are unchanged.
//
// `child_process` is a static import here rather than the CJS `require` the
// merged file used inside `getSignalsFromGitDiff`: the module specifier is a
// Node builtin, so a top-level import cannot fail where the `require` could, and
// the call itself — arguments, `windowsHide`, and the zeros fallback when git is
// unavailable — is byte-for-byte the same.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  TASK_LEVELS,
  type ClassifySignals,
  type TaskLevel
} from '../../services/classify/classify-types.js';

export const CLASSIFY_AUDIT_FILE = 'classify-audit.jsonl';

export function getSignalsFromGitDiff(projectRoot: string): ClassifySignals {
  // Use git diff --stat to extract file count + line count. Fall back to
  // zeros if git is unavailable (e.g. fresh repo with no commits).
  let stdout: string;
  try {
    stdout = execFileSync('git', ['diff', '--shortstat', 'HEAD'], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true
    }).toString('utf8');
  } catch {
    return {
      filesChanged: 0,
      linesChanged: 0,
      touchesDependencies: false,
      touchesMigrationScripts: false,
      isPureRefactor: true,
      keywords: []
    };
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
    keywords: []
  };
}

export function appendAuditEntry(projectRoot: string, entry: unknown): void {
  const auditDir = join(projectRoot, '.peaks/_runtime');
  if (!existsSync(auditDir)) {
    try {
      mkdirSync(auditDir, { recursive: true });
    } catch {
      /* ignore */
    } // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
  }
  const auditPath = join(auditDir, CLASSIFY_AUDIT_FILE);
  let body = '';
  try {
    if (existsSync(auditPath)) {
      body = readFileSync(auditPath, 'utf8');
    }
  } catch {
    /* ignore */
  } // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
  body += JSON.stringify(entry) + '\n';
  try {
    writeFileSync(auditPath, body);
  } catch {
    /* best-effort */
  } // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
}

export function isTaskLevel(value: string): value is TaskLevel {
  return (TASK_LEVELS as readonly string[]).includes(value);
}
