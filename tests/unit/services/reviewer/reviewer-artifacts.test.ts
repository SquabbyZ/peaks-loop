// Reviewer artifact producer: the session id is ONE directory segment under
// `.peaks/_runtime/`. `isUnsafePathInput` is a traversal guard, not a
// single-segment guard — it admits `a/b` — so the separator axes are pinned
// here, and no arm may create a directory before the refusal.

import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  writeReviewerArtifacts,
  type ReviewerArtifactPaths
} from '../../../../src/services/reviewer/reviewer-artifacts.js';
import type { ReviewerEnvelope } from '../../../../src/services/reviewer/reviewer-types.js';

const VALID_ENVELOPE: ReviewerEnvelope = {
  reviewerId: 'third-party-reviewer-v2.14.0',
  modelId: 'llama3.2:8b',
  modelFamily: 'llama',
  passed: true,
  violations: [],
  gateAction: 'allow',
  reason: 'no findings'
};

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'reviewer-artifacts-'));
});

function write(sessionId: string, rid = 'r1'): ReviewerArtifactPaths {
  return writeReviewerArtifacts({
    projectRoot,
    sessionId,
    rid,
    envelope: VALID_ENVELOPE
  });
}

describe('writeReviewerArtifacts — the session id must be a single path segment', () => {
  it('when the session id contains a forward slash, should throw and create no directory', () => {
    // given: an id that would nest the artifact under `_runtime/a/b/rd`
    // when:  the producer runs
    // then:  it refuses before mkdir and nothing lands under the project root
    expect(() => write('a/b')).toThrow('Invalid session id: a/b (must be a single path segment)');
    expect(existsSync(join(projectRoot, '.peaks'))).toBe(false);
  });

  it('when the session id contains a backslash, should throw and create no directory', () => {
    // given: the Windows separator axis
    // when:  the producer runs
    // then:  it refuses before mkdir
    expect(() => write('a\\b')).toThrow('Invalid session id: a\\b (must be a single path segment)');
    expect(existsSync(join(projectRoot, '.peaks'))).toBe(false);
  });

  it('when the session id is a traversal token, should throw and create no directory', () => {
    // given: the pre-existing `..` arm
    // when:  the producer runs
    // then:  it still refuses before mkdir
    expect(() => write('..')).toThrow('Invalid session id: .. (must be a single path segment)');
    expect(existsSync(join(projectRoot, '.peaks'))).toBe(false);
  });

  it('when the session id is a real single-segment id, should write both artifacts', () => {
    // given: the live session id shape
    // when:  the producer runs
    // then:  both siblings exist under `_runtime/<id>/rd/` and carry the envelope
    const paths = write('2026-10-18-session-dedff6');
    const rd = join(projectRoot, '.peaks', '_runtime', '2026-10-18-session-dedff6', 'rd');
    expect(paths.markdown).toBe(join(rd, 'third-party-review-r1.md'));
    expect(paths.json).toBe(join(rd, 'third-party-review-r1.json'));
    expect(readFileSync(paths.markdown, 'utf8')).toContain('modelFamily');
    expect(JSON.parse(readFileSync(paths.json, 'utf8'))).toEqual(VALID_ENVELOPE);
  });
});

describe('writeReviewerArtifacts — the rid is part of each filename', () => {
  it('writes one scoped pair per rid, so two slices in one session do not collide', () => {
    // given: two rids reviewed in ONE session
    // when:  the producer runs for each
    // then:  four files exist side by side, and each markdown names its own rid
    const sessionId = '2026-10-18-session-dedff6';
    const a = write(sessionId, 'rid-a');
    const b = write(sessionId, 'rid-b');
    const rd = join(projectRoot, '.peaks', '_runtime', sessionId, 'rd');

    expect(a.markdown).toBe(join(rd, 'third-party-review-rid-a.md'));
    expect(a.json).toBe(join(rd, 'third-party-review-rid-a.json'));
    expect(b.markdown).toBe(join(rd, 'third-party-review-rid-b.md'));
    expect(readFileSync(a.markdown, 'utf8')).toContain('rid-a');
    expect(readFileSync(b.markdown, 'utf8')).toContain('rid-b');
  });

  it('refuses a rid that does not match the request-id pattern before mkdir', () => {
    // given: a rid whose `..` segments would reach outside `rd/`
    // when:  the producer runs
    // then:  it refuses and creates no directory — the rid is now a filename
    expect(() => write('s1', '../../pwned')).toThrow(
      'Invalid request id: ../../pwned (expected letters, digits, dots, underscores, or dashes)'
    );
    expect(existsSync(join(projectRoot, '.peaks'))).toBe(false);
  });
});
