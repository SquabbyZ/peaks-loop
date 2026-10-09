// src/cli/commands/qa-archive-screenshots-command.ts
//
// `peaks qa archive-screenshots` — the remediation for peaks-qa SKILL.md
// "Hard contracts for browser validation" Contract 1: every Playwright
// `browser_take_screenshot` MUST land under
// `.peaks/_runtime/<sessionId>/qa/screenshots/`, not at the project root. When
// the LLM forgets to pass `filename`, Playwright MCP scatters `.png` files at
// the repo top level; this verb scans `--source` (default: project root) and
// moves strays into the session directory. Extracted from `qa-commands.ts`; the
// registered name, options, envelope and exit codes are unchanged.

import { join, resolve } from 'node:path';
import type { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';

import { archiveScreenshots } from '../../services/qa/screenshot-archive-service.js';
import { getSessionId } from '../../services/session/session-manager.js';
import { isUnsafePathInput } from '../../shared/path-safety.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';

interface ArchiveOptions {
  source: string;
  project: string;
  sessionId?: string;
  json?: boolean;
}

export function registerQaArchiveScreenshotsCommand(qa: Command, io: ProgramIO): void {
  addJsonOption(
    qa
      .command('archive-screenshots')
      .description(
        'Move stray Playwright screenshots (.png/.jpg/.jpeg) from the ' +
          'project root into .peaks/_runtime/<session-id>/qa/screenshots/. ' +
          'Enforces peaks-qa SKILL.md Contract 1.'
      )
      .option(
        '--source <dir>',
        'directory to scan for stray screenshots (default: project root)',
        '.'
      )
      .option('--project <path>', 'project root (default: cwd)', '.')
      .option('--session-id <sid>', 'target session id; defaults to the active session', '')
  ).action((options: ArchiveOptions) => {
    try {
      const projectRoot = resolve(options.project);
      const sid = options.sessionId?.trim() || getSessionId(projectRoot) || 'ad-hoc';
      // Sid axis. Guarded after resolution so the flag value and the session
      // binding are both covered. `archiveScreenshots` cannot do this itself:
      // it only ever sees a fully-resolved `targetDir`.
      if (isUnsafePathInput(sid)) {
        throw new Error(`Invalid session id: ${sid} (must be a single path segment)`);
      }
      const targetDir = join(projectRoot, '.peaks', '_runtime', sid, 'qa', 'screenshots');
      const envelope = archiveScreenshots({ sourceDir: options.source, targetDir });
      printResult(
        io,
        ok('qa.archive-screenshots', envelope, [], archiveNextActions(envelope)),
        options.json
      );
    } catch (error) {
      process.exitCode = 1;
      printResult(
        io,
        fail(
          'qa.archive-screenshots',
          'ARCHIVE_FAILED',
          error instanceof Error ? error.message : 'Unknown error',
          { project: options.project, source: options.source },
          ['Verify the source dir exists and is readable']
        ),
        options.json
      );
    }
  });
}

/** The move notice, or the all-clear — never both. */
function archiveNextActions(envelope: ReturnType<typeof archiveScreenshots>): string[] {
  return envelope.moved.length === 0
    ? ['No stray screenshots found in ' + envelope.scannedSource]
    : [
        `Moved ${envelope.moved.length} file(s) to ${envelope.targetDir}`,
        'Re-run peaks qa run to verify the gate passes'
      ];
}
