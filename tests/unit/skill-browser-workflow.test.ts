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
    expect(body).toMatch(/peaks mcp plan/);
    expect(body).toMatch(/peaks mcp apply/);
    expect(body).toMatch(/playwright-mcp\.browser-validation/);
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
      expect.soft(body, `${name} SKILL.md should reference the mcp__playwright__ tool namespace`).toMatch(/mcp__playwright__/);
    }
  });

  test('every browser-touching SKILL.md routes installation through peaks mcp plan/apply for playwright', async () => {
    for (const name of BROWSER_TOUCHING_SKILLS) {
      const body = await read(join('skills', name, 'SKILL.md'));
      expect.soft(body, `${name} SKILL.md should mention peaks mcp plan/apply for playwright install`).toMatch(/peaks mcp (plan|apply).*playwright-mcp\.browser-validation/);
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

  test('peaks-solo external-skill-invocation reference exposes mcp__chrome-devtools__ as an allowed in-process surface', async () => {
    const body = await read(join('skills', 'peaks-solo', 'references', 'external-skill-invocation.md'));

    expect(body).toMatch(/mcp__chrome-devtools__/);
    expect(body).toMatch(/no longer endorsed|deprecated/i);
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
