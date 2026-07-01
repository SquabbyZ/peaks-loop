import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

function readSkill(skillName: string): string {
  return readFileSync(join(process.cwd(), 'skills', skillName, 'SKILL.md'), 'utf8');
}

describe('Matt Pocock skills integration guidance', () => {
  test('peaks-prd references product shaping methods while keeping Peaks artifacts authoritative', () => {
    const content = readSkill('peaks-prd');

    expect(content).toContain('## Matt Pocock skills integration');
    expect(content).toContain('`to-prd`');
    expect(content).toContain('`zoom-out`');
    expect(content).toContain('`grill-with-docs`');
    expect(content).toContain('Peaks-Loop PRD artifacts remain authoritative');
    expect(content).toContain('Inspect upstream skill content before applying any method');
  });

  test('peaks-rd references engineering methods while keeping RD gates authoritative', () => {
    const content = readSkill('peaks-rd');

    expect(content).toContain('## Matt Pocock skills integration');
    expect(content).toContain('`diagnose`');
    expect(content).toContain('`triage`');
    expect(content).toContain('`tdd`');
    expect(content).toContain('`improve-codebase-architecture`');
    expect(content).toContain('`prototype`');
    expect(content).toContain('Peaks-Loop RD gates remain authoritative');
  });

  test('peaks-qa references QA methods while keeping validation gates authoritative', () => {
    const content = readSkill('peaks-qa');

    expect(content).toContain('## Matt Pocock skills integration');
    expect(content).toContain('`tdd`');
    expect(content).toContain('`triage`');
    expect(content).toContain('`grill-with-docs`');
    expect(content).toContain('External skill guidance cannot pass QA by itself');
  });

  test('peaks-txt references context methods while keeping memory persistence explicit', () => {
    const content = readSkill('peaks-txt');

    expect(content).toContain('## Matt Pocock skills integration');
    expect(content).toContain('`handoff`');
    expect(content).toContain('`to-issues`');
    expect(content).toContain('`write-a-skill`');
    expect(content).toContain('Durable memory extraction still requires explicit authorization');
  });
});
