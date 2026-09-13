// tests/unit/services/skills/resume-detector-evidence-paths.test.ts
//
// rid=2026-09-14-audit-artifact-rid-scoping, repair cycle 1.
//
// `src/services/skill/resume-detector.ts` keeps its own file-presence probe
// for the RD review fan-out, separate from the transition gate's resolver.
// QA measured that after slice `2026-09-14-audit-artifact-rid-scoping` made
// the rid-scoped evidence names canonical, that probe still looked for
// `rd/code-review.md` and `rd/security-review.md` — neither of which a
// current slice writes. A compliant slice at `state: qa-handoff` was
// therefore classified "inconsistent" and its resume point was downgraded
// from `qa-validation` to `rd-review-fanout`, i.e. the user would be told to
// re-run a fan-out that had already produced its evidence.
//
// The probe is not a gate, so the failure mode is a wrong instruction rather
// than a wrong verdict — which is exactly why it survived the first pass.
//
// Dimensions covered:
//   - integration: a real on-disk session tree walked by `classifyResume`
//   - behavior:    the resume point each on-disk layout produces
//   - render:      OMITTED — classifyResume returns data, it renders nothing
//   - a11y:        OMITTED — no human-facing text or exit code in this path

import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';
import { classifyResume } from '../../../../src/services/skill/resume-detector.js';

declareDimensions(
  'tests/unit/services/skills/resume-detector-evidence-paths.test.ts',
  ['integration', 'behavior'],
  [
    { dim: 'render', reason: 'classifyResume returns a classification; it renders nothing' },
    { dim: 'a11y', reason: 'no human-facing text or exit code in this path' },
  ],
);

const SESSION_ID = '2026-09-14-session-repair01';
const RID = '2026-09-14-audit-artifact-rid-scoping';
const RD_REQUEST = `${RID}.md`;

/** `.peaks/_runtime/<sid>/` — the canonical session root `classifyResume` resolves. */
function sessionDir(workspace: string): string {
  return join(workspace, '.peaks', '_runtime', SESSION_ID);
}

function writeSessionFile(workspace: string, relativePath: string, body: string): void {
  const absolute = join(sessionDir(workspace), relativePath);
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, body, 'utf8');
}

/** An RD request whose newest state line is `qa-handoff` — the gate the probe guards. */
function writeRdRequestAtQaHandoff(workspace: string): void {
  writeSessionFile(
    workspace,
    `rd/requests/${RD_REQUEST}`,
    ['# RD request', '', '## Status', '', '- state: qa-handoff', ''].join('\n')
  );
}

describe('Scenario: integration — resolve the resume point of a compliant slice', () => {
  const ws = withTmpWorkspacePerTest('peaks-resume-evidence-');

  it('when the fan-out wrote rid-scoped evidence, should resume at qa-validation', () => {
    // given: the layout the peaks-rd SKILL now instructs the LLM to write —
    //        code review and audit both carry the rid
    const workspace = ws().path;
    writeRdRequestAtQaHandoff(workspace);
    writeSessionFile(workspace, `rd/code-review-${RID}.md`, '# Code review\n\n## Findings\n\nCRITICAL: none.\n');
    writeSessionFile(workspace, `audit/security-${RID}.md`, '# Security audit\n\n## Verdict\n\npass\n');

    // when: the classifier runs
    const classification = classifyResume(SESSION_ID, join(workspace, '.peaks', '_runtime'));

    // then: the slice is NOT called inconsistent. Pre-repair both probes missed
    //       and the point was downgraded to `rd-review-fanout`.
    expect(classification.point).toBe('qa-validation');
    expect(classification.warnings).toEqual([]);
  });

  it('when the evidence is bare and pre-rid, should still resume at qa-validation', () => {
    // given: a session written before the rename — back-compat must hold
    const workspace = ws().path;
    writeRdRequestAtQaHandoff(workspace);
    writeSessionFile(workspace, 'rd/code-review.md', '# Code review\n\n## Findings\n\nCRITICAL: none.\n');
    writeSessionFile(workspace, 'audit/security.md', '# Security audit\n\n## Verdict\n\npass\n');

    // when: the classifier runs
    const classification = classifyResume(SESSION_ID, join(workspace, '.peaks', '_runtime'));

    // then: the legacy layout still resolves
    expect(classification.point).toBe('qa-validation');
    expect(classification.warnings).toEqual([]);
  });

  it('when the fan-out never ran, should downgrade to rd-review-fanout', () => {
    // given: the control group — `qa-handoff` reached with no evidence at all.
    //        Without this case the two above would pass on a probe loosened to
    //        "any file exists".
    const workspace = ws().path;
    writeRdRequestAtQaHandoff(workspace);

    // when: the classifier runs
    const classification = classifyResume(SESSION_ID, join(workspace, '.peaks', '_runtime'));

    // then: the inconsistency is reported, and the missing files are named at
    //       their canonical rid-scoped paths so they can be written
    expect(classification.point).toBe('rd-review-fanout');
    expect(classification.warnings.join(' ')).toContain('inconsistent');
    expect(classification.missingArtifacts).toContain(`rd/code-review-${RID}.md`);
    expect(classification.missingArtifacts).toContain(`audit/security-${RID}.md`);
  });

  it('when the request file carries a numbered prefix, should still scope evidence by rid', () => {
    // given: `request init` writes `NNN-<rid>.md`; the rid for the evidence
    //        filename must be the rid, not `NNN-<rid>`
    const workspace = ws().path;
    writeSessionFile(
      workspace,
      `rd/requests/001-${RD_REQUEST}`,
      ['# RD request', '', '## Status', '', '- state: qa-handoff', ''].join('\n')
    );
    writeSessionFile(workspace, `rd/code-review-${RID}.md`, '# Code review\n\n## Findings\n\nCRITICAL: none.\n');
    writeSessionFile(workspace, `audit/security-${RID}.md`, '# Security audit\n\n## Verdict\n\npass\n');

    // when: the classifier runs
    const classification = classifyResume(SESSION_ID, join(workspace, '.peaks', '_runtime'));

    // then: the prefixed request still resolves its own rid-scoped evidence
    expect(classification.point).toBe('qa-validation');
    expect(classification.warnings).toEqual([]);
  });
});
