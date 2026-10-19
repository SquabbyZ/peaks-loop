/**
 * reviewer-artifacts.ts — the producer side of the G4 reviewer: writes
 * `rd/third-party-review-<rid>.md` and `rd/third-party-review-<rid>.json` under
 * the session's `.peaks/_runtime/<sessionId>/rd/`.
 *
 * Only a real verdict reaches here. The caller must not call this with a
 * skip envelope (backlog §7.10 ④): a skip stays a skip.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isUnsafePathInput } from '../../shared/path-safety.js';
import { REQUEST_ID_PATTERN } from '../artifacts/request-artifact-service.js';
import type { ReviewerEnvelope } from './reviewer-types.js';

export type ReviewerArtifactPaths = { markdown: string; json: string };

/** One table cell: newlines and pipes from the model cannot break the table. */
function cell(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

export function renderReviewerMarkdown(rid: string, envelope: ReviewerEnvelope): string {
  const violations =
    envelope.violations.length === 0
      ? 'None.'
      : envelope.violations
          .map((v) => `- \`${cell(v.kind)}\` — ${cell(v.file)}:${String(v.line)} — ${cell(v.hint)}`)
          .join('\n');
  return [
    `# third-party-review — ${cell(rid)}`,
    '',
    'Schema-validated ReviewerEnvelope produced by `peaks reviewer run`.',
    `The JSON sibling \`third-party-review-${cell(rid)}.json\` carries the same envelope.`,
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| reviewerId | ${cell(envelope.reviewerId)} |`,
    `| modelId | ${cell(envelope.modelId)} |`,
    `| modelFamily | ${cell(envelope.modelFamily)} |`,
    `| passed | ${String(envelope.passed)} |`,
    `| gateAction | ${cell(envelope.gateAction)} |`,
    `| reason | ${cell(envelope.reason)} |`,
    '',
    '## Violations',
    '',
    violations,
    ''
  ].join('\n');
}

export function writeReviewerArtifacts(input: {
  projectRoot: string;
  sessionId: string;
  rid: string;
  envelope: ReviewerEnvelope;
}): ReviewerArtifactPaths {
  // `isUnsafePathInput` is a traversal guard, not a single-segment guard: it
  // admits `a/b`. The session id is ONE directory name under `_runtime/`, so
  // the separator axes are refused here as well.
  if (
    isUnsafePathInput(input.sessionId) ||
    input.sessionId.includes('/') ||
    input.sessionId.includes('\\')
  ) {
    throw new Error(`Invalid session id: ${input.sessionId} (must be a single path segment)`);
  }
  // The rid becomes a filename below, so the repo's own request-id guard runs
  // before the first mkdir — a `..` segment must not reach `join`.
  if (!REQUEST_ID_PATTERN.test(input.rid)) {
    throw new Error(
      `Invalid request id: ${input.rid} (expected letters, digits, dots, underscores, or dashes)`
    );
  }
  const dir = join(input.projectRoot, '.peaks', '_runtime', input.sessionId, 'rd');
  mkdirSync(dir, { recursive: true });
  const paths = {
    markdown: join(dir, `third-party-review-${input.rid}.md`),
    json: join(dir, `third-party-review-${input.rid}.json`)
  };
  writeFileSync(paths.markdown, renderReviewerMarkdown(input.rid, input.envelope), 'utf8');
  writeFileSync(paths.json, JSON.stringify(input.envelope, null, 2), 'utf8');
  return paths;
}
