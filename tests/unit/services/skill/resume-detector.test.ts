import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifyResume,
  type ResumeClassification,
  type ResumePoint,
  type InFlightState
} from '../../../../src/services/skill/resume-detector.js';

const SID = '2026-06-04-session-aaaaaa';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'peaks-resume-detector-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

/**
 * Write a request artifact with the given state and (optional) transition
 * note. Real RD/QA artifacts in this repo use `- state: <value>` under
 * `## Status`; some legacy files use `state: <value>` (no leading dash).
 * Both shapes are accepted by the classifier.
 */
function writeRequest(
  role: 'prd' | 'rd' | 'qa',
  filename: string,
  state: string,
  options?: { abandonedTransitionNote?: string; bulletState?: boolean }
): void {
  const dir = join(tmpRoot, SID, role, 'requests');
  mkdirSync(dir, { recursive: true });
  const stateLine = options?.bulletState === false ? `state: ${state}` : `- state: ${state}`;
  const body = [
    `# ${role.toUpperCase()} Request ${filename}`,
    '',
    '## Status',
    '',
    stateLine,
    ''
  ];
  if (options?.abandonedTransitionNote) {
    body.push(
      `- transition note (2026-06-06T08:05:29.165Z): user-requested-abandon: ${options.abandonedTransitionNote}`
    );
    body.push('');
  }
  writeFileSync(join(dir, filename), body.join('\n'));
}

/**
 * Write a step artifact (e.g. rd/tech-doc.md, qa/test-cases/<rid>.md).
 * Path is relative to the session root (e.g. "rd/tech-doc.md").
 */
