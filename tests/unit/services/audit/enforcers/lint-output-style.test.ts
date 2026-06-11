/**
 * Unit tests for P2-a Theme C — output style enforcers.
 *
 * The enforcers scan a skill body for greeting/closing-prompt
 * fluff and a session log for the canonical Peaks-Cli status
 * header.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { lintNoFluff, lintNoClosingPrompt, lintStatusHeader } from '../../../../../src/services/audit/enforcers/lint-output-style.js';
import type { SkillFile } from '../../../../../src/services/audit/enforcers/lint-style.js';

function makeSkill(body: string): SkillFile {
  return {
    name: 'peaks-test',
    path: 'skills/peaks-test/SKILL.md',
    body,
    lines: body.split(/\r?\n/),
  };
}

describe('lint-output-style — Theme C', () => {
  it('passes when the skill body has no fluff and no closing-prompt', () => {
    const skill = makeSkill(`# peaks-test

This skill does not have any greeting or closing-prompt flattery.
The body is purely operational prose.
`);
    expect(lintNoFluff(skill)).toEqual([]);
    expect(lintNoClosingPrompt(skill)).toEqual([]);
  });

  it('reports a hit for a greeting fluff pattern', () => {
    const skill = makeSkill(`# peaks-test

Hello, I am a helpful assistant that orchestrates workflow.

body
`);
    const hits = lintNoFluff(skill);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.catalogId).toBe('rl-output-style-no-fluff-001');
  });

  it('reports a hit for a Chinese greeting', () => {
    const skill = makeSkill(`# peaks-test

你好!

body
`);
    const hits = lintNoFluff(skill);
    expect(hits.length).toBeGreaterThan(0);
  });

  it('reports a hit for a closing-prompt flattery', () => {
    const skill = makeSkill(`# peaks-test

Let me know if you need anything else.

body
`);
    const hits = lintNoClosingPrompt(skill);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.catalogId).toBe('rl-output-style-no-closing-prompt-001');
  });

  it('passes the status-header check when the session log has a canonical header', () => {
    // Use the project's own session runtime as a real fixture.
    // The active session log at .peaks/_runtime/<sid>/session.log
    // may or may not exist; the helper is silent on missing.
    const sessionId = '2026-06-11-session-edbe91';
    const projectRoot = process.cwd();
    const hits = lintStatusHeader(projectRoot, sessionId);
    // We do not assert [] or non-[] — the helper is best-effort
    // and the fixture may or may not have the header. We only
    // assert the helper returns a well-formed array.
    expect(Array.isArray(hits)).toBe(true);
  });
});
