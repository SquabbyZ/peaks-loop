import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const SKILLS_ROOT = join(process.cwd(), 'skills');

const EXTERNAL_TOKENS = [
  'mattpocock/skills',
  'awesome-design-md',
  'taste-skill',
  'design-taste-frontend',
  'shadcn/ui',
  'React Bits',
  'ui-ux-pro-max-skill',
  'Chrome DevTools MCP',
  'Agent Browser',
  'Figma Context MCP',
  'Penpot',
  'Context7',
  'SearchCode',
  'claude-mem',
  'context-mode',
  'everything-claude-code',
  'Claude Code Best Practice',
  'andrej-karpathy-skills',
  'GitNexus',
  'Superpowers',
  'understand-anything'
];

const DISCOVERY_PATTERN = /(capability discovery|peaks capabilities)/i;
const REFERENCE_ONLY_PATTERN = /(reference(s)? only|reference material|reference resources|reference inputs)/i;
const NO_EXECUTE_PATTERN = /(do not execute upstream|do not run upstream installer|do not persist sensitive examples|do not install upstream resources)/i;
const PEAKS_AUTHORITATIVE_PATTERN = /(Peaks(?:-Cli)? [\w \-/]+(remain|are) authoritative|Peaks(?:-Cli)? [\w \-/]+acceptance authority|Peaks(?:-Cli)? artifacts remain authoritative|Peaks(?:-Cli)? gates remain authoritative)/i;

async function readSkillBody(name: string): Promise<string> {
  return readFile(join(SKILLS_ROOT, name, 'SKILL.md'), 'utf8');
}

function mentionsExternal(body: string): boolean {
  return EXTERNAL_TOKENS.some((token) => body.includes(token));
}

const ENFORCED_SKILLS = ['peaks-prd', 'peaks-ui', 'peaks-rd', 'peaks-qa', 'peaks-sc', 'peaks-solo', 'peaks-txt'];

describe('audit: skill SKILL.md external invocation pattern', () => {
  for (const name of ENFORCED_SKILLS) {
    test(`${name} satisfies the canonical pattern when external skills are referenced`, async () => {
      const body = await readSkillBody(name);

      if (!mentionsExternal(body)) {
        return;
      }

      expect.soft(body, `${name} should mention capability discovery before naming external skills`).toMatch(DISCOVERY_PATTERN);
      expect.soft(body, `${name} should qualify external skills as references only`).toMatch(REFERENCE_ONLY_PATTERN);
      expect.soft(body, `${name} should explicitly forbid executing / installing / persisting upstream material`).toMatch(NO_EXECUTE_PATTERN);
      expect.soft(body, `${name} should declare Peaks gates / artifacts / acceptance authority`).toMatch(PEAKS_AUTHORITATIVE_PATTERN);
    });
  }
});

describe('audit: MCP-server external references route through peaks mcp CLI', () => {
  const MCP_TOKENS = ['Chrome DevTools MCP', 'Figma Context MCP'];
  const PEAKS_MCP_ROUTING_PATTERN = /peaks mcp (plan|apply|call)/i;

  for (const name of ENFORCED_SKILLS) {
    test(`${name} routes any MCP-server mention through peaks mcp plan / apply / call`, async () => {
      const body = await readSkillBody(name);
      const referencesMcp = MCP_TOKENS.some((token) => body.includes(token));

      if (!referencesMcp) {
        return;
      }

      expect(body, `${name} mentions an MCP server but does not route through peaks mcp plan/apply/call`).toMatch(PEAKS_MCP_ROUTING_PATTERN);
    });
  }
});

describe('audit: peaks-solo documents the canonical external-skill invocation pattern', () => {
  test('peaks-solo/SKILL.md links to external-skill-invocation.md', async () => {
    const body = await readSkillBody('peaks-solo');

    expect(body).toMatch(/references\/external-skill-invocation\.md/);
  });

  test('peaks-solo/references/external-skill-invocation.md exists and defines the three stages', async () => {
    const body = await readFile(join(SKILLS_ROOT, 'peaks-solo', 'references', 'external-skill-invocation.md'), 'utf8');

    expect(body).toMatch(/Stage 1 — Discovery/);
    expect(body).toMatch(/Stage 2 — Reference/);
    expect(body).toMatch(/Stage 3 — Side effect through Peaks CLI only/);
    expect(body).toMatch(/peaks mcp (plan|apply|call)/);
  });
});
