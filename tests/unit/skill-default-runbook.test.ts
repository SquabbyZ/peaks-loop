import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const SKILLS_ROOT = join(process.cwd(), 'skills');

const ROLE_SKILLS: Array<{ name: string; minPeaksCommands: number; mustReferenceArtifact: boolean }> = [
  { name: 'peaks-prd', minPeaksCommands: 4, mustReferenceArtifact: true },
  { name: 'peaks-ui', minPeaksCommands: 4, mustReferenceArtifact: true },
  { name: 'peaks-rd', minPeaksCommands: 8, mustReferenceArtifact: true },
  { name: 'peaks-qa', minPeaksCommands: 6, mustReferenceArtifact: true }
];

const ORCHESTRATOR_SKILLS: Array<{ name: string; minPeaksCommands: number }> = [
  { name: 'peaks-solo', minPeaksCommands: 12 }
];

function extractRunbookSection(body: string): string | null {
  const match = /## Default runbook\n+([\s\S]*?)(?=\n## |$)/.exec(body);
  return match === null ? null : (match[1] ?? null);
}

function countPeaksCommandLines(section: string): number {
  const lines = section.split(/\r?\n/);
  return lines.filter((line) => /^\s*peaks\s+\w/.test(line)).length;
}

describe('audit: role skills expose a Default runbook with peaks CLI commands', () => {
  for (const { name, minPeaksCommands, mustReferenceArtifact } of ROLE_SKILLS) {
    test(`${name} SKILL.md declares a Default runbook section`, async () => {
      const body = await readFile(join(SKILLS_ROOT, name, 'SKILL.md'), 'utf8');

      expect(body).toMatch(/## Default runbook/);
      const section = extractRunbookSection(body);
      expect(section).not.toBeNull();
    });

    test(`${name} Default runbook lists at least ${minPeaksCommands} peaks CLI command invocations`, async () => {
      const body = await readFile(join(SKILLS_ROOT, name, 'SKILL.md'), 'utf8');
      const section = extractRunbookSection(body) ?? '';

      const count = countPeaksCommandLines(section);
      expect.soft(count, `${name} runbook has ${count} peaks commands; expected at least ${minPeaksCommands}`).toBeGreaterThanOrEqual(minPeaksCommands);
    });

    if (mustReferenceArtifact) {
      test(`${name} Default runbook invokes peaks request init for the per-request artifact`, async () => {
        const body = await readFile(join(SKILLS_ROOT, name, 'SKILL.md'), 'utf8');
        const section = extractRunbookSection(body) ?? '';

        const role = name.replace(/^peaks-/, '');
        expect(section).toMatch(new RegExp(`peaks request init --role ${role}`));
      });
    }
  }
});

describe('audit: role runbooks reference cross-cutting CLI surfaces consistently', () => {
  test('RD runbook references openspec, codegraph, and standards CLI commands', async () => {
    const body = await readFile(join(SKILLS_ROOT, 'peaks-rd', 'SKILL.md'), 'utf8');
    const section = extractRunbookSection(body) ?? '';

    expect.soft(section).toMatch(/peaks openspec/);
    expect.soft(section).toMatch(/peaks codegraph/);
    expect.soft(section).toMatch(/peaks standards/);
  });

  test('QA runbook references openspec validate and the chrome-devtools-mcp install path', async () => {
    const body = await readFile(join(SKILLS_ROOT, 'peaks-qa', 'SKILL.md'), 'utf8');
    const section = extractRunbookSection(body) ?? '';

    expect.soft(section).toMatch(/peaks openspec validate/);
    expect.soft(section).toMatch(/peaks mcp apply --capability chrome-devtools-mcp\.browser-debug/);
  });

  test('UI runbook references the chrome-devtools-mcp install path', async () => {
    const body = await readFile(join(SKILLS_ROOT, 'peaks-ui', 'SKILL.md'), 'utf8');
    const section = extractRunbookSection(body) ?? '';

    expect(section).toMatch(/peaks mcp apply --capability chrome-devtools-mcp\.browser-debug/);
  });

  test('PRD runbook references openspec and standards preflight commands', async () => {
    const body = await readFile(join(SKILLS_ROOT, 'peaks-prd', 'SKILL.md'), 'utf8');
    const section = extractRunbookSection(body) ?? '';

    expect.soft(section).toMatch(/peaks openspec/);
    expect.soft(section).toMatch(/peaks standards/);
  });
});

describe('audit: orchestrator skills expose a Default runbook that drives the role chain', () => {
  for (const { name, minPeaksCommands } of ORCHESTRATOR_SKILLS) {
    test(`${name} SKILL.md declares a Default runbook section`, async () => {
      const body = await readFile(join(SKILLS_ROOT, name, 'SKILL.md'), 'utf8');

      expect(body).toMatch(/## Default runbook/);
      const section = extractRunbookSection(body);
      expect(section).not.toBeNull();
    });

    test(`${name} Default runbook lists at least ${minPeaksCommands} peaks CLI command invocations`, async () => {
      const body = await readFile(join(SKILLS_ROOT, name, 'SKILL.md'), 'utf8');
      const section = extractRunbookSection(body) ?? '';

      const count = countPeaksCommandLines(section);
      expect.soft(count, `${name} runbook has ${count} peaks commands; expected at least ${minPeaksCommands}`).toBeGreaterThanOrEqual(minPeaksCommands);
    });
  }

  test('Solo runbook drives peaks request init for every role (prd, ui, rd, qa)', async () => {
    const body = await readFile(join(SKILLS_ROOT, 'peaks-solo', 'SKILL.md'), 'utf8');
    const section = extractRunbookSection(body) ?? '';

    for (const role of ['prd', 'ui', 'rd', 'qa']) {
      expect.soft(section, `Solo runbook should invoke peaks request init --role ${role}`).toMatch(new RegExp(`peaks request init --role ${role}`));
    }
  });

  test('Solo runbook references state transitions via peaks request transition', async () => {
    const body = await readFile(join(SKILLS_ROOT, 'peaks-solo', 'SKILL.md'), 'utf8');
    const section = extractRunbookSection(body) ?? '';

    expect.soft(section).toMatch(/peaks request transition/);
    expect.soft(section).toMatch(/--state confirmed-by-user/);
    expect.soft(section).toMatch(/--state verdict-issued/);
  });

  test('Solo runbook references peaks project dashboard for the cross-role snapshot', async () => {
    const body = await readFile(join(SKILLS_ROOT, 'peaks-solo', 'SKILL.md'), 'utf8');
    const section = extractRunbookSection(body) ?? '';

    expect(section).toMatch(/peaks project dashboard/);
  });
});
