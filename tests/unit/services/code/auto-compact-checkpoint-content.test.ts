// tests/unit/services/code/auto-compact-checkpoint-content.test.ts
//
// THE DEFECT THIS LOCKS. `writePreCompactCheckpoint` seeded every field the
// post-compact detector reads with an empty value: `openQuestions`,
// `recentDecisions`, `recentArtifactPaths` were `[]`, `gitStatus` was `''`, and
// `currentPlan` said only "resume from auto-decisions.md". So the resume D7
// enabled had nothing to restore — the session re-derived what it already knew.
//
// Measured 2026-11-16, on a session that had an active request and a populated
// `txt/auto-decisions.md`: seven empty fields.
//
// None of that data was missing. It was on disk and unread.
//
// Dimensions covered:
//   - behavior:    parsing the decisions log, building the plan, bounding lists
//   - integration: the real writer against a real session tree on disk
//
// Dimensions omitted:
//   - a11y / render: no user-visible surface; the artifact is JSON on disk.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import {
  buildCheckpointContent,
  readAutoDecisions
} from '~/src/services/code/auto-compact-checkpoint-content';
import { writePreCompactCheckpoint } from '~/src/services/code/auto-compact-artifacts';

declareDimensions(
  'tests/unit/services/code/auto-compact-checkpoint-content.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'a11y', reason: 'the checkpoint is a JSON artifact, not a user-facing surface' },
    { dim: 'render', reason: 'no rendered document is produced' }
  ]
);

const tempRoots: string[] = [];
const SID = '2026-01-01-session-test';

function makeRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Write a decisions log in the exact format `appendAutoDecisionLog` emits. */
function writeDecisions(root: string, blocks: ReadonlyArray<Record<string, string>>): void {
  const dir = join(root, '.peaks', '_runtime', SID, 'txt');
  mkdirSync(dir, { recursive: true });
  const rows = blocks
    .map((b) =>
      [
        '',
        `## Auto-compact decision — ${b['ts'] ?? ''}`,
        `- ratio: ${b['ratio'] ?? ''}`,
        `- checkpoint: ${b['checkpoint'] ?? ''}`,
        `- next-actions: ${b['nextActions'] ?? ''}`,
        `- resume-hint: ${b['hint'] ?? ''}`,
        ''
      ].join('\n')
    )
    .join('');
  writeFileSync(join(dir, 'auto-decisions.md'), `# peaks-code auto-decisions log\n${rows}`, 'utf8');
}

describe('(behavior) reading the decisions log', () => {
  it('when the log holds two blocks, should return both in file order', () => {
    // given: two recorded decisions
    // when: the log is parsed
    // then: both are returned, oldest first, with their fields intact
    const root = makeRoot('peaks-ckpt-read-');
    writeDecisions(root, [
      { ts: '2026-01-01T00:00:00Z', ratio: '80.0%', hint: 'first' },
      { ts: '2026-01-01T01:00:00Z', ratio: '86.0%', hint: 'second' }
    ]);

    const entries = readAutoDecisions(root, SID);

    expect(entries).toHaveLength(2);
    expect(entries[0]?.resumeHint).toBe('first');
    expect(entries[1]?.resumeHint).toBe('second');
  });

  it('when a next-actions value contains the separator, should keep every action', () => {
    // given: a field value that itself contains " | "
    // when: the log is parsed
    // then: the actions split on the separator and none is lost
    const root = makeRoot('peaks-ckpt-split-');
    writeDecisions(root, [{ ts: 't1', nextActions: 'alpha | beta | gamma' }]);

    expect(readAutoDecisions(root, SID)[0]?.nextActions).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('when the log is absent, should return nothing rather than throw', () => {
    // given: a session tree with no decisions log
    // when: the log is read
    // then: the answer is an empty list — an absent log is not an error
    const root = makeRoot('peaks-ckpt-absent-');

    expect(readAutoDecisions(root, SID)).toEqual([]);
  });
});

describe('(behavior) building the checkpoint content', () => {
  it('when a decision exists, should put its hint and next actions in currentPlan', () => {
    // given: one decision naming a hint and two actions
    // when: the content is built
    // then: the plan carries both, and the actions are also open questions
    const root = makeRoot('peaks-ckpt-plan-');
    writeDecisions(root, [{ ts: 't1', ratio: '88.0%', hint: 'finish S1', nextActions: 'a1 | a2' }]);

    const content = buildCheckpointContent({ projectRoot: root, sessionId: SID });

    expect(content.currentPlan).toContain('finish S1');
    expect(content.currentPlan).toContain('a1');
    expect(content.openQuestions).toEqual(['a1', 'a2']);
  });

  it('when no decision exists, should still say something true instead of pointing at a file', () => {
    // given: no decisions recorded yet
    // when: the content is built
    // then: the plan does not tell the resume to go read the log this checkpoint was meant to summarize
    const root = makeRoot('peaks-ckpt-noplan-');

    const content = buildCheckpointContent({ projectRoot: root, sessionId: SID });

    expect(content.currentPlan).toContain('No auto-compact decision recorded yet');
    expect(content.currentPlan).not.toBe('auto-compact in progress; resume from auto-decisions.md');
  });

  it('when many decisions are recorded, should bound what the checkpoint carries', () => {
    // given: more decisions than a resume can scan
    // when: the content is built
    // then: the newest are kept, and the list stays short
    const root = makeRoot('peaks-ckpt-bound-');
    writeDecisions(
      root,
      Array.from({ length: 12 }, (_, i) => ({ ts: `t${i}`, hint: `hint-${i}` }))
    );

    const content = buildCheckpointContent({ projectRoot: root, sessionId: SID });

    expect(content.recentDecisions.length).toBeLessThanOrEqual(5);
    expect(content.recentDecisions[0]).toContain('hint-11');
  });
});

describe('(integration) the real writer', () => {
  it('when a decision exists, should write a checkpoint whose fields are no longer all empty', () => {
    // given: a session with a decisions log and a request artifact
    // when: the checkpoint is written
    // then: the detector-readable fields carry real content
    const root = makeRoot('peaks-ckpt-write-');
    writeDecisions(root, [{ ts: 't1', ratio: '90.0%', hint: 'resume here', nextActions: 'x | y' }]);
    const requestsDir = join(root, '.peaks', '_runtime', SID, 'rd', 'requests');
    mkdirSync(requestsDir, { recursive: true });
    writeFileSync(join(requestsDir, '001-thing.md'), '# request\n', 'utf8');

    const path = writePreCompactCheckpoint({ projectRoot: root, sessionId: SID, now: new Date() });
    const content = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

    expect(content['currentPlan']).toContain('resume here');
    expect(content['openQuestions']).toEqual(['x', 'y']);
    expect((content['recentDecisions'] as string[]).length).toBeGreaterThan(0);
    expect((content['recentArtifactPaths'] as string[]).length).toBeGreaterThan(0);
  });

  it('when the red line fires, should say so in the plan and keep the red-line reason', () => {
    // given: a red-line checkpoint
    // when: it is written
    // then: the plan records that the harness was asked to compact, not that peaks-loop did it
    const root = makeRoot('peaks-ckpt-redline-');

    const path = writePreCompactCheckpoint({
      projectRoot: root,
      sessionId: SID,
      now: new Date(),
      redLine: true
    });
    const content = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

    expect(content['reason']).toBe('pre-compact-red-line');
    expect(content['currentPlan']).toContain('RED-LINE');
    expect(content['currentPlan']).toContain('not executed by peaks-loop');
  });
});
