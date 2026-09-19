// tests/unit/services/artifacts/request-artifact-state-authority.test.ts
//
// rid=2026-09-14-state-line-first-vs-last-match — slice 3 of job
// `2026-09-14-meta-integrity-fixes`.
//
// The defect: `peaks workflow verify-pipeline` reported "QA not complete:
// state is qa-block" for an artifact whose own newest `## Status` block said
// `verdict-issued` — and which `peaks request show` also reported as
// `verdict-issued`. Three independent readers of the same `- state:` line
// disagreed: two took the FIRST match (this checker and the resume detector),
// one took the LAST (`peaks request show`).
//
// A request artifact is an append-only log. Each QA round appends a section
// ending in its own `## Status` block, and `request transition` rewrites the
// newest state line in place. So an artifact appended to more than once read
// as its FIRST round to the pipeline checker and the resume detector, and as
// its LAST round to `request show` and the writer.
//
// These cases pin the single rule ("the last `- state:` line") in one place,
// `locateArtifactState` in `request-artifact-state-helpers.ts`, which the
// writer and all three readers now share.
//
// Dimensions covered:
//   - behavior:    the rule, the writer/reader agreement, the sentinels
//   - render:      the shape `updateStatusBlock` writes
//   - integration: real on-disk round-trip through `showRequestArtifact` and
//                  `transitionRequestArtifact`
//   - a11y:        OMITTED — the state line is machine-only; no human-facing
//                  text or exit code is produced by the resolver

import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';
import {
  locateArtifactState,
  readArtifactState,
  updateStatusBlock
} from '../../../../src/services/artifacts/request-artifact-state-helpers.js';
import { extractState as pipelineExtractState } from '../../../../src/services/workflow/pipeline-verify-gate-support.js';
import {
  createRequestArtifact,
  showRequestArtifact,
  transitionRequestArtifact
} from '../../../../src/services/artifacts/request-artifact-service.js';

declareDimensions(
  'tests/unit/services/artifacts/request-artifact-state-authority.test.ts',
  ['behavior', 'render', 'integration'],
  [
    {
      dim: 'a11y',
      reason:
        'the state line is machine-only; no human-facing text or exit code is produced by the resolver'
    }
  ]
);

const SESSION_ID = 'test-session';
const REQUEST_ID = '2026-09-14-state-authority';
const TS = '2026-09-14T00:00:00.000Z';

/**
 * A QA artifact shaped like the one that reproduced the defect: one appended
 * round per state, each ending in its own `## Status` block. The specimen had
 * four such rounds (`qa-block`, `qa-block`, `qa-pass`, `verdict-issued`).
 */
function multiRoundArtifact(roundStates: ReadonlyArray<string>): string {
  return roundStates
    .map((state, index) =>
      [
        `# 修复循环 ${index} 复验`,
        '',
        `round ${index} prose`,
        '',
        '## Status',
        '',
        `- state: ${state}`,
        `- last update: 2026-09-13T1${index}:00:00.000Z`,
        '',
        '---',
        ''
      ].join('\n')
    )
    .join('\n');
}

/** The shape of `.peaks/_runtime/2026-09-06-session-a87ca4/rd/requests/001-2026-09-06-cli-drift.md`:
 *  a hand-written artifact with a `- state:` line and no `## Status` heading. */
function legacyArtifact(state: string): string {
  return `# RD Request ${REQUEST_ID}\n\n- session: ${SESSION_ID}\n- state: ${state}\n- type: feature\n`;
}

const SPECIMEN = multiRoundArtifact(['qa-block', 'qa-block', 'qa-pass', 'verdict-issued']);

