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
  // Find a `## Default runbook` heading at the start of a line, then capture
  // the section body up to the next `## ` heading or end of input.
  //
  // We avoid a `(?=\n## |$)` lookahead because the `m` flag turns `$` into
  // "end of any line", which would let the lazy capture stop at the first
  // newline. Instead, locate the heading with the regex, then manually scan
  // forward for the next `## ` heading or end of input.
  const headingRe = /^## Default runbook[^\n]*(?:\n|$)/m;
  const headingMatch = headingRe.exec(body);
  if (headingMatch === null) return null;
  const startAfter = headingMatch.index + headingMatch[0].length;
  const rest = body.slice(startAfter);
  const nextHeadingRe = /^## /m;
  const nextMatch = nextHeadingRe.exec(rest);
  const end = nextMatch === null ? rest.length : nextMatch.index;
  return rest.slice(0, end);
}

/**
 * Load the runbook section, falling back to references/runbook.md if SKILL.md
 * only has a pointer section. This supports skills that extracted their runbook
 * to a sibling reference (e.g. peaks-solo extracted its 150-line bash runbook
 * to references/runbook.md to keep the SKILL.md body under the 800-line cap).
 *
 * Strategy: prefer the LONGER of the two sections. A short pointer section
 * in SKILL.md (~ 1-2 lines) is treated as a "this runbook is in the
 * reference" marker; a long inline section is treated as the canonical
 * runbook. This avoids the false positive where the pointer section's
 * regex match returns a non-null but content-poor string.
 */
async function loadRunbookSection(skillName: string, body: string): Promise<string> {
  const inline = extractRunbookSection(body);
  // Try multiple reference filenames: `runbook.md` (generic) and
  // `<role>-runbook.md` (role-suffixed; e.g. `rd-runbook.md` for peaks-rd).
  const refCandidates = [
    join(SKILLS_ROOT, skillName, 'references', 'runbook.md'),
    join(SKILLS_ROOT, skillName, 'references', `${skillName.replace(/^peaks-/, '')}-runbook.md`)
  ];
  let bestRef: string | null = null;
  for (const refPath of refCandidates) {
    try {
      const refBody = await readFile(refPath, 'utf8');
      const refSection = extractRunbookSection(refBody);
      if (refSection === null) continue;
      if (bestRef === null || refSection.length > bestRef.length) {
        bestRef = refSection;
      }
    } catch {
      // candidate not present; try the next one
    }
  }
  const refSection = bestRef;
  if (inline === null) return refSection ?? '';
  if (refSection === null) return inline;
  return inline.length >= refSection.length ? inline : refSection;
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
      const section = await loadRunbookSection(name, body);

      const count = countPeaksCommandLines(section);
      expect.soft(count, `${name} runbook has ${count} peaks commands; expected at least ${minPeaksCommands}`).toBeGreaterThanOrEqual(minPeaksCommands);
    });

    if (mustReferenceArtifact) {
      test(`${name} Default runbook invokes peaks request init for the per-request artifact`, async () => {
        const body = await readFile(join(SKILLS_ROOT, name, 'SKILL.md'), 'utf8');
        const section = await loadRunbookSection(name, body);

        const role = name.replace(/^peaks-/, '');
        expect(section).toMatch(new RegExp(`peaks request init --role ${role}`));
      });
    }
  }
});

