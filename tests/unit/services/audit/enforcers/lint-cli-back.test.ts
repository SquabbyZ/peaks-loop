/**
 * Unit tests for P2-a Theme D — CLI-back gaps enforcers.
 *
 * The enforcers walk a skill body for `MANDATORY` / `BLOCKING` /
 * `MUST NOT` markers and report an orphan hit when the surrounding
 * ±2 lines do NOT name a `peaks *` CLI command.
 */
import { describe, it, expect } from 'vitest';
import {
  lintCliBackMandatorText,
  lintCliBackNoOrphanBlocking,
  lintCliBackNoOrphanMustNot,
} from '../../../../../src/services/audit/enforcers/lint-cli-back.js';
import type { SkillFile } from '../../../../../src/services/audit/enforcers/lint-style.js';

function makeSkill(body: string): SkillFile {
  return {
    name: 'peaks-test',
    path: 'skills/peaks-test/SKILL.md',
    body,
    lines: body.split(/\r?\n/),
  };
}

describe('lint-cli-back — Theme D', () => {
  it('passes when a MANDATORY marker is followed by a peaks * CLI reference', () => {
    const skill = makeSkill(`# peaks-test

Step 1 is MANDATORY — the LLM must run:

  peaks audit red-lines --json

before advancing.
`);
    expect(lintCliBackMandatorText(skill)).toEqual([]);
  });

  it('reports a hit for an orphan MANDATORY marker', () => {
    const skill = makeSkill(`# peaks-test

This is MANDATORY but has no peaks CLI in the surrounding text.
`);
    const hits = lintCliBackMandatorText(skill);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.catalogId).toBe('rl-cli-back-mandatory-text-001');
  });

  it('reports a hit for an orphan BLOCKING marker', () => {
    const skill = makeSkill(`# peaks-test

This is BLOCKING and references no CLI command in context.
`);
    const hits = lintCliBackNoOrphanBlocking(skill);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.catalogId).toBe('rl-cli-back-no-orphan-blocking-001');
  });

  it('reports a hit for an orphan MUST NOT marker', () => {
    const skill = makeSkill(`# peaks-test

The LLM MUST NOT skip the step but no CLI command backs it.
`);
    const hits = lintCliBackNoOrphanMustNot(skill);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.catalogId).toBe('rl-cli-back-no-orphan-must-not-001');
  });
});
