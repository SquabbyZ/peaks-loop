// tests/unit/services/skills/resume-detector-state.test.ts
//
// rid=2026-09-14-state-line-first-vs-last-match — slice 3 of job
// `2026-09-14-meta-integrity-fixes`.
//
// The resume detector is the third reader of the `- state:` line, and it
// carried its own copy of the bug: a `exec` on the whole document without the
// `g` flag, i.e. FIRST match. It now shares `readArtifactState` with the
// pipeline checker and `request show`.
//
// Two things about that delegation need pinning, because both are silent if
// they break:
//   - the first/last rule, observed through a real classification;
//   - the "no state line" sentinel. This module's caller does
//     `primaryPrd.state.length > 0`, so it must keep seeing `''`, not the
//     `'unknown'` the other two readers use.
//
// Dimensions covered:
//   - integration: real on-disk session tree, walked by `classifyResume`
//   - behavior:    the classification each state shape produces
//   - render:      OMITTED — classifyResume returns data, it renders nothing
//   - a11y:        OMITTED — no human-facing text or exit code in this path

import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';
import { classifyResume } from '../../../../src/services/skill/resume-detector.js';

declareDimensions(
  'tests/unit/services/skills/resume-detector-state.test.ts',
  ['integration', 'behavior'],
  [
    { dim: 'render', reason: 'classifyResume returns data; it renders nothing' },
    { dim: 'a11y', reason: 'no human-facing text or exit code in this path' },
  ],
);

const SESSION_ID = '2026-09-14-session-dddd00';

function writePrd(workspace: string, body: string): void {
  const dir = join(workspace, '.peaks', '_runtime', SESSION_ID, 'prd', 'requests');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '001-2026-09-14-resume-state.md'), body, 'utf8');
}

/** A PRD artifact that was appended to: round 0 said `draft`, the newest round says `handed-off`. */
const APPENDED_PRD = [
  '# PRD Request',
  '',
  '## Status',
  '',
  '- state: draft',
  '- last update: 2026-09-13T10:00:00.000Z',
  '',
  '---',
  '',
  '# Revision 1',
  '',
  '## Status',
  '',
  '- state: handed-off',
  '- last update: 2026-09-14T00:00:00.000Z',
  '',
].join('\n');

describe('Scenario: integration — the resume detector reads the newest state line', () => {
  const ws = withTmpWorkspacePerTest('peaks-resume-state-');

  it('when an appended PRD ends in handed-off, should classify at the PRD terminal gate and not as in-flight', () => {
    writePrd(ws().path, APPENDED_PRD);
    const result = classifyResume(SESSION_ID, join(ws().path, '.peaks', '_runtime'));
    // Before this slice the first-match reader saw `draft`, so the PRD branch
    // fell through to phase 5 and reported `in-flight`.
    expect(result.kind).toBe('resume');
    expect(result.state).toBeNull();
  });

  it('when a PRD is still draft, should classify as in-flight:spec-locked', () => {
    writePrd(ws().path, '# PRD Request\n\n## Status\n\n- state: draft\n');
    const result = classifyResume(SESSION_ID, join(ws().path, '.peaks', '_runtime'));
    expect(result.kind).toBe('in-flight');
    expect(result.state).toBe('spec-locked');
  });

  it('when a PRD has no state line, should stay fresh — the empty-string sentinel is load-bearing', () => {
    // `classifyResume` does `primaryPrd.state.length > 0`. If the shared
    // resolver's `null` were mapped to 'unknown' here instead of '', this PRD
    // would be reported as in-flight.
    writePrd(ws().path, '# PRD Request\n\n- session: test\nno status block in this file\n');
    const result = classifyResume(SESSION_ID, join(ws().path, '.peaks', '_runtime'));
    expect(result.kind).toBe('fresh');
  });
});
