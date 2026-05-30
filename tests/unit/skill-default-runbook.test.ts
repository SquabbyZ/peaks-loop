import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const SKILLS_ROOT = join(process.cwd(), 'skills');

const ROLE_SKILLS: Array<{ name: string; minPeaksCommands: number; mustReferenceArtifact: boolean }> = [
  { name: 'peaks-prd', minPeaksCommands: 10, mustReferenceArtifact: true },
  { name: 'peaks-ui', minPeaksCommands: 6, mustReferenceArtifact: true },
  { name: 'peaks-rd', minPeaksCommands: 14, mustReferenceArtifact: true },
  { name: 'peaks-qa', minPeaksCommands: 12, mustReferenceArtifact: true }
];

const SUPPORT_SKILLS: Array<{ name: string; minPeaksCommands: number }> = [
  { name: 'peaks-sc', minPeaksCommands: 8 },
  { name: 'peaks-txt', minPeaksCommands: 7 },
  { name: 'peaks-sop', minPeaksCommands: 10 }
];

const ORCHESTRATOR_SKILLS: Array<{ name: string; minPeaksCommands: number }> = [
  { name: 'peaks-solo', minPeaksCommands: 20 }
];

function extractRunbookSection(body: string): string | null {
  const match = /## Default runbook\n+([\s\S]*?)(?=\n## |$)/.exec(body);
  return match === null ? null : (match[1] ?? null);
}

function countPeaksCommandLines(section: string): number {
  const lines = section.split(/\r?\n/);
  return lines.filter((line) => /^\s*peaks\s+\w/.test(line)).length;
}

const DESTRUCTIVE_APPLY_PATTERNS = [
  /peaks\s+memory\s+sync[^\n]*--apply/,
  /peaks\s+memory\s+extract[^\n]*--apply/,
  /peaks\s+artifacts\s+sync[^\n]*--apply/,
  /peaks\s+openspec\s+archive[^\n]*--apply/,
  /peaks\s+standards\s+(?:init|update)[^\n]*--apply/
];

const AUTHORIZATION_KEYWORDS = /authoriz|explicit|--dry-run|approv|only after|only when/i;

function findDestructiveApplyLines(section: string): string[] {
  const lines = section.split(/\r?\n/);
  return lines.filter((line) => DESTRUCTIVE_APPLY_PATTERNS.some((pattern) => pattern.test(line)));
}

const ALL_RUNBOOK_SKILLS = ['peaks-prd', 'peaks-ui', 'peaks-rd', 'peaks-qa', 'peaks-sc', 'peaks-txt', 'peaks-solo'];

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

  test('QA runbook references openspec validate and the playwright-mcp install path', async () => {
    const body = await readFile(join(SKILLS_ROOT, 'peaks-qa', 'SKILL.md'), 'utf8');
    const section = extractRunbookSection(body) ?? '';

    expect.soft(section).toMatch(/peaks openspec validate/);
    expect.soft(section).toMatch(/peaks mcp apply --capability playwright-mcp\.browser-validation/);
  });

  test('UI runbook references the playwright-mcp install path', async () => {
    const body = await readFile(join(SKILLS_ROOT, 'peaks-ui', 'SKILL.md'), 'utf8');
    const section = extractRunbookSection(body) ?? '';

    expect(section).toMatch(/peaks mcp apply --capability playwright-mcp\.browser-validation/);
  });

  test('PRD runbook references openspec and standards preflight commands', async () => {
    const body = await readFile(join(SKILLS_ROOT, 'peaks-prd', 'SKILL.md'), 'utf8');
    const section = extractRunbookSection(body) ?? '';

    expect.soft(section).toMatch(/peaks openspec/);
    expect.soft(section).toMatch(/peaks standards/);
  });
});

describe('audit: support skills expose a Default runbook with peaks CLI commands', () => {
  for (const { name, minPeaksCommands } of SUPPORT_SKILLS) {
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

  test('SC runbook records change-control via peaks sc impact / retention / validate / boundary', async () => {
    const body = await readFile(join(SKILLS_ROOT, 'peaks-sc', 'SKILL.md'), 'utf8');
    const section = extractRunbookSection(body) ?? '';

    expect.soft(section).toMatch(/peaks sc impact/);
    expect.soft(section).toMatch(/peaks sc retention/);
    expect.soft(section).toMatch(/peaks sc validate/);
    expect.soft(section).toMatch(/peaks sc boundary/);
  });

  test('TXT runbook composes capsules from request artifacts and project dashboard', async () => {
    const body = await readFile(join(SKILLS_ROOT, 'peaks-txt', 'SKILL.md'), 'utf8');
    const section = extractRunbookSection(body) ?? '';

    expect.soft(section).toMatch(/peaks request show/);
    expect.soft(section).toMatch(/peaks project dashboard/);
    expect.soft(section).toMatch(/peaks memory extract/);
  });

  test('SOP runbook drives the authoring loop via peaks sop init / lint / check / advance / register', async () => {
    const body = await readFile(join(SKILLS_ROOT, 'peaks-sop', 'SKILL.md'), 'utf8');
    const section = extractRunbookSection(body) ?? '';

    expect.soft(section).toMatch(/peaks sop init/);
    expect.soft(section).toMatch(/peaks sop lint/);
    expect.soft(section).toMatch(/peaks sop check/);
    expect.soft(section).toMatch(/peaks sop advance/);
    expect.soft(section).toMatch(/peaks sop register/);
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

  test('Solo runbook drives SC change-control evidence (impact / retention / validate / boundary)', async () => {
    const body = await readFile(join(SKILLS_ROOT, 'peaks-solo', 'SKILL.md'), 'utf8');
    const section = extractRunbookSection(body) ?? '';

    expect.soft(section).toMatch(/peaks sc impact/);
    expect.soft(section).toMatch(/peaks sc retention/);
    expect.soft(section).toMatch(/peaks sc validate/);
    expect.soft(section).toMatch(/peaks sc boundary/);
  });

  test('Solo runbook drives TXT memory extraction as a dry-run by default', async () => {
    const body = await readFile(join(SKILLS_ROOT, 'peaks-solo', 'SKILL.md'), 'utf8');
    const section = extractRunbookSection(body) ?? '';

    expect.soft(section).toMatch(/peaks memory extract/);
    expect.soft(section).toMatch(/--dry-run/);
  });
});

describe('audit: destructive --apply commands carry an authorization or dry-run note', () => {
  for (const name of ALL_RUNBOOK_SKILLS) {
    test(`${name} runbook gates every destructive --apply with an authorization keyword`, async () => {
      const body = await readFile(join(SKILLS_ROOT, name, 'SKILL.md'), 'utf8');
      const section = extractRunbookSection(body) ?? '';
      const destructive = findDestructiveApplyLines(section);

      if (destructive.length === 0) {
        return;
      }

      const hasAuthorizationNote = AUTHORIZATION_KEYWORDS.test(section);
      expect.soft(
        hasAuthorizationNote,
        `${name} runbook contains destructive --apply lines:\n${destructive.join('\n')}\nbut no authorization/dry-run note in the runbook section`
      ).toBe(true);
    });
  }
});
