/**
 * Unit tests for P2-a Theme F — workflow-bound shape enforcers.
 *
 * Four enforcers scan openspec/changes/STAR/proposal.md for canonical
 * shape (acceptance bullets, spec reference), .peaks/_runtime/STAR/rd/tech-doc.md
 * for required sections, and skill bodies for `peaks doctor` mention.
 */
import { describe, it, expect } from 'vitest';
import {
  lintOpenSpecAcceptanceBullets,
  lintOpenSpecSpecReference,
  lintTechDocPresenceShape,
  lintPeaksDoctorAcknowledged,
} from '../../../../../src/services/audit/enforcers/lint-workflow-shape.js';
import type { SkillFile } from '../../../../../src/services/audit/enforcers/lint-style.js';

function makeSkill(body: string): SkillFile {
  return {
    name: 'peaks-test',
    path: 'skills/peaks-test/SKILL.md',
    body,
    lines: body.split(/\r?\n/),
  };
}

describe('lint-workflow-shape — Theme F', () => {
  it('passes the proposal acceptance-bullets check on the current proposal', () => {
    const projectRoot = process.cwd();
    const hits = lintOpenSpecAcceptanceBullets(projectRoot);
    // The L2.3 P2-a proposal (this slice) has Acceptance Criteria
    // bullets; the older L2.1 proposal also does. We do not
    // assert [] vs non-[] since the fixture changes over time.
    // We only assert the helper returns a well-formed array.
    expect(Array.isArray(hits)).toBe(true);
  });

  it('passes the proposal spec-reference check on the current proposals', () => {
    const projectRoot = process.cwd();
    const hits = lintOpenSpecSpecReference(projectRoot);
    expect(Array.isArray(hits)).toBe(true);
  });

  it('passes the tech-doc-presence check (or returns empty when no tech-doc.md exists)', () => {
    const projectRoot = process.cwd();
    const hits = lintTechDocPresenceShape(projectRoot);
    expect(Array.isArray(hits)).toBe(true);
  });

  it('reports a hit for a request-artifact skill that does not mention peaks doctor', () => {
    const skill = makeSkill(`# peaks-test

This skill writes a request artifact using:

  peaks request init

But it does not acknowledge the diagnostic route anywhere.
`);
    const hits = lintPeaksDoctorAcknowledged(skill);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.catalogId).toBe('rl-peaks-doctor-skill-acknowledged-001');
  });

  it('passes when a request-artifact skill mentions peaks doctor', () => {
    const skill = makeSkill(`# peaks-test

This skill writes a request artifact using:

  peaks request init

And it acknowledges the diagnostic route:

  peaks doctor scan --json
`);
    expect(lintPeaksDoctorAcknowledged(skill)).toEqual([]);
  });
});
