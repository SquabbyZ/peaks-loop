import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const SKILLS_ROOT = join(process.cwd(), 'skills');

const BROWSER_TOUCHING_SKILLS = ['peaks-prd', 'peaks-ui', 'peaks-qa', 'peaks-rd', 'peaks-solo'];

const MIGRATION_DOC_PATHS = [
  join('skills', 'peaks-solo', 'references', 'browser-workflow.md'),
  join('skills', 'peaks-solo', 'references', 'external-skill-invocation.md'),
  join('skills', 'peaks-solo', 'SKILL.md')
];

async function read(relativePath: string): Promise<string> {
  return readFile(join(process.cwd(), relativePath), 'utf8');
}

describe('audit: Playwright MCP is the canonical headed-browser launch surface', () => {
  test('the canonical browser-workflow.md reference documents Playwright as primary and Chrome DevTools as optional secondary', async () => {
    const body = await read(join('skills', 'peaks-solo', 'references', 'browser-workflow.md'));

    expect(body).toMatch(/Playwright MCP/);
    // Slice #016 removed the peaks-loop MCP subsystem; the LLM now self-detects
    // via its own tool list and tells the user the install command.
    expect(body).toMatch(/tool list|your tool list|mcp__playwright__/);
    expect(body).toMatch(/claude mcp add playwright/);
    expect(body).toMatch(/URL allow-list/i);
    expect(body).toMatch(/Login \/ CAPTCHA \/ SSO \/ MFA/);
    expect(body).toMatch(/Sensitive data sanitization/);
    expect(body).toMatch(/Fallback when Playwright MCP is not installed/);
    expect(body).toMatch(/Chrome DevTools MCP/);
    expect(body).toMatch(/does not launch|does NOT launch|optional secondary/i);
  });

  test('every browser-touching SKILL.md references Playwright MCP', async () => {
    for (const name of BROWSER_TOUCHING_SKILLS) {
      const body = await read(join('skills', name, 'SKILL.md'));
      expect.soft(body, `${name} SKILL.md should reference Playwright MCP`).toMatch(/Playwright MCP/);
    }
  });

  test('every browser-touching SKILL.md routes MCP detection through LLM tool list (slice 016 contract)', async () => {
    for (const name of BROWSER_TOUCHING_SKILLS) {
      const body = await read(join('skills', name, 'SKILL.md'));
      // Slice #016: skill body must NOT bake the peaks mcp plan/apply CLI verbs
      expect.soft(body, `${name} SKILL.md must not reference the removed peaks mcp CLI`).not.toMatch(/peaks mcp (plan|apply|call|list|rollback|scan)/);
      // Slice #016: skill body must NOT bake the bare mcp__playwright__ prefix
      expect.soft(body, `${name} SKILL.md must not bake the bare mcp__playwright__ tool namespace prefix`).not.toMatch(/mcp__playwright__/);
      // Slice #016: skill body must direct the LLM to check its own tool list
      expect.soft(body, `${name} SKILL.md should direct the LLM to its own tool list for MCP presence`).toMatch(/tool list/i);
    }
  });

  test('non-migration documents do not promote gstack/browse as the current browser path', async () => {
    const skillFiles = await collectSkillMarkdown();
    for (const relativePath of skillFiles) {
      if (MIGRATION_DOC_PATHS.some((suffix) => relativePath.replace(/\\/g, '/').endsWith(suffix.replace(/\\/g, '/')))) {
        continue;
      }
      const body = await readFile(relativePath, 'utf8');
      expect.soft(body, `${relativePath} should not still promote gstack/browse as the current browser surface`).not.toMatch(/gstack\/browse/);
    }
  });

  test('peaks-solo external-skill-invocation reference documents Chrome DevTools MCP as optional secondary surface (slice 016)', async () => {
    const body = await read(join('skills', 'peaks-solo', 'references', 'external-skill-invocation.md'));

    // Slice #016: peaks-loop no longer owns MCP install. The reference must
    // document the chrome-devtools MCP and direct the LLM to its tool list.
    expect(body).toMatch(/chrome[- ]?devtools/);
    expect(body).toMatch(/mcp__chrome_devtools__|mcp__chrome-devtools__/);
    expect(body).toMatch(/tool list|your tool list/);
  });
});

async function collectSkillMarkdown(): Promise<string[]> {
  const { readdir } = await import('node:fs/promises');
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.md')) {
        out.push(full);
      }
    }
  }
  await walk(SKILLS_ROOT);
  return out;
}
