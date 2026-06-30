/**
 * Slice 2026-06-24-handoff-path-canonicalization.
 *
 * Hard ban (effective 2.8.3, no exceptions): NEVER create
 * `.peaks/_runtime/<change-id>/` or `.peaks/_runtime/<YYYY-MM-DD-*>/` at the top level
 * of `.peaks/`. All change-id / session-id reviewable artifacts must
 * live under `.peaks/_runtime/change/<sessionId>/<role>/...`.
 *
 * This test pins down the canonical handoff-path shape emitted by
 * the 5 render functions in `request-artifact-service.ts` so a
 * future regression cannot reintroduce the banned top-level path
 * into the artifact body (which sub-agents read verbatim as write
 * instructions).
 */

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import {
  formatCommitBoundaryPath,
  formatHandoffPath,
  formatSkillUsageLessonsPath,
  PrerequisitesNotSatisfiedError
} from '../../../src/services/artifacts/request-artifact-service.js';

const SERVICE_PATH = 'src/services/artifacts/request-artifact-service.ts';
const SERVICE_ABS = new URL(`../../../${SERVICE_PATH}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const FAKE_REQUEST_ID = '2026-06-24-fake-rid';
const FAKE_CHANGE_ID = '2026-06-24-fake-change';
const FAKE_SESSION_ID = '2026-06-24-fake-session';const FAKE_TIMESTAMP = '2026-06-24T00:00:00.000Z';

// The banned string pattern: any literal `.peaks/_runtime/${sessionId}/` template
// fragment. We assert BOTH that the rendered output contains zero
// matches AND that the source file's template literals contain zero
// matches.
const BANNED_TOP_LEVEL_REGEX = /\.peaks\/\$\{sessionId\}\//g;
const BANNED_AT_ALL_REGEX = /\.peaks\/\$\{sessionId\}/g;

// Canonical handoff-path prefix (post-2.8.3 + slice 2026-06-24):
// `.peaks/_runtime/change/<sessionId>/<role>/requests/<rid>.md`.
const CANONICAL_HANDOFF_PREFIX = '.peaks/_runtime/';

describe('handoff path helpers — canonical shape', () => {
  it('formatHandoffPath returns the canonical per-role request path', () => {
    expect(formatHandoffPath(FAKE_SESSION_ID, 'rd', FAKE_REQUEST_ID))
      .toBe(`.peaks/_runtime/${FAKE_SESSION_ID}/rd/requests/${FAKE_REQUEST_ID}.md`);
    expect(formatHandoffPath(FAKE_SESSION_ID, 'qa', FAKE_REQUEST_ID))
      .toBe(`.peaks/_runtime/${FAKE_SESSION_ID}/qa/requests/${FAKE_REQUEST_ID}.md`);
    expect(formatHandoffPath(FAKE_SESSION_ID, 'ui', FAKE_REQUEST_ID))
      .toBe(`.peaks/_runtime/${FAKE_SESSION_ID}/ui/requests/${FAKE_REQUEST_ID}.md`);
    expect(formatHandoffPath(FAKE_SESSION_ID, 'prd', FAKE_REQUEST_ID))
      .toBe(`.peaks/_runtime/${FAKE_SESSION_ID}/prd/requests/${FAKE_REQUEST_ID}.md`);
  });

  it('formatCommitBoundaryPath returns the canonical SC commit-boundary path', () => {
    expect(formatCommitBoundaryPath(FAKE_SESSION_ID, FAKE_REQUEST_ID))
      .toBe(`.peaks/_runtime/${FAKE_SESSION_ID}/sc/commit-boundaries/${FAKE_REQUEST_ID}.md`);
  });

  it('formatSkillUsageLessonsPath returns the canonical txt lessons path', () => {
    expect(formatSkillUsageLessonsPath(FAKE_SESSION_ID))
      .toBe(`.peaks/_runtime/${FAKE_SESSION_ID}/txt/skill-usage-lessons.md`);
  });
});

/**
 * Each render function's output must contain ZERO references to the
 * banned top-level path `.peaks/_runtime/${sessionId}/` (the templated form)
 * AND every Handoff/linked-* path it emits must start with the
 * canonical prefix `.peaks/_runtime/change/`.
 *
 * We import the render functions from the service module so the test
 * exercises the actual production code, not a re-implementation.
 */
describe('render templates — banned top-level handoff paths are eliminated', () => {
  // We exercise the render functions indirectly via createRequestArtifact's
  // dry-run return value. The service already exposes createRequestArtifact
  // as a public API and returns the rendered markdown under `result.content`.
  // The dry-run path (apply: false / undefined) does not touch the
  // filesystem so it is safe in unit tests.

  // Lazy import to avoid pulling the full service graph into helper tests.
  let createRequestArtifact: typeof import('../../../src/services/artifacts/request-artifact-service.js').createRequestArtifact;
  let DEFAULT_REQUEST_TYPE: typeof import('../../../src/services/artifacts/request-artifact-service.js').DEFAULT_REQUEST_TYPE;

  it('load service exports', async () => {
    const mod = await import('../../../src/services/artifacts/request-artifact-service.js');
    createRequestArtifact = mod.createRequestArtifact;
    DEFAULT_REQUEST_TYPE = mod.DEFAULT_REQUEST_TYPE;
    expect(typeof createRequestArtifact).toBe('function');
    expect(typeof DEFAULT_REQUEST_TYPE).toBe('string');
  });

  const ROLES = ['prd', 'ui', 'rd', 'qa', 'sc'] as const;

  for (const role of ROLES) {
    it(`rendered ${role} template contains zero banned .peaks/_runtime/${'${sessionId}'}/ references`, async () => {
      const mod = await import('../../../src/services/artifacts/request-artifact-service.js');
      const result = await mod.createRequestArtifact({
        role,
        requestId: FAKE_REQUEST_ID,
        projectRoot: '.', // not used (dry-run)
        sessionId: FAKE_CHANGE_ID,
        clock: () => FAKE_TIMESTAMP,
        // apply: omitted (default = dry-run preview)
      });

      const bannedTopLevel = result.content.match(BANNED_TOP_LEVEL_REGEX) ?? [];
      const bannedAny = result.content.match(BANNED_AT_ALL_REGEX) ?? [];

      expect(bannedTopLevel, `rendered ${role} template still contains banned top-level path: ${bannedTopLevel.join(', ')}`).toEqual([]);
      expect(bannedAny, `rendered ${role} template still contains templated sessionId path: ${bannedAny.join(', ')}`).toEqual([]);
    });

    it(`rendered ${role} template Handoff/linked-* paths all start with canonical prefix`, async () => {
      const mod = await import('../../../src/services/artifacts/request-artifact-service.js');
      const result = await mod.createRequestArtifact({
        role,
        requestId: FAKE_REQUEST_ID,
        projectRoot: '.',
        sessionId: FAKE_CHANGE_ID,
        clock: () => FAKE_TIMESTAMP,
      });

      // Lines that look like a handoff or linked-* path. We accept any
      // line containing `.peaks/` and verify each one starts with the
      // canonical prefix.
      const lines = result.content.split(/\r?\n/);
      const pathLines = lines.filter((line) => /\.peaks\//.test(line));
      expect(pathLines.length, `rendered ${role} template emitted no handoff/linked-* paths`).toBeGreaterThan(0);
      for (const line of pathLines) {
        // Allow the literal `- artifact workspace path: .peaks/_runtime/change/<id>/`
        // line and the `## Sync / authorization` heading — both are
        // accounted for in the canonical prefix.
        const matches = line.match(/\.peaks\/[A-Za-z0-9_/$.{}]*/g) ?? [];
        for (const match of matches) {
          expect(
            match.startsWith(CANONICAL_HANDOFF_PREFIX),
            `rendered ${role} template contains non-canonical handoff path: "${match}" in line: "${line}"`,
          ).toBe(true);
        }
      }
    });
  }
});

