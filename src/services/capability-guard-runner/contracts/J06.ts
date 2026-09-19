import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { classifyResume } from '../../skill/resume-detector.js';
import type { GuardContext, GuardRunResult } from '../types.js';
import {
  combineProbes,
  fail,
  missingSourceFiles,
  pass,
  probe,
  requireBaselineRow
} from './_shared.js';

const SESSION_ID = '2026-09-15-guard-j06';

function write(sessionDir: string, relative: string, body: string): void {
  const abs = join(sessionDir, relative);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
}

function request(body: string): string {
  return `# request\n\n## Status\n\n- state: ${body}\n`;
}

/**
 * Behavioural probe for "the resume option always identifies the DEEPEST
 * completed gate".
 *
 * The load-bearing part is that the SAME fixture is walked from shallow to
 * deep: with only a PRD request the classifier must stop at `rd-planning`;
 * the moment a deeper RD `qa-handoff` request appears (with its review
 * artifacts) the point must move to `qa-validation`; adding the txt handoff
 * must end the workflow. A classifier that returned a constant point, or that
 * looked at file existence alone, cannot track that progression.
 *
 * The old check asserted that a file named `session-resume-service.ts` exists
 * and contains the word "resume" — which the filename already guarantees.
 */
export async function runJ06Contract(ctx: GuardContext): Promise<GuardRunResult> {
  const row = requireBaselineRow(ctx);
  const missing = missingSourceFiles(ctx, row);

  const root = mkdtempSync(join(tmpdir(), 'cbl-J06-'));
  const peaksRoot = join(root, '_runtime');
  const sessionDir = join(peaksRoot, SESSION_ID);
  mkdirSync(sessionDir, { recursive: true });

  try {
    write(sessionDir, 'prd/requests/001-shallow.md', request('handed-off'));
    const shallow = classifyResume(SESSION_ID, peaksRoot);

    // `ridOf()` strips the `NNN-` index prefix, so the review artifacts are
    // keyed by `deeper`, not `001-deeper`.
    write(sessionDir, 'rd/requests/001-deeper.md', request('qa-handoff'));
    write(sessionDir, 'rd/code-review-deeper.md', '# code review\n');
    write(sessionDir, 'audit/security-deeper.md', '# security\n');
    const deeper = classifyResume(SESSION_ID, peaksRoot);

    write(sessionDir, 'txt/handoff.md', '# handoff\n');
    const done = classifyResume(SESSION_ID, peaksRoot);

    const result = combineProbes([
      probe(missing.length === 0, `baseline sourceFiles present (${row.sourceFiles.length})`),
      probe(
        shallow.kind === 'resume' && shallow.point === 'rd-planning',
        `shallow fixture resumes at rd-planning (saw kind=${shallow.kind} point=${String(shallow.point)})`
      ),
      probe(
        deeper.kind === 'resume' && deeper.point === 'qa-validation',
        `adding an RD qa-handoff request moves the point DEEPER to qa-validation (saw kind=${deeper.kind} point=${String(deeper.point)})`
      ),
      probe(
        done.kind === 'complete',
        `adding txt/handoff.md marks the workflow complete (saw kind=${done.kind} point=${String(done.point)})`
      )
    ]);

    const artifact = row.sourceFiles[0] ?? 'src/services/skill/resume-detector.ts';
    if (result.ok) return pass(ctx, artifact);
    return fail(
      ctx,
      artifact,
      'resume identifies the deepest completed gate (rd-planning → qa-validation → complete)',
      result.detail,
      'J06 invariant broken: resume no longer tracks the deepest completed gate'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
