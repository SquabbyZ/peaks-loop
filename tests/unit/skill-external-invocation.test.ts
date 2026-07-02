import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const SKILLS_ROOT = join(process.cwd(), 'skills');

const EXTERNAL_TOKENS = [
  'mattpocock/skills',
  'awesome-design-md',
  'taste-skill',
  'design-taste-frontend',
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
// v3.0.0+ canonical: repo renamed peaks-cli → peaks-loop (commit 87a2643).
// PEAKS_AUTHORITATIVE_PATTERN accepts "Peaks", "Peaks-Cli" (back-compat
// for any pre-rename doc still using the old name), and "Peaks-Loop"
// (the canonical product name). Test asserts that any skill
// referencing external skills explicitly notes that peaks-loop's
// artifacts / gates / acceptance authority is authoritative.
const PEAKS_AUTHORITATIVE_PATTERN = /(Peaks(?:-Cli|-Loop)? [\w \-/]+(remain|are) authoritative|Peaks(?:-Cli|-Loop)? [\w \-/]+acceptance authority|Peaks(?:-Cli|-Loop)? artifacts remain authoritative|Peaks(?:-Cli|-Loop)? gates remain authoritative)/i;

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

describe('audit: MCP-server external references route through the LLM tool list (slice #016)', () => {
  // Slice #016 retired the `peaks mcp *` indirection. Skill bodies now route
  // MCP install / dispatch through the LLM's own tool list (the LLM checks
  // for `mcp__<server>__*` entries) and instruct the user to run the
  // IDE-native install command when the MCP is absent. peaks-loop is no
  // longer in the install path.
  const MCP_TOKENS = ['Chrome DevTools MCP', 'Figma Context MCP', 'Playwright MCP'];
  // Accept any of: a tool-list self-check, an install command for the
  // user, or a Claude-Code-specific install command. The pattern matches
  // prose that explicitly puts the LLM (or the user) in charge of MCP,
  // not peaks-loop.
  const LLM_TOOL_LIST_PATTERN =
    /(tool list|claude mcp add|LLM (checks|invokes|tells)|LLM's tool list|mcp__[A-Za-z_]+__\*)/i;
  // Negative pattern: the skill must NOT bake the now-retired
  // `peaks mcp plan/apply/call` indirection. Slice #016 replaced those
  // with the LLM tool-list self-check.
  const NEGATIVE_PEAKS_MCP_PATTERN = /peaks mcp (plan|apply|call|list|rollback|scan)/;

  for (const name of ENFORCED_SKILLS) {
    test(`${name} routes any MCP-server mention through the LLM tool list (not peaks mcp CLI)`, async () => {
      const body = await readSkillBody(name);
      const referencesMcp = MCP_TOKENS.some((token) => body.includes(token));

      if (!referencesMcp) {
        return;
      }

      expect(body, `${name} mentions an MCP server but does not describe the LLM-tool-list self-check or surface the IDE install command`).toMatch(LLM_TOOL_LIST_PATTERN);
      expect(
        body,
        `${name} still bakes the retired \`peaks mcp plan/apply/call\` indirection (slice #016 retired that path)`
      ).not.toMatch(NEGATIVE_PEAKS_MCP_PATTERN);
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
    // Slice #016: the peaks mcp * indirection was retired; the
    // reference doc now points MCP install / dispatch at the LLM's own
    // tool list rather than the peaks-loop CLI.
    expect(body).toMatch(/(tool list|mcp__[A-Za-z_]+__\*|Slice #016)/);
  });
});
