import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

function readSkill(skillName: string): string {
  return readFileSync(join(process.cwd(), 'skills', skillName, 'SKILL.md'), 'utf8');
}

function readSection(content: string, heading: string): string {
  const start = content.indexOf(heading);
  expect(start).toBeGreaterThanOrEqual(0);

  const nextHeading = content.indexOf('\n## ', start + heading.length);
  return nextHeading === -1 ? content.slice(start) : content.slice(start, nextHeading);
}

function expectCodegraphGuardrails(section: string): void {
  expect(section).toContain('peaks codegraph');
  expect(section).toMatch(/untrusted supporting evidence|supporting evidence/);
  expect(section).toMatch(/mutate agent settings|settings mutation/);
  expect(section).toMatch(/commit `.codegraph\/` artifacts|persist generated `.codegraph\/` databases into git/);
  expect(section).not.toContain('npx @colbymchenry/codegraph');
  expect(section).not.toContain('codegraph install');
  expect(section).not.toContain('serve --mcp');
  expect(section).not.toContain('configure MCP');
}

describe('Codegraph skill analysis integration guidance', () => {
  test('peaks-rd uses codegraph as local project evidence while keeping RD gates authoritative', () => {
    const section = readSection(readSkill('peaks-rd'), '## Codegraph project analysis');

    expect(section).toContain('local project-analysis evidence');
    expect(section).toContain('red-line scope boundaries');
    expect(section).toContain('Peaks-Cli RD gates remain authoritative');
    expect(section).toContain('peaks codegraph affected --project <path> <changed-files...> --json');
    expectCodegraphGuardrails(section);
  });

  test('peaks-solo coordinates codegraph context without replacing role skills', () => {
    const section = readSection(readSkill('peaks-solo'), '## Codegraph orchestration context');

    expect(section).toContain('optional project-analysis enhancement');
    expect(section).toContain('role handoff');
    expect(section).toContain('Solo must not treat codegraph output as approval');
    expectCodegraphGuardrails(section);
  });

  test('peaks-txt consumes recorded codegraph context as supporting handoff evidence', () => {
    const section = readSection(readSkill('peaks-txt'), '## Codegraph context capsules');

    expect(section).toContain('supporting evidence');
    expect(section).toContain('.peaks/<session-id>/rd/codegraph-context.md');
    expect(section).toContain('Durable memory extraction still requires explicit authorization');
    expectCodegraphGuardrails(section);
  });

  test('peaks-qa uses affected output only for regression focus', () => {
    const section = readSection(readSkill('peaks-qa'), '## Codegraph regression focus');

    expect(section).toContain('regression-surface evidence');
    expect(section).toContain('External analysis cannot pass QA by itself');
    expect(section).toContain('peaks codegraph affected --project <path> <changed-files...> --json');
    expectCodegraphGuardrails(section);
  });
});