describe('Scenario: behavior — one rule for "which state: line is the artifact state"', () => {
  it('when an artifact has several state lines, should take the last one', () => {
    const lines = SPECIMEN.split(/\r?\n/);
    const located = locateArtifactState(lines);
    expect(located.state).toBe('verdict-issued');
    expect(lines[located.stateLineIndex]?.trim()).toBe('- state: verdict-issued');
    // ...and there really are earlier state lines for the rule to choose against.
    expect(lines.filter((line) => /^-\s*state:/.test(line.trim())).length).toBe(4);
  });

  it('when the artifact is the four-round specimen, should read verdict-issued through every reader', () => {
    // The old pipeline reader returned 'qa-block' here — that is the defect.
    expect(SPECIMEN.split(/\r?\n/)).toContain('- state: qa-block');
    expect(readArtifactState(SPECIMEN)).toBe('verdict-issued');
    expect(pipelineExtractState(SPECIMEN)).toBe('verdict-issued');
  });

  it('when an artifact is genuinely still blocked, should read qa-block on both ends — the clean control', () => {
    const blocked = multiRoundArtifact(['qa-block']);
    expect(readArtifactState(blocked)).toBe('qa-block');
    expect(pipelineExtractState(blocked)).toBe('qa-block');
    // Read side takes the on-disk value as it is; only the write side is
    // constrained to the union (which spells this state `blocked`, while the
    // QA artifacts on disk spell it `qa-block`).
    expect(updateStatusBlock(blocked, 'blocked', TS).previousState).toBe('qa-block');
  });

  it('when the newest round is a pass and the oldest is a block, should report the newest on both ends', () => {
    const artifact = multiRoundArtifact(['qa-block', 'qa-pass']);
    expect(readArtifactState(artifact)).toBe('qa-pass');
    expect(pipelineExtractState(artifact)).toBe('qa-pass');
  });

  it('when the writer has just transitioned the artifact, should leave the reader reading the new state (AC1)', () => {
    const { updated, previousState } = updateStatusBlock(SPECIMEN, 'verdict-issued', TS);
    expect(previousState).toBe('verdict-issued');
    expect(readArtifactState(updated)).toBe('verdict-issued');
    expect(pipelineExtractState(updated)).toBe('verdict-issued');
  });

  it('when the writer transitions a blocked artifact, should report the previous state the readers would have read', () => {
    const { updated, previousState } = updateStatusBlock(
      multiRoundArtifact(['draft', 'qa-block']),
      'verdict-issued',
      TS
    );
    expect(previousState).toBe('qa-block');
    expect(readArtifactState(updated)).toBe('verdict-issued');
  });

  it('when an artifact predates the Status heading, should still read its state (legacy fallback)', () => {
    expect(readArtifactState(legacyArtifact('implemented'))).toBe('implemented');
    expect(pipelineExtractState(legacyArtifact('implemented'))).toBe('implemented');
  });

  it('when an artifact has no state line at all, should report absence without inventing a state', () => {
    const stateless = '# RD Request\n\n- session: test-session\n';
    expect(locateArtifactState(stateless.split(/\r?\n/))).toEqual({
      stateLineIndex: -1,
      state: null
    });
    expect(readArtifactState(stateless)).toBeNull();
    // Each caller keeps its own "no state" sentinel, so no consumer's
    // absence check changes meaning under the shared rule.
    expect(pipelineExtractState(stateless)).toBe('unknown');
    expect(updateStatusBlock(stateless, 'draft', TS).previousState).toBe('unknown');
  });

  it('when a state line is quoted without the leading dash, should not treat it as the field', () => {
    const quoting = `# QA verdict\n\nstate: qa-block\n\n## Status\n\n- state: qa-pass\n`;
    expect(readArtifactState(quoting)).toBe('qa-pass');
    expect(pipelineExtractState(quoting)).toBe('qa-pass');
  });

  it('when a state line is appended after the newest Status block, should take it — the rule is positional and the writer is its only producer', () => {
    // Known limit, pinned rather than claimed away: the rule is positional, so a
    // process that appends a bare `- state:` line takes over the field. Scoping
    // the search to the newest `## Status` block was evaluated and rejected as a
    // SECOND locator the writer does not use — not because it protects nothing.
    // On this very input it returns `verdict-issued`, and the appended line does
    // not defeat it; what it disagrees with is the writer, which rewrites the
    // last `- state:` line wherever it sits and never moves it into the block.
    const appended = `${SPECIMEN}\n- transition note (${TS}): hand edit\n- state: qa-block\n`;
    expect(readArtifactState(appended)).toBe('qa-block');
    expect(pipelineExtractState(appended)).toBe('qa-block');
  });

  it('when a state line sits inside a fenced code block, should not read it as the field — a quoted example cannot set the state (repair round 2)', () => {
    // The exposure the security audit measured: a QA artifact that *documents*
    // the state format quotes `- state: ...` inside a fence, and under the
    // unfenced rule that quotation was an input to the transition checker.
    // This job's own artifacts do it; they survived on disk only because the
    // quoted copies happened not to be last. The writer uses the same locator,
    // so a fence is never a write target either.
    const fenced = `${SPECIMEN}\n\`\`\`yaml\n- state: qa-block\n\`\`\`\n`;
    expect(readArtifactState(fenced)).toBe('verdict-issued');
    expect(pipelineExtractState(fenced)).toBe('verdict-issued');
    const { updated, previousState } = updateStatusBlock(fenced, 'implemented', TS);
    expect(previousState).toBe('verdict-issued');
    expect(updated).toContain('- state: qa-block');
    expect(readArtifactState(updated)).toBe('implemented');
  });

  it('when a state line is indented, should not read it as the field — every writer emits column 0', () => {
    const indented = `${SPECIMEN}\n    - state: qa-block\n`;
    expect(readArtifactState(indented)).toBe('verdict-issued');
    expect(pipelineExtractState(indented)).toBe('verdict-issued');
  });
});