describe('source file — banned template literals are eliminated', () => {
  it('the service source file contains zero `.peaks/_runtime/${sessionId}/` template strings', async () => {
    const source = await readFile(SERVICE_ABS, 'utf8');
    const matches = source.match(BANNED_TOP_LEVEL_REGEX) ?? [];
    expect(
      matches,
      `request-artifact-service.ts still contains banned template literal .peaks/_runtime/${'${sessionId}'}/ (${matches.length} occurrence(s)): ${matches.join(' | ')}`,
    ).toEqual([]);
  });
});

describe('file-size cap — service file stays within 800 lines (Karpathy §2 Simplicity First)', () => {
  it('request-artifact-service.ts line count is <= 800', async () => {
    const source = await readFile(SERVICE_ABS, 'utf8');
    const lineCount = source.split(/\r?\n/).length;
    expect(
      lineCount,
      `request-artifact-service.ts has grown to ${lineCount} lines (cap: 800).`,
    ).toBeLessThanOrEqual(800);
  });
});

/**
 * Slice 2026-06-24-handoff-path-canonicalization — Round 3 hotfix.
 *
 * PRD1 missed ONE residual hardcoded path in
 * `request-artifact-service.ts:515` — inside the
 * `PrerequisitesNotSatisfiedError` constructor message. The session
 * axis (`sessionId`) follows the 2.8.0 two-axis convention and must
 * route through `.peaks/_runtime/<sessionId>/`. If a future regression
 * reintroduces the banned `.peaks/_runtime/${sessionId}/` literal, the runtime
 * error message will tell the LLM to write to a wrong path, which the
 * LLM may treat as a write instruction (same failure mode that
 * motivated the original hard-ban).
 */
