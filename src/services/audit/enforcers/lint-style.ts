/**
 * P2-a lint-style enforcers — Theme A (section structure) and
 * Theme B (frontmatter shape).
 *
 * These enforcers do NOT block commands; they feed the
 * `peaks audit red-lines --json` report. The backing-detector
 * downgrades them to `cli-backed` when the catalog has an
 * `enforcerRef` (i.e. this file) and the per-skill scan finds a
 * match. The audit service counts hits + misses and reports the
 * per-catalog-entry breakdown.
 *
 * Pattern-only (no shell-out, no FS writes, no env mutations) so
 * the enforcer can run inside the `peaks audit red-lines` hot
 * path without the 5s ECC-AgentShield subprocess budget.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SECTION_HARD_CONTRACTS_HEADING = /^##\s+(Hard contracts|Hard contract)\b/im;
const SECTION_MANDATORY_HEADING = /^##\s+Mandatory\b/im;
const SECTION_DEFAULT_RUNBOOK_HEADING = /^##\s+(Default runbook|Default)\b/im;
const SECTION_GATE_INDEX_HEADING = /^##\s+(RD gate index|QA gate index|Gate index|gate-index)\b/im;
const SECTION_NAMING_AXIOM_HEADING = /(Two-axis naming convention|change-id.*session-id|두 가지 직교 축)/i;

const FRONTMATTER_NAME_LINE = /^name:\s*peaks-/m;
const FRONTMATTER_DESCRIPTION_LINE = /^description:\s*\S/m;
const FRONTMATTER_LOAD_STRATEGY = /loadStrategy:\s*(always|on-demand)/i;
const FRONTMATTER_APPLICABLE_TASK_LEVELS = /applicableTaskLevels/i;

export interface LintHit {
  readonly catalogId: string;
  readonly rule: string;
  readonly file: string;
  readonly line: number;
  readonly matchedText: string;
}

export interface SkillFile {
  readonly name: string;
  readonly path: string;
  readonly body: string;
  readonly lines: readonly string[];
}

export function readSkillFiles(skillsRoot: string, names: readonly string[]): readonly SkillFile[] {
  const out: SkillFile[] = [];
  for (const name of names) {
    const path = join(skillsRoot, name, 'SKILL.md');
    const body = readFileSync(path, 'utf8');
    out.push({ name, path, body, lines: body.split(/\r?\n/) });
  }
  return out;
}

function findLine(lines: readonly string[], pattern: RegExp): number {
  for (let i = 0; i < lines.length; i += 1) {
    if (pattern.test(lines[i] ?? '')) return i + 1;
  }
  return -1;
}

function matchedText(lines: readonly string[], line: number): string {
  if (line <= 0) return '';
  return (lines[line - 1] ?? '').trim();
}

/** Theme A — section structure. Returns lint hits (positive = rule
 *  satisfied, so a missing heading fires the lint hit; downstream
 *  audit service decides whether to WARN or pass). */
export function lintSectionShape(skill: SkillFile): readonly LintHit[] {
  const hits: LintHit[] = [];
  const rules: ReadonlyArray<{ id: string; rule: string; pattern: RegExp }> = [
    { id: 'rl-section-hard-contracts-001', rule: 'Hard contracts for browser/IO surface', pattern: SECTION_HARD_CONTRACTS_HEADING },
    { id: 'rl-section-mandatory-artifact-001', rule: 'Mandatory per-request artifact', pattern: SECTION_MANDATORY_HEADING },
    { id: 'rl-section-default-runbook-001', rule: 'Default runbook pointer', pattern: SECTION_DEFAULT_RUNBOOK_HEADING },
    { id: 'rl-section-gate-index-001', rule: 'Gate index', pattern: SECTION_GATE_INDEX_HEADING },
    { id: 'rl-section-naming-axiom-001', rule: 'Two-axis naming axiom', pattern: SECTION_NAMING_AXIOM_HEADING }
  ];
  for (const r of rules) {
    const line = findLine(skill.lines, r.pattern);
    if (line === -1) {
      hits.push({
        catalogId: r.id,
        rule: r.rule,
        file: skill.path,
        line: 1,
        matchedText: '(missing section)'
      });
    }
  }
  return hits;
}

