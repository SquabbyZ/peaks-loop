// tests/unit/final-review/final-review-evidence-sources.test.ts
//
// The two entries whose canonical location is rid-scoped — `rd-code-review` and
// `rd-security-review` — used to declare only their BARE, pre-rid-scoping path
// as `segments`. The write side and the `rd:qa-handoff` transition gate had both
// moved on (see CODE_REVIEW / AUDIT_SECURITY in
// src/services/artifacts/artifact-prerequisites.ts), so final-review was the one
// consumer still reading a location no producer writes. The visible symptom: a
// slice whose code review IS faithfully written to `rd/code-review-<rid>.md`
// still came back `no-new-bugs: inconclusive`.
//
// These tests pin the fix at both ends: the SOURCE TABLE declares the rid-scoped
// path canonically with the bare path as the legacy fallback, and `readEvidence`
// actually resolves to whichever of the two exists — reporting the path it read.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { baseEvidenceSources } from '~/src/services/final-review/final-review-evidence-sources';
import { readEvidence } from '~/src/services/final-review/final-review-evidence-collect';

const RID = 'rid-fixture-7a1c';
const SESSION_ID = '2026-10-12-session-fixture';

let tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
  tempRoots = [];
});

/** A project holding ONLY the session dir; the caller writes the one file it means to exist. */
function projectWith(segments: readonly string[], marker: string): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-fr-sources-'));
  tempRoots.push(root);
  const dir = join(root, '.peaks', '_runtime', SESSION_ID, ...segments.slice(0, -1));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, segments[segments.length - 1] as string), marker, 'utf8');
  return root;
}

/** The candidate for `key`, plus the bytes that were actually read for it. */
function resolved(root: string, key: string): { path: string; body: string; label: string } {
  const candidate = readEvidence(root, SESSION_ID, RID, false).find(
    (entry) => entry.source.key === key
  );
  if (candidate === undefined) throw new Error(`no source named ${key}`);
  return {
    path: candidate.relativePath,
    body: candidate.raw?.toString('utf8') ?? '',
    label: candidate.source.label
  };
}

function entry(key: string) {
  const source = baseEvidenceSources(RID).find((s) => s.key === key);
  if (source === undefined) throw new Error(`no source named ${key}`);
  return source;
}

describe('Scenario: final-review evidence sources — rid-scoped canonical paths', () => {
  it('when read, should declare the rid-scoped path canonically and the bare path as legacy', () => {
    // given: the source table for one rid
    // when:  the two rid-scoped entries are read
    // then:  each names its rid-scoped file first and its pre-scoping file second
    expect(entry('rd-code-review').segments).toEqual(['rd', `code-review-${RID}.md`]);
    expect(entry('rd-code-review').legacySegments).toEqual(['rd', 'code-review.md']);
    expect(entry('rd-security-review').segments).toEqual(['audit', `security-${RID}.md`]);
    expect(entry('rd-security-review').legacySegments).toEqual(['rd', `security-review-${RID}.md`]);
    expect(entry('rd-security-review').olderSegments).toEqual([['rd', 'security-review.md']]);
  });

  it('when the rid-scoped code review exists, should select and report it', () => {
    // given: only `rd/code-review-<rid>.md` on disk
    // when:  evidence is read
    // then:  that file is the one read, and the reported path names it
    const root = projectWith(['rd', `code-review-${RID}.md`], 'CANONICAL-CODE-REVIEW');
    const got = resolved(root, 'rd-code-review');
    expect(got.body).toBe('CANONICAL-CODE-REVIEW');
    expect(got.path).toBe(`.peaks/_runtime/${SESSION_ID}/rd/code-review-${RID}.md`);
  });

  it('when only the bare code review exists, should fall back to the legacy path and report it', () => {
    // given: only the pre-rid-scoping `rd/code-review.md` on disk
    // when:  evidence is read
    // then:  the legacy file is the one read, and the reported path names the file read
    const root = projectWith(['rd', 'code-review.md'], 'LEGACY-CODE-REVIEW');
    const got = resolved(root, 'rd-code-review');
    expect(got.body).toBe('LEGACY-CODE-REVIEW');
    expect(got.path).toBe(`.peaks/_runtime/${SESSION_ID}/rd/code-review.md`);
  });

  it('when both code review locations exist, should prefer the rid-scoped one', () => {
    // given: both `rd/code-review-<rid>.md` and the bare legacy file on disk
    // when:  evidence is read
    // then:  the canonical file wins — a legacy copy never shadows it
    const canonical = projectWith(['rd', `code-review-${RID}.md`], 'CANONICAL');
    const dir = join(canonical, '.peaks', '_runtime', SESSION_ID, 'rd');
    writeFileSync(join(dir, 'code-review.md'), 'LEGACY-SHADOW', 'utf8');
    const got = resolved(canonical, 'rd-code-review');
    expect(got.body).toBe('CANONICAL');
    expect(got.path).toBe(`.peaks/_runtime/${SESSION_ID}/rd/code-review-${RID}.md`);
  });

  it('when the independent security audit exists, should select it and label it as an audit', () => {
    // given: only `audit/security-<rid>.md` on disk — the peaks-security-audit output
    // when:  evidence is read
    // then:  that file is read, reported under its own path, and labelled as an audit
    const root = projectWith(['audit', `security-${RID}.md`], 'INDEPENDENT-AUDIT');
    const got = resolved(root, 'rd-security-review');
    expect(got.body).toBe('INDEPENDENT-AUDIT');
    expect(got.path).toBe(`.peaks/_runtime/${SESSION_ID}/audit/security-${RID}.md`);
    expect(got.label).toContain('audit');
  });

  it('when only the legacy RD security review exists, should fall back to it and report it', () => {
    // given: only the v2.11.x `rd/security-review.md` on disk
    // when:  evidence is read
    // then:  the legacy file is the one read, and the reported path names the file read
    const root = projectWith(['rd', 'security-review.md'], 'LEGACY-RD-SECURITY');
    const got = resolved(root, 'rd-security-review');
    expect(got.body).toBe('LEGACY-RD-SECURITY');
    expect(got.path).toBe(`.peaks/_runtime/${SESSION_ID}/rd/security-review.md`);
    // The label covers the legacy producer too — it may not read as audit-only.
    expect(got.label).toContain('RD');
  });
});