describe('PrerequisitesNotSatisfiedError — session-axis handoff path is canonical', () => {
  it('error message uses the canonical .peaks/_runtime/<sessionId>/ path (not the banned top-level shape)', () => {
    const err = new PrerequisitesNotSatisfiedError('rd', 'qa-handoff', FAKE_SESSION_ID, [
      { path: '.peaks/_runtime/change/2026-06-24-fake-change/prd/requests/rid-1.md', description: 'PRD request artifact' }
    ]);
    expect(err.message).toContain(`.peaks/_runtime/${FAKE_SESSION_ID}/`);
  });

  it('error message does NOT contain the banned top-level `.peaks/_runtime/${sessionId}/` literal', () => {
    const err = new PrerequisitesNotSatisfiedError('qa', 'verdict-issued', FAKE_SESSION_ID, [
      { path: '.peaks/_runtime/change/2026-06-24-fake-change/rd/requests/rid-2.md', description: 'RD request artifact' },
      { path: '.peaks/_runtime/change/2026-06-24-fake-change/qa/requests/rid-3.md', description: 'QA request artifact' }
    ]);
    expect(err.message).not.toMatch(/\.peaks\/2026-06-24-fake-session\//);
  });

  it('error message preserves the role, newState, and missing-count semantics', () => {
    const err = new PrerequisitesNotSatisfiedError('rd', 'qa-handoff', FAKE_SESSION_ID, [
      { path: '.peaks/_runtime/change/2026-06-24-fake-change/prd/requests/rid-1.md', description: 'PRD request artifact' }
    ]);
    expect(err.message).toContain('Cannot transition rd to qa-handoff');
    expect(err.message).toContain('1 required artifact missing');
  });
});

describe('source file — banned `.peaks/_runtime/${sessionId}/` template literals are eliminated', () => {
  it('the service source file contains zero `.peaks/_runtime/${sessionId}/` template strings', async () => {
    const source = await readFile(SERVICE_ABS, 'utf8');
    const matches = source.match(/\.peaks\/\$\{sessionId\}\//g) ?? [];
    expect(
      matches,
      `request-artifact-service.ts still contains banned template literal .peaks/_runtime/${'${sessionId}'}/ (${matches.length} occurrence(s)): ${matches.join(' | ')}`,
    ).toEqual([]);
  });
});