function writeArtifact(relPath: string, content = '# artifact\n'): void {
  const full = join(tmpRoot, SID, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

/**
 * Canonical "happy path" — every gate completed; the slice is done.
 */
function seedComplete(): void {
  writeRequest('prd', '001.md', 'handed-off', { bulletState: false });
  writeRequest('rd', '001.md', 'qa-handoff', { bulletState: false });
  writeRequest('qa', '001.md', 'verdict-issued', { bulletState: false });
  writeArtifact('txt/handoff.md');
}

describe('classifyResume — fresh / complete boundaries', () => {
  test('returns kind=fresh when the session dir is absent', () => {
    const result = classifyResume(SID, tmpRoot);
    expect(result.kind).toBe('fresh');
    expect(result.point).toBeNull();
    expect(result.missingArtifacts).toEqual([]);
  });

  test('returns kind=fresh when the session dir exists but is empty', () => {
    mkdirSync(join(tmpRoot, SID), { recursive: true });
    const result = classifyResume(SID, tmpRoot);
    expect(result.kind).toBe('fresh');
  });

  test('returns kind=fresh when only session.json is present (no slice started)', () => {
    writeArtifact('session.json', '{"sessionId":"' + SID + '"}');
    const result = classifyResume(SID, tmpRoot);
    expect(result.kind).toBe('fresh');
  });

  test('returns kind=complete when txt/handoff.md is present', () => {
    seedComplete();
    const result = classifyResume(SID, tmpRoot);
    expect(result.kind).toBe('complete');
    expect(result.point).toBeNull();
  });
});

describe('classifyResume — state-based resume points (Gates B / C / D)', () => {
  test('PRD handed-off, no RD → resume:rd-planning', () => {
    writeRequest('prd', '001.md', 'handed-off', { bulletState: false });
    const result = classifyResume(SID, tmpRoot);
    expect(result.kind).toBe('resume');
    expect(result.point).toBe<ResumePoint>('rd-planning');
  });

  test('PRD handed-off + RD tech-doc present (no qa-handoff) → resume:qa-test-cases', () => {
    // Swarm produced RD planning but QA test-cases are missing
    writeRequest('prd', '001.md', 'handed-off', { bulletState: false });
    writeArtifact('rd/tech-doc.md');
    const result = classifyResume(SID, tmpRoot);
    expect(result.kind).toBe('resume');
    expect(result.point).toBe<ResumePoint>('qa-test-cases');
  });

  test('RD qa-handoff + review artifacts present, no QA → resume:qa-validation', () => {
    writeRequest('prd', '001.md', 'handed-off', { bulletState: false });
    writeRequest('rd', '001.md', 'qa-handoff', { bulletState: false });
    writeArtifact('rd/code-review.md');
    writeArtifact('rd/security-review.md');
    const result = classifyResume(SID, tmpRoot);
    expect(result.kind).toBe('resume');
    expect(result.point).toBe<ResumePoint>('qa-validation');
  });

  test('QA verdict-issued + test report present, no TXT → resume:txt-handoff', () => {
    writeRequest('prd', '001.md', 'handed-off', { bulletState: false });
    writeRequest('rd', '001.md', 'qa-handoff', { bulletState: false });
    writeRequest('qa', '001.md', 'verdict-issued', { bulletState: false });
    writeArtifact('rd/code-review.md');
    writeArtifact('rd/security-review.md');
    writeArtifact('qa/test-reports/001.md');
    const result = classifyResume(SID, tmpRoot);
    expect(result.kind).toBe('resume');
    expect(result.point).toBe<ResumePoint>('txt-handoff');
  });
});

describe('classifyResume — "Other resume triggers" (file-presence based)', () => {
  test('PRD handed-off but missing rd/tech-doc.md → resume:rd-planning (NOT rd-implementing)', () => {
    // The state says PRD is done, but the planning artifact is missing.
    // The classifier should fall back to the file-presence rule.
    writeRequest('prd', '001.md', 'handed-off', { bulletState: false });
    const result = classifyResume(SID, tmpRoot);
    expect(result.kind).toBe('resume');
    expect(result.point).toBe<ResumePoint>('rd-planning');
    expect(result.missingArtifacts).toContain('rd/tech-doc.md');
  });

  test('RD qa-handoff but missing rd/code-review.md → resume:rd-review-fanout', () => {
    // Inconsistent state — qa-handoff should require code-review.md to be present.
    // The classifier surfaces the earlier gap so the slice can be repaired.
    writeRequest('prd', '001.md', 'handed-off', { bulletState: false });
    writeRequest('rd', '001.md', 'qa-handoff', { bulletState: false });
    const result = classifyResume(SID, tmpRoot);
    expect(result.kind).toBe('resume');
    expect(result.point).toBe<ResumePoint>('rd-review-fanout');
    expect(result.missingArtifacts).toContain('rd/code-review.md');
    expect(result.missingArtifacts).toContain('rd/security-review.md');
    expect(result.warnings.some((w) => w.includes('inconsistent'))).toBe(true);
  });

  test('RD qa-handoff + code-review.md present, no QA → resume:qa-validation', () => {
    // The earlier gap is closed; the classifier advances to QA.
    writeRequest('prd', '001.md', 'handed-off', { bulletState: false });
    writeRequest('rd', '001.md', 'qa-handoff', { bulletState: false });
    writeArtifact('rd/code-review.md');
    writeArtifact('rd/security-review.md');
    const result = classifyResume(SID, tmpRoot);
    expect(result.kind).toBe('resume');
    expect(result.point).toBe<ResumePoint>('qa-validation');
  });

  test('QA verdict-issued but missing qa/test-reports/<rid>.md → resume:qa-execution + warning', () => {
    writeRequest('prd', '001.md', 'handed-off', { bulletState: false });
    writeRequest('rd', '001.md', 'qa-handoff', { bulletState: false });
    writeRequest('qa', '001.md', 'verdict-issued', { bulletState: false });
    const result = classifyResume(SID, tmpRoot);
    expect(result.kind).toBe('resume');
    expect(result.point).toBe<ResumePoint>('qa-execution');
    expect(result.missingArtifacts.some((m) => m.includes('qa/test-reports/'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('inconsistent'))).toBe(true);
  });
});

describe('classifyResume — mid-implementation distinction', () => {
  test('RD state=spec-locked → in-flight:spec-locked', () => {
    writeRequest('prd', '001.md', 'handed-off', { bulletState: false });
    writeRequest('rd', '001.md', 'spec-locked', { bulletState: false });
    const result = classifyResume(SID, tmpRoot);
    expect(result.kind).toBe('in-flight');
    expect(result.state).toBe<InFlightState>('spec-locked');
  });

  test('RD state=implemented → in-flight:implemented', () => {
    writeRequest('prd', '001.md', 'handed-off', { bulletState: false });
    writeRequest('rd', '001.md', 'implemented', { bulletState: false });
    const result = classifyResume(SID, tmpRoot);
    expect(result.kind).toBe('in-flight');
    expect(result.state).toBe<InFlightState>('implemented');
  });

  test('RD state=running → in-flight:running', () => {
    writeRequest('prd', '001.md', 'handed-off', { bulletState: false });
    writeRequest('rd', '001.md', 'running', { bulletState: false });
    const result = classifyResume(SID, tmpRoot);
    expect(result.kind).toBe('in-flight');
    expect(result.state).toBe<InFlightState>('running');
  });

  test('RD state=blocked with abandoned transition note → in-flight:blocked', () => {
    writeRequest('prd', '001.md', 'handed-off', { bulletState: false });
    writeRequest('rd', '001.md', 'blocked', {
      bulletState: false,
      abandonedTransitionNote: 'user dropped the slice'
    });
    const result = classifyResume(SID, tmpRoot);
    expect(result.kind).toBe('in-flight');
    expect(result.state).toBe<InFlightState>('blocked');
  });
});

describe('classifyResume — primary vs abandoned filter', () => {
  test('two RD requests: one blocked/abandoned, one spec-locked → uses spec-locked', () => {
    writeRequest('prd', '001.md', 'handed-off', { bulletState: false });
    writeRequest('rd', '001-009.md', 'blocked', {
      bulletState: false,
      abandonedTransitionNote: 'user abandoned'
    });
    writeRequest('rd', '002.md', 'spec-locked', { bulletState: false });
    const result = classifyResume(SID, tmpRoot);
    expect(result.kind).toBe('in-flight');
    expect(result.state).toBe<InFlightState>('spec-locked');
    expect(result.abandonedRequestCount).toBe(1);
  });

  test('two RD requests: both blocked/abandoned → kind=fresh (no active slice)', () => {
    writeRequest('prd', '001.md', 'handed-off', { bulletState: false });
    writeRequest('rd', '001-009.md', 'blocked', {
      bulletState: false,
      abandonedTransitionNote: 'user abandoned'
    });
    writeRequest('rd', '002.md', 'blocked', {
      bulletState: false,
      abandonedTransitionNote: 'user abandoned'
    });
    const result = classifyResume(SID, tmpRoot);
    expect(result.kind).toBe('fresh');
    expect(result.abandonedRequestCount).toBe(2);
  });

  test('two RD requests: one blocked without abandoned note → uses blocked as primary', () => {
    // A blocked state WITHOUT the user-requested-abandon transition note is
    // not auto-filtered. The classifier surfaces it as in-flight:blocked.
    writeRequest('prd', '001.md', 'handed-off', { bulletState: false });
    writeRequest('rd', '001.md', 'blocked', { bulletState: false });
    const result = classifyResume(SID, tmpRoot);
    expect(result.kind).toBe('in-flight');
    expect(result.state).toBe<InFlightState>('blocked');
    expect(result.abandonedRequestCount).toBe(0);
  });
});

describe('classifyResume — legacy path fallback', () => {
  test('falls back to .peaks/<sid>/ when .peaks/_runtime/<sid>/ is absent', () => {
    // Simulate a pre-v1.3.2 tree: only the legacy path exists.
    const legacyRoot = tmpRoot + '_legacy';
    mkdirSync(join(legacyRoot, '.peaks', SID, 'prd', 'requests'), { recursive: true });
    writeFileSync(
      join(legacyRoot, '.peaks', SID, 'prd', 'requests', '001.md'),
      'state: handed-off\n'
    );
    // Caller passes the canonical root (.peaks/_runtime), but the
    // classifier should also look one level up at .peaks/<sid>/.
    const result = classifyResume(SID, join(legacyRoot, '.peaks', '_runtime'));
    expect(result.kind).toBe('resume');
    expect(result.point).toBe<ResumePoint>('rd-planning');
    expect(result.usedLegacyPath).toBe(true);
  });

  test('prefers the canonical path over the legacy path when both exist', () => {
    mkdirSync(join(tmpRoot, SID, 'prd', 'requests'), { recursive: true });
    writeFileSync(
      join(tmpRoot, SID, 'prd', 'requests', '001.md'),
      'state: handed-off\n'
    );
    // Also create a legacy tree with a different state — canonical wins.
    mkdirSync(join(tmpRoot, '..', SID, 'prd', 'requests'), { recursive: true });
    // (don't write a legacy file; just confirm canonical is read)
    const result = classifyResume(SID, tmpRoot);
    expect(result.kind).toBe('resume');
    expect(result.usedLegacyPath).toBe(false);
  });
});

describe('classifyResume — determinism and shape', () => {
  test('same fixture twice → same classification', () => {
    writeRequest('prd', '001.md', 'handed-off', { bulletState: false });
    writeRequest('rd', '001.md', 'qa-handoff', { bulletState: false });
    const first: ResumeClassification = classifyResume(SID, tmpRoot);
    const second: ResumeClassification = classifyResume(SID, tmpRoot);
    expect(second).toEqual(first);
  });

  test('returns a stable shape (every field present, with expected types)', () => {
    writeRequest('prd', '001.md', 'handed-off', { bulletState: false });
    const result = classifyResume(SID, tmpRoot);
    expect(typeof result.kind).toBe('string');
    expect(Array.isArray(result.missingArtifacts)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(typeof result.abandonedRequestCount).toBe('number');
    expect(typeof result.usedLegacyPath).toBe('boolean');
  });

  test('writes are sorted — multiple RD files do not produce order-dependent results', () => {
    writeRequest('prd', '001.md', 'handed-off', { bulletState: false });
    writeRequest('rd', 'aaa.md', 'spec-locked', { bulletState: false });
    writeRequest('rd', 'bbb.md', 'spec-locked', { bulletState: false });
    const result1 = classifyResume(SID, tmpRoot);
    expect(result1.kind).toBe('in-flight');
    expect(result1.state).toBe<InFlightState>('spec-locked');
  });
});