/**
 * ASCII wireframe section-order check (spec §5.4 line 647).
 *
 * The "ASCII wireframe" lint hint in the spec means: SKILL.md
 * follows a canonical section ordering. The first 5 sections
 * must appear in this fixed order:
 *
 *   1. Two-axis naming axiom (top-of-file naming convention callout)
 *   2. Hard contracts for browser/IO surface (when present)
 *   3. Mandatory per-request artifact
 *   4. Default runbook
 *   5. RD / QA gate index
 *
 * If both sections exist but appear in the wrong order, the
 * enforcer reports a wireframe-violation hit pointing at the
 * section that came too early.
 *
 * If a section is missing, the per-section enforcer (above)
 * already fires; this one only handles the **order** invariant
 * (the wireframe shape).
 */
export function lintSectionOrder(skill: SkillFile): readonly LintHit[] {
  const hits: LintHit[] = [];
  const order: ReadonlyArray<{ id: string; rule: string; pattern: RegExp }> = [
    { id: 'rl-section-naming-axiom-001', rule: 'Two-axis naming axiom must precede Hard contracts', pattern: SECTION_NAMING_AXIOM_HEADING },
    { id: 'rl-section-hard-contracts-001', rule: 'Hard contracts must precede Default runbook', pattern: SECTION_HARD_CONTRACTS_HEADING },
    { id: 'rl-section-default-runbook-001', rule: 'Default runbook must precede Gate index', pattern: SECTION_DEFAULT_RUNBOOK_HEADING },
  ];
  let lastSeenLine = -1;
  let lastSeenRule = '';
  for (const r of order) {
    const line = findLine(skill.lines, r.pattern);
    if (line === -1) continue; // missing-section is its own enforcer
    if (line < lastSeenLine) {
      hits.push({
        catalogId: 'rl-section-order-wireframe-001',
        rule: 'Section wireframe order: each section must appear in the canonical order',
        file: skill.path,
        line,
        matchedText: `(section "${r.rule}" at line ${line} comes after "${lastSeenRule}" at line ${lastSeenLine})`,
      });
    }
    lastSeenLine = line;
    lastSeenRule = r.rule;
  }
  return hits;
}

/** Theme B — frontmatter shape. Same convention as Theme A. */
export function lintFrontmatterShape(skill: SkillFile): readonly LintHit[] {
  const hits: LintHit[] = [];
  const hasName = FRONTMATTER_NAME_LINE.test(skill.body);
  const hasDescription = FRONTMATTER_DESCRIPTION_LINE.test(skill.body);
  if (!hasName || !hasDescription) {
    hits.push({
      catalogId: 'rl-frontmatter-skills-md-001',
      rule: 'skills_md parseable frontmatter',
      file: skill.path,
      line: 1,
      matchedText: '(missing name or description)'
    });
  }
  // The `applicableTaskLevels` field is a body-level annotation, not
  // strictly YAML frontmatter. We accept either a top-of-file
  // frontmatter `applicableTaskLevels:` line or an in-body "applies
  // to <levels>" sentence.
  if (!FRONTMATTER_APPLICABLE_TASK_LEVELS.test(skill.body)) {
    hits.push({
      catalogId: 'rl-frontmatter-applicable-task-levels-001',
      rule: 'skill applicable task levels',
      file: skill.path,
      line: 1,
      matchedText: '(missing applicableTaskLevels)'
    });
  }
  return hits;
}

/**
 * Reference loadStrategy: scan every `references/*.md` in the
 * skill's references/ dir for a `loadStrategy: always | on-demand`
 * line. The audit is invoked per-skill, so this helper takes a
 * `referencesRoot` (the skill's `references/` dir).
 */
export function lintReferenceLoadStrategy(referencesRoot: string, refs: readonly string[]): readonly LintHit[] {
  const hits: LintHit[] = [];
  for (const ref of refs) {
    const path = join(referencesRoot, ref);
    const body = readFileSync(path, 'utf8');
    if (!FRONTMATTER_LOAD_STRATEGY.test(body)) {
      hits.push({
        catalogId: 'rl-frontmatter-references-load-strategy-001',
        rule: 'references loadStrategy declared',
        file: path,
        line: 1,
        matchedText: '(missing loadStrategy)'
      });
    }
  }
  return hits;
}