describe('audit: role runbooks reference cross-cutting CLI surfaces consistently', () => {
  test('RD runbook references openspec, codegraph, and standards CLI commands', async () => {
    const body = await readFile(join(SKILLS_ROOT, 'peaks-rd', 'SKILL.md'), 'utf8');
    const section = await loadRunbookSection('peaks-rd', body);

    expect.soft(section).toMatch(/peaks openspec/);
    expect.soft(section).toMatch(/peaks codegraph/);
    expect.soft(section).toMatch(/peaks standards/);
  });

  test('QA runbook references openspec validate and the playwright-mcp install command (slice 016: LLM tool-list self-check, not peaks mcp CLI)', async () => {
    const body = await readFile(join(SKILLS_ROOT, 'peaks-qa', 'SKILL.md'), 'utf8');
    const section = await loadRunbookSection('peaks-qa', body);

    expect.soft(section).toMatch(/peaks openspec validate/);
    // Slice #016: peaks-loop no longer has `peaks mcp`; the runbook directs
    // the LLM to its own tool list and the user-facing install command.
    expect.soft(section).not.toMatch(/peaks mcp (apply|plan|call|list|rollback|scan)/);
    expect.soft(section).toMatch(/claude mcp add playwright/);
  });

  test('UI runbook references the playwright-mcp install command (slice 016: LLM tool-list self-check)', async () => {
    const body = await readFile(join(SKILLS_ROOT, 'peaks-ui', 'SKILL.md'), 'utf8');
    const section = await loadRunbookSection('peaks-ui', body);

    expect(section).not.toMatch(/peaks mcp (apply|plan|call|list|rollback|scan)/);
    expect(section).toMatch(/claude mcp add playwright|tool list/i);
  });

  test('PRD runbook references openspec and standards preflight commands', async () => {
    const body = await readFile(join(SKILLS_ROOT, 'peaks-prd', 'SKILL.md'), 'utf8');
    const section = await loadRunbookSection('peaks-prd', body);

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
      const section = await loadRunbookSection(name, body);

      const count = countPeaksCommandLines(section);
      expect.soft(count, `${name} runbook has ${count} peaks commands; expected at least ${minPeaksCommands}`).toBeGreaterThanOrEqual(minPeaksCommands);
    });
  }

  test('SC runbook records change-control via peaks sc impact / retention / validate / boundary', async () => {
    const body = await readFile(join(SKILLS_ROOT, 'peaks-sc', 'SKILL.md'), 'utf8');
    const section = await loadRunbookSection('peaks-sc', body);

    expect.soft(section).toMatch(/peaks sc impact/);
    expect.soft(section).toMatch(/peaks sc retention/);
    expect.soft(section).toMatch(/peaks sc validate/);
    expect.soft(section).toMatch(/peaks sc boundary/);
  });

  test('TXT runbook composes capsules from request artifacts and project dashboard', async () => {
    const body = await readFile(join(SKILLS_ROOT, 'peaks-txt', 'SKILL.md'), 'utf8');
    const section = await loadRunbookSection('peaks-txt', body);

    expect.soft(section).toMatch(/peaks request show/);
    expect.soft(section).toMatch(/peaks project dashboard/);
    expect.soft(section).toMatch(/peaks memory extract/);
  });

  test('SOP runbook drives the authoring loop via peaks sop init / lint / check / advance / register', async () => {
    const body = await readFile(join(SKILLS_ROOT, 'peaks-sop', 'SKILL.md'), 'utf8');
    const section = await loadRunbookSection('peaks-sop', body);

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
      const section = await loadRunbookSection(name, body);

      const count = countPeaksCommandLines(section);
      expect.soft(count, `${name} runbook has ${count} peaks commands; expected at least ${minPeaksCommands}`).toBeGreaterThanOrEqual(minPeaksCommands);
    });
  }

  test('Solo runbook drives peaks request init for every role (prd, ui, rd, qa)', async () => {
    const body = await readFile(join(SKILLS_ROOT, 'peaks-solo', 'SKILL.md'), 'utf8');
    const section = await loadRunbookSection('peaks-solo', body);

    for (const role of ['prd', 'ui', 'rd', 'qa']) {
      expect.soft(section, `Solo runbook should invoke peaks request init --role ${role}`).toMatch(new RegExp(`peaks request init --role ${role}`));
    }
  });

  test('Solo runbook references state transitions via peaks request transition', async () => {
    const body = await readFile(join(SKILLS_ROOT, 'peaks-solo', 'SKILL.md'), 'utf8');
    const section = await loadRunbookSection('peaks-solo', body);

    expect.soft(section).toMatch(/peaks request transition/);
    expect.soft(section).toMatch(/--state confirmed-by-user/);
    expect.soft(section).toMatch(/--state verdict-issued/);
  });

  test('Solo runbook references peaks project dashboard for the cross-role snapshot', async () => {
    const body = await readFile(join(SKILLS_ROOT, 'peaks-solo', 'SKILL.md'), 'utf8');
    const section = await loadRunbookSection('peaks-solo', body);

    expect(section).toMatch(/peaks project dashboard/);
  });

  test('Solo runbook drives SC change-control evidence (impact / retention / validate / boundary)', async () => {
    const body = await readFile(join(SKILLS_ROOT, 'peaks-solo', 'SKILL.md'), 'utf8');
    const section = await loadRunbookSection('peaks-solo', body);

    expect.soft(section).toMatch(/peaks sc impact/);
    expect.soft(section).toMatch(/peaks sc retention/);
    expect.soft(section).toMatch(/peaks sc validate/);
    expect.soft(section).toMatch(/peaks sc boundary/);
  });

  test('Solo runbook drives TXT memory extraction as a dry-run by default', async () => {
    const body = await readFile(join(SKILLS_ROOT, 'peaks-solo', 'SKILL.md'), 'utf8');
    const section = await loadRunbookSection('peaks-solo', body);

    expect.soft(section).toMatch(/peaks memory extract/);
    expect.soft(section).toMatch(/--dry-run/);
  });
});

describe('audit: destructive --apply commands carry an authorization or dry-run note', () => {
  for (const name of ALL_RUNBOOK_SKILLS) {
    test(`${name} runbook gates every destructive --apply with an authorization keyword`, async () => {
      const body = await readFile(join(SKILLS_ROOT, name, 'SKILL.md'), 'utf8');
      const section = await loadRunbookSection(name, body);
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