describe('Scenario: render — what updateStatusBlock writes', () => {
  it('when the artifact already has a state line, should rewrite it in place and not grow the file', () => {
    const before = multiRoundArtifact(['qa-block']);
    const { updated } = updateStatusBlock(before, 'verdict-issued', TS);
    expect(updated.split(/\r?\n/).length).toBe(before.split(/\r?\n/).length);
    expect(updated).toContain('- state: verdict-issued');
    expect(updated).not.toContain('- state: qa-block');
    expect(updated).toContain(`- last update: ${TS}`);
  });

  it('when the artifact has no state line, should append a Status block', () => {
    const { updated } = updateStatusBlock('# RD Request\n', 'draft', TS);
    expect(updated).toContain('## Status');
    expect(updated).toContain('- state: draft');
    expect(readArtifactState(updated)).toBe('draft');
  });

  it('when a reason is given, should append it as a transition note without disturbing the state line', () => {
    const { updated } = updateStatusBlock(
      multiRoundArtifact(['qa-pass']),
      'verdict-issued',
      TS,
      'user-requested-abandon'
    );
    expect(updated).toContain(`- transition note (${TS}): user-requested-abandon`);
    expect(readArtifactState(updated)).toBe('verdict-issued');
  });
});

describe('Scenario: integration — real artifacts on disk agree across both ends', () => {
  const ws = withTmpWorkspacePerTest('peaks-state-authority-');

  async function qaArtifactPath(): Promise<string> {
    const created = await createRequestArtifact({
      role: 'qa',
      requestId: REQUEST_ID,
      projectRoot: ws().path,
      sessionId: SESSION_ID,
      apply: true
    });
    return created.path;
  }

  it('when a fresh artifact is created, should read draft through show and through the pipeline reader', async () => {
    const path = await qaArtifactPath();
    const shown = await showRequestArtifact({
      projectRoot: ws().path,
      role: 'qa',
      requestId: REQUEST_ID,
      sessionId: SESSION_ID
    });
    expect(shown?.state).toBe('draft');
    expect(pipelineExtractState(readFileSync(path, 'utf8'))).toBe('draft');
  });

  it('when a multi-round artifact is transitioned, should read the new state through show and the pipeline reader (AC2)', async () => {
    const path = await qaArtifactPath();
    // Simulate the QA rounds that append to the same artifact: two more
    // `## Status` blocks land above the one the template wrote.
    writeFileSync(
      path,
      `${readFileSync(path, 'utf8')}\n${multiRoundArtifact(['qa-block', 'qa-pass'])}`,
      'utf8'
    );

    await transitionRequestArtifact({
      role: 'qa',
      requestId: REQUEST_ID,
      projectRoot: ws().path,
      newState: 'verdict-issued',
      confirmed: true,
      allowIncomplete: true
    });

    const shown = await showRequestArtifact({
      projectRoot: ws().path,
      role: 'qa',
      requestId: REQUEST_ID,
      sessionId: SESSION_ID
    });
    const onDisk = readFileSync(path, 'utf8');
    // The regression: the first `- state:` line on disk is `draft`, so the
    // first-match reader used to report `draft` after the transition.
    expect(onDisk.indexOf('- state: draft')).toBeGreaterThan(-1);
    expect(shown?.state).toBe('verdict-issued');
    expect(pipelineExtractState(shown?.content ?? '')).toBe('verdict-issued');
  });

  it('when a legacy-shaped artifact sits on disk, should read it through show and the pipeline reader', async () => {
    const path = await qaArtifactPath();
    writeFileSync(path, legacyArtifact('implemented'), 'utf8');
    const shown = await showRequestArtifact({
      projectRoot: ws().path,
      role: 'qa',
      requestId: REQUEST_ID,
      sessionId: SESSION_ID
    });
    expect(shown?.state).toBe('implemented');
    expect(pipelineExtractState(readFileSync(path, 'utf8'))).toBe('implemented');
  });
});
