/**
 * peaks-solo — unit tests for the dispatcher skill's SKILL.md and reference files.
 *
 * Slice S1 (4.0.0-beta.5 — peaks-solo dispatcher).
 * Spec: docs/superpowers/specs/2026-07-08-peaks-solo-dispatcher-design.md §3.1, §3.3, §3.4, §3.5
 * Plan: docs/superpowers/plans/2026-07-08-peaks-solo-dispatcher/s1-peaks-solo-skill.md
 *
 * peaks-solo is a pure LLM-behavior skill (no programmatic code in src/).
 * The unit tests therefore assert structural / content invariants on
 * the SKILL.md + 3 reference files instead of testing a function.
 *
 * 7 cases per plan §"Test cases (tests/unit/peaks-solo.test.ts)":
 *   U-1  frontmatter parses (name + description contains "Dispatcher" + metadata.type=dispatcher)
 *   U-2  NOT clause present (description contains "NOT for" + all 5 leaf skill entries)
 *   U-3  trigger phrase present (description contains "自然语言描述诉求" + "帮我处理这个")
 *   U-4  Out of scope section exists (contains "## 6. Out of scope" + "no code" + "no PRD" + "no vitest" + "no Loop Engineering Asset")
 *   U-5  triage decision table file exists (≥ 10 keyword rows; columns "keyword" + "→" + leaf skill name)
 *   U-6  fallback tool inventory file exists (≥ 3 allowed + ≥ 1 blocked)
 *   U-7  sediment prompt template file exists (4 options (a)/(b)/(c)/(d); default NOT (d))
 */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const SKILL_MD = resolve(REPO_ROOT, 'skills/peaks-solo/SKILL.md');
const TRIAGE_TABLE = resolve(REPO_ROOT, 'skills/peaks-solo/references/triage-decision-table.md');
const FALLBACK_INVENTORY = resolve(
  REPO_ROOT,
  'skills/peaks-solo/references/fallback-tool-inventory.md'
);
const SEDIMENT_TEMPLATE = resolve(
  REPO_ROOT,
  'skills/peaks-solo/references/sediment-prompt-template.md'
);

/**
 * Minimal YAML frontmatter extractor. peaks-solo's frontmatter is a
 * single-string `description` field followed by a `metadata:` block;
 * we don't need a full YAML parser — line-prefix scanning is enough.
 */
function readFrontmatter(raw: string): { frontmatter: string; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    throw new Error('SKILL.md missing leading `---` frontmatter fence');
  }
  return { frontmatter: match[1] ?? '', body: match[2] ?? '' };
}

