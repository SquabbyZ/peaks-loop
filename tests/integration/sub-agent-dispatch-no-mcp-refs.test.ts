/**
 * Integration test: sub-agent dispatch prompt template is decoupled from
 * the 4 MCP servers (playwright, figma, context7, chrome-devtools) via
 * the `peaks mcp call` envelope.
 *
 * Regression contract (PRD AC-12):
 *  - The dispatch prompt template at
 *    `skills/peaks-solo/references/sub-agent-dispatch.md` MUST NOT contain
 *    any direct `mcp__<server>__<tool>` invocation. The `mcp__<server>__*`
 *    prefix is owned by the LLM runtime, not by the skill body.
 *  - The strict pattern `mcp__<server>__<tool>` (where the part after
 *    `mcp__<server>__` is a concrete tool name) MUST match zero lines
 *    in the dispatch template.
 *  - The 4 capability ids referenced by the dispatch template MUST be
 *    exactly:
 *      - playwright-mcp.browser-validation
 *      - chrome-devtools-mcp.browser-debug
 *      - figma-context-mcp.design-context
 *      - context7.docs-lookup
 *  - The 6 SKILL.md consumer surfaces (peaks-solo, peaks-rd, peaks-qa,
 *    peaks-ui, peaks-sop, peaks-sc) MUST NOT contain any direct
 *    `mcp__<server>__<tool>` invocation either. The prefix is owned by
 *    the runtime, not by the skill body.
 *
 * If a future slice reintroduces a direct `mcp__<server>__<tool>`
 * reference into the dispatch template (or any of the 6 SKILL.md
 * consumer surfaces), this test fails loud with the offending file
 * and line number, blocking the regression at CI time.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..');

/**
 * Strict regex for a direct MCP tool prefix invocation. Matches
 * `mcp__<server>__<tool>` where `<server>` and `<tool>` are
 * non-empty identifier characters (letters, digits, underscore,
 * dash). Wildcards like `mcp__<server>__*` are NOT matched because
 * the QA contract is "no concrete tool invocations"; template
 * placeholders like `mcp__<server>__*` describing the prefix are
 * allowed (this is the `mcp__` prefix that the LLM runtime owns).
 *
 * The QA report flags only the concrete form
 * `mcp__<server>__<tool>` as a regression; this regex is the
 * load-bearing enforcement.
 */
const STRICT_MCP_TOOL_PREFIX = /mcp__[A-Za-z][A-Za-z0-9_-]*__[A-Za-z][A-Za-z0-9_]*/g;

const DISPATCH_TEMPLATE_PATH = join(
  REPO_ROOT,
  'skills',
  'peaks-solo',
  'references',
  'sub-agent-dispatch.md'
);

const SKILL_FILES = [
  'skills/peaks-solo/SKILL.md',
  'skills/peaks-rd/SKILL.md',
  'skills/peaks-qa/SKILL.md',
  'skills/peaks-ui/SKILL.md',
  'skills/peaks-sop/SKILL.md',
  'skills/peaks-sc/SKILL.md'
] as const;

function readUtf8(absolutePath: string): string {
  return readFileSync(absolutePath, 'utf8');
}

function findOffendingLines(content: string, regex: RegExp): Array<{ line: number; text: string }> {
  const offenders: Array<{ line: number; text: string }> = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) continue;
    // Reset the lastIndex for global regexes so each line scan is independent.
    regex.lastIndex = 0;
    const match = regex.exec(line);
    if (match) {
      offenders.push({ line: i + 1, text: line });
    }
  }
  return offenders;
}

describe('sub-agent dispatch template — no direct mcp__<server>__<tool> references', () => {
  test('dispatch template file exists at the canonical path', () => {
    const content = readUtf8(DISPATCH_TEMPLATE_PATH);
    expect(content.length).toBeGreaterThan(0);
  });

  test('dispatch template contains zero `mcp__<server>__<tool>` invocations', () => {
    const content = readUtf8(DISPATCH_TEMPLATE_PATH);
    const offenders = findOffendingLines(content, STRICT_MCP_TOOL_PREFIX);
    if (offenders.length > 0) {
      const formatted = offenders
        .map((o) => `  line ${o.line}: ${o.text.trim()}`)
        .join('\n');
      throw new Error(
        `Dispatch template at ${DISPATCH_TEMPLATE_PATH} contains ` +
        `${offenders.length} direct mcp__<server>__<tool> reference(s):\n` +
        `${formatted}\n` +
        `Skill bodies must route MCP operations through ` +
        `\`peaks mcp call --capability <id> --tool <name> --args-json '<args>' --json\`.`
      );
    }
    expect(offenders).toEqual([]);
  });

  test('dispatch template references all 4 canonical capability ids', () => {
    const content = readUtf8(DISPATCH_TEMPLATE_PATH);
    const expectedCapabilities = [
      'playwright-mcp.browser-validation',
      'chrome-devtools-mcp.browser-debug',
      'figma-context-mcp.design-context',
      'context7.docs-lookup'
    ];
    for (const cap of expectedCapabilities) {
      expect(content).toContain(cap);
    }
  });

  test('dispatch template references the peaks mcp call envelope', () => {
    const content = readUtf8(DISPATCH_TEMPLATE_PATH);
    expect(content).toContain('peaks mcp call');
    expect(content).toContain('--capability');
    expect(content).toContain('--args-json');
  });
});

describe('SKILL.md consumer surfaces — no direct mcp__<server>__<tool> references', () => {
  for (const relativePath of SKILL_FILES) {
    const absolutePath = join(REPO_ROOT, relativePath);
    test(`${relativePath} contains zero direct mcp__<server>__<tool> invocations`, () => {
      const content = readUtf8(absolutePath);
      const offenders = findOffendingLines(content, STRICT_MCP_TOOL_PREFIX);
      if (offenders.length > 0) {
        const formatted = offenders
          .map((o) => `  line ${o.line}: ${o.text.trim()}`)
          .join('\n');
        throw new Error(
          `${relativePath} contains ` +
          `${offenders.length} direct mcp__<server>__<tool> reference(s):\n` +
          `${formatted}\n` +
          `Skill bodies must route MCP operations through ` +
          `\`peaks mcp call --capability <id> --tool <name> --args-json '<args>' --json\`.`
        );
      }
      expect(offenders).toEqual([]);
    });
  }
});
