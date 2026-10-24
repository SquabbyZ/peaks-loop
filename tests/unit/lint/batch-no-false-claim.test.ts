/**
 * tests/unit/lint/batch-no-false-claim.test.ts
 *
 * Two guards for the rules this batch's own review enforces: a comment must not
 * claim a distinction the code does not make, and a newly added module must not
 * swallow a failed read.
 *
 * WHY A GUARD AND NOT A REVIEWER'S EYE. Neither defect is visible to a static
 * scan. The repository's silent-warning detector does not see a catch that
 * returns an empty list, and no detector reads a comment for the truth of the
 * distinction it asserts. So both are pinned here against the BEHAVIOUR the
 * claim describes: the two ways a settings file can fail to parse must produce
 * two different details, and an artifact directory that cannot be read must be
 * refused rather than reported as empty.
 *
 * The two modules under the guard: the comparator that names what differs in a
 * generated settings file (`src/services/workspace/generated-artifacts-content.ts`)
 * and the reader that walks a session's claim table, in the scan services.
 *
 * Dimensions:
 *   - render:      the drift detail the reader gets
 *   - behavior:    the two parse failures are told apart; a failed read is refused
 *   - integration: a real settings file and a real session tree on disk
 *   - a11y:        the refusal names the directory it could not read
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { compareGeneratedArtifactContent } from '~/src/services/workspace/generated-artifacts-content';
import {
  listSessionRdArtifactIds,
  readRidChangeClaims
} from '~/src/services/scan/rid-change-claims';

declareDimensions('tests/unit/lint/batch-no-false-claim.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

const SESSION_ID = '2026-10-24-batch-guard';
const SETTINGS_REL = '.claude/settings.local.json';
const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

/** A temporary project root, removed after the test. */
function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-batch-guard-'));
  roots.push(root);
  return root;
}

/** A project whose generated settings file carries exactly `content`. */
function projectWithSettings(content: string): string {
  const root = makeRoot();
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, SETTINGS_REL), content, 'utf8');
  return root;
}

/** The one drift detail the settings file earns. */
function driftDetail(content: string): string {
  const status = compareGeneratedArtifactContent(projectWithSettings(content), [SETTINGS_REL]);
  expect(status.drifted).toBe(true);
  return status.drifts[0]?.detail ?? '';
}

/** The session's RD request directory. */
function requestsDir(root: string): string {
  return join(root, '.peaks', '_runtime', SESSION_ID, 'rd', 'requests');
}

/** A session tree whose `requests` path is a FILE, so it cannot be listed. */
function projectWithUnreadableRequests(): string {
  const root = makeRoot();
  mkdirSync(join(root, '.peaks', '_runtime', SESSION_ID, 'rd'), { recursive: true });
  writeFileSync(
    join(root, '.peaks', '_runtime', SESSION_ID, 'rd', 'requests'),
    'not a directory',
    'utf8'
  );
  return root;
}

describe('Scenario: render — the drift detail the reader gets', () => {
  it('when the settings file is not JSON at all, should say the file is not valid JSON', () => {
    // given: a generated settings file whose bytes are not JSON
    // when: the drift against the current template is named
    // then: the detail says the file is not valid JSON
    const detail = driftDetail('{ not json');

    expect(detail).toBe('the file is not valid JSON');
  });

  it('when the settings file is JSON but not an object, should say the file is not a JSON object', () => {
    // given: a generated settings file whose bytes are JSON but an array
    // when: the drift against the current template is named
    // then: the detail says the file is not a JSON object
    const detail = driftDetail('[]');

    expect(detail).toBe('the file is not a JSON object');
  });
});

describe('Scenario: behavior — the two parse failures are told apart', () => {
  it('when the settings file fails to parse two different ways, should report two different details', () => {
    // given: the two ways a settings file can fail to parse
    // when: each one is named
    // then: the two details differ — the code discriminates, as its own claim says
    const notJson = driftDetail('{ not json');
    const notAnObject = driftDetail('[]');

    expect(notJson).not.toBe(notAnObject);
  });
});

describe('Scenario: behavior — a failed read is refused, not swallowed', () => {
  it('when the artifact directory cannot be read, should refuse rather than report no artifacts', () => {
    // given: a session whose RD request directory cannot be listed
    // when: the session's artifact ids and claim table are read
    // then: both refuse — neither of them reports an empty table
    const root = projectWithUnreadableRequests();

    expect(() => listSessionRdArtifactIds(root, SESSION_ID)).toThrow(
      /cannot read the RD artifact directory/
    );
    expect(() => readRidChangeClaims(root, SESSION_ID)).toThrow(
      /cannot read the RD artifact directory/
    );
  });

  it('when the artifact directory holds an artifact, should still read it', () => {
    // given: a session whose RD request directory lists one artifact
    // when: the session's artifact ids are read
    // then: the artifact is found — the refusal does not fire on a readable directory
    const root = makeRoot();
    mkdirSync(requestsDir(root), { recursive: true });
    writeFileSync(join(requestsDir(root), '001-rid-a.md'), '# RD Request\n', 'utf8');

    expect(listSessionRdArtifactIds(root, SESSION_ID)).toEqual(['rid-a']);
  });
});

describe('Scenario: a11y — the refusal is actionable', () => {
  it('when the artifact directory cannot be read, should name the directory it could not read', () => {
    // given: a session whose RD request directory cannot be listed
    // when: the refusal is read
    // then: it names the directory, so a reader can act on it
    const root = projectWithUnreadableRequests();

    let message = '';
    try {
      listSessionRdArtifactIds(root, SESSION_ID);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain(requestsDir(root));
  });
});