describe('peaks-solo SKILL.md', () => {
  const raw = readFileSync(SKILL_MD, 'utf8');
  const { frontmatter, body } = readFrontmatter(raw);

  test('U-1: frontmatter parses — name, description contains "Dispatcher", metadata.type=dispatcher', () => {
    expect(frontmatter, 'frontmatter should not be empty').toBeTruthy();

    // name: peaks-solo
    expect(frontmatter).toMatch(/^name:\s*peaks-solo\s*$/m);

    // description contains "Dispatcher" (the locked verbatim string starts with this word)
    const descMatch = frontmatter.match(/description:\s*\|?\s*\n([\s\S]*?)(?=\nmetadata:|\n[a-zA-Z_-]+:|$)/);
    expect(descMatch, 'description block should be present').not.toBeNull();
    const description = descMatch?.[1] ?? '';
    expect(description).toContain('Dispatcher');

    // metadata.type = dispatcher
    expect(frontmatter).toMatch(/metadata:\s*\n[\s\S]*?type:\s*dispatcher/);
  });

  test('U-2: NOT clause present — description contains "NOT for" and all 5 leaf skill entries', () => {
    const descMatch = frontmatter.match(/description:\s*\|?\s*\n([\s\S]*?)(?=\nmetadata:|\n[a-zA-Z_-]+:|$)/);
    const description = descMatch?.[1] ?? '';
    expect(description).toContain('NOT for');
    // 5 locked NOT entries (per plan §"description (locked verbatim)"):
    expect(description).toContain('/peaks-code');
    expect(description).toContain('/peaks-content');
    expect(description).toContain('/peaks-doctor');
    expect(description).toContain('/peaks-issue-fix-orchestrator');
    expect(description).toContain('/peaks-sop');
  });

  test('U-3: trigger phrase present — description contains "自然语言描述诉求" and "帮我处理这个"', () => {
    const descMatch = frontmatter.match(/description:\s*\|?\s*\n([\s\S]*?)(?=\nmetadata:|\n[a-zA-Z_-]+:|$)/);
    const description = descMatch?.[1] ?? '';
    expect(description).toContain('自然语言描述诉求');
    expect(description).toContain('帮我处理这个');
  });

  test('U-4: Out of scope section exists — header + 4 forbidden categories', () => {
    // §6 header (allow leading whitespace variants like "## 6. Out of scope")
    expect(body).toMatch(/^##\s*6\.\s*Out of scope/m);
    // HC-11 forbidden categories (case-insensitive; LLM may capitalize)
    const lc = body.toLowerCase();
    expect(lc).toContain('no code');
    expect(lc).toContain('no prd');
    expect(lc).toContain('no vitest');
    expect(lc).toContain('no loop engineering asset');
  });
});

describe('peaks-solo references/triage-decision-table.md', () => {
  test('U-5: triage decision table exists — ≥ 10 keyword rows; columns "keyword" + "→" + leaf skill name', () => {
    const raw = readFileSync(TRIAGE_TABLE, 'utf8');
    expect(raw.length).toBeGreaterThan(0);

    // Required column markers (case-insensitive)
    const lc = raw.toLowerCase();
    expect(lc).toContain('keyword');
    expect(raw).toContain('→'); // literal arrow separator
    // At least one leaf skill name must appear in the table
    expect(raw).toMatch(/peaks-(code|content|doctor|sop|status|test|resume|issue-fix-orchestrator)/);

    // Count table rows that look like `| keyword | → | leaf-skill |` (or similar).
    // A row has at least 2 pipes and contains the arrow.
    const rowLines = raw.split(/\r?\n/).filter((l) => l.trim().startsWith('|') && l.includes('→'));
    expect(rowLines.length).toBeGreaterThanOrEqual(10);
  });
});

describe('peaks-solo references/fallback-tool-inventory.md', () => {
  test('U-6: fallback tool inventory exists — ≥ 3 allowed tools + ≥ 1 blocked tool', () => {
    const raw = readFileSync(FALLBACK_INVENTORY, 'utf8');
    expect(raw.length).toBeGreaterThan(0);

    // Section headers expected
    expect(raw.toLowerCase()).toMatch(/allowed/);
    expect(raw.toLowerCase()).toMatch(/blocked/);

    // ≥ 3 allowed tool entries (rows starting with `|` and containing a tool name)
    const allowedLines = raw.split(/\r?\n/).filter((l) => {
      const trimmed = l.trim();
      return trimmed.startsWith('|') && /\b(deep-search|websearch|webfetch|bash|edit|write|peaks memory extract|peaks asset)\b/i.test(trimmed);
    });
    expect(allowedLines.length).toBeGreaterThanOrEqual(3);

    // ≥ 1 blocked entry (mention a known dangerous tool)
    const lc = raw.toLowerCase();
    const blockedMentions = ['rm -rf', 'git push --force', 'git push -f', 'src/**', 'peaks asset crystallize'];
    const found = blockedMentions.some((needle) => lc.includes(needle));
    expect(found, 'expected at least one blocked tool/example').toBe(true);
  });
});

describe('peaks-solo references/sediment-prompt-template.md', () => {
  test('U-7: sediment prompt template exists — 4 options (a/b/c/d); default is NOT (d)', () => {
    const raw = readFileSync(SEDIMENT_TEMPLATE, 'utf8');
    expect(raw.length).toBeGreaterThan(0);

    // 4 options labelled (a), (b), (c), (d)
    expect(raw).toContain('(a)');
    expect(raw).toContain('(b)');
    expect(raw).toContain('(c)');
    expect(raw).toContain('(d)');

    // Recommended default must NOT be (d)
    const lc = raw.toLowerCase();
    // Look for a "default" / "推荐" / "recommended" line; it must point at (a) or (b), not (d).
    const defaultLine = raw.split(/\r?\n/).find((l) => /default|推荐|recommended/i.test(l));
    expect(defaultLine, 'expected a default/recommended line').toBeTruthy();
    if (defaultLine) {
      // Default should mention (a) or (b) — explicitly NOT just (d)
      expect(defaultLine).toMatch(/\(a\)|\(b\)/);
      // And the recommended default should not be `(d)`
      const recommended = (defaultLine.match(/\([a-d]\)/g) ?? []).join('|');
      expect(recommended).not.toBe('(d)');
    }
    // Sanity: a "NL rationale" requirement must appear (per brief)
    expect(lc).toMatch(/nl\s*rationale|natural[- ]language\s*rationale|nl\s*解释/);
  });
});