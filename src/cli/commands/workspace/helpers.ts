/**
 * Shared helpers for `peaks workspace <sub-command>` implementations.
 *
 * Extracted from `src/cli/commands/workspace-commands.ts` (slice
 * 2026-06-16-workspace-commands-split) so multiple sub-command files can
 * reuse the same hooks-decision marker + prompt logic. Pure helpers
 * only — no commander / no service calls. Keeping these here means the
 * per-subcommand files stay focused on their command wiring and option
 * parsing.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

/** Sticky decision marker for the first-time "install hooks" prompt. */
export const HOOKS_DECISION_REL_PATH = '.peaks/.peaks-init-hooks-decision.json';

export type HooksDecision = 'installed' | 'skipped';

export type HooksDecisionMarker = {
  version: 1;
  decision: HooksDecision;
  decidedAt: string;
  scope: 'project' | 'global';
};

export function readDecisionMarker(projectRoot: string): HooksDecisionMarker | null {
  const path = join(projectRoot, HOOKS_DECISION_REL_PATH);
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as Partial<HooksDecisionMarker>;
    if (data.version !== 1) return null;
    if (data.decision !== 'installed' && data.decision !== 'skipped') return null;
    if (typeof data.decidedAt !== 'string') return null;
    if (data.scope !== 'project' && data.scope !== 'global') return null;
    return {
      version: 1,
      decision: data.decision,
      decidedAt: data.decidedAt,
      scope: data.scope
    };
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}

export function writeDecisionMarker(projectRoot: string, decision: HooksDecision): void {
  const path = join(projectRoot, HOOKS_DECISION_REL_PATH);
  const dir = join(projectRoot, '.peaks');
  mkdirSync(dir, { recursive: true });
  const marker: HooksDecisionMarker = {
    version: 1,
    decision,
    decidedAt: new Date().toISOString(),
    scope: 'project'
  };
  writeFileSync(path, JSON.stringify(marker, null, 2) + '\n', 'utf8');
}

/**
 * Read a yes/no answer from stdin. Returns `true` for empty / Y / y,
 * `false` for N / n, or `null` when stdin is not a TTY (the caller falls
 * back to the no-prompt path). Times out after 30s so a piped-but-blocked
 * stdin never hangs the CLI.
 */
export function promptYesNo(question: string): Promise<boolean | null> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY !== true) {
      resolve(null);
      return;
    }
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    const timer = setTimeout(() => {
      rl.close();
      resolve(null);
    }, 30_000);
    rl.question(question, (answer) => {
      clearTimeout(timer);
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      if (trimmed === '' || trimmed === 'y' || trimmed === 'yes') {
        resolve(true);
        return;
      }
      if (trimmed === 'n' || trimmed === 'no') {
        resolve(false);
        return;
      }
      // Treat anything else as "no" — the user can re-run with --install-hooks
      // if they want a different answer. We never throw from this prompt.
      resolve(false);
    });
  });
}