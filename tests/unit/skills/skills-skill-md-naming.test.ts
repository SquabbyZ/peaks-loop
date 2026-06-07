import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * Regression test for slice 006-5th-writer-changeid-path.
 *
 * Asserts that the 3 peaks-* SKILL.md files (`peaks-solo`, `peaks-rd`,
 * `peaks-qa`) use the two-axis naming convention consistently. The original
 * `<sid>` placeholder was ambiguous between the change-id axis (reviewable
 * artifacts) and the session-id axis (ephemeral state), which caused the
 * slice 005 closeout handoff to mis-classify a legitimate change-axis write
 * as a regression. This test pins the convention mechanically.
 *
 * See:
 *   - PRD: .peaks/_runtime/2026-06-06-session-5b1095/prd/requests/010-006-5th-writer-changeid-path.md
 *   - RD:  .peaks/_runtime/2026-06-06-session-5b1095/rd/requests/007-006-5th-writer-changeid-path.md
 *   - "Two-axis naming convention" callout at the top of each SKILL.md
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..');

interface SkillFile {
  name: string;
  relativePath: string;
}

const SKILL_FILES: SkillFile[] = [
  { name: 'peaks-solo', relativePath: 'skills/peaks-solo/SKILL.md' },
  { name: 'peaks-rd',   relativePath: 'skills/peaks-rd/SKILL.md' },
  { name: 'peaks-qa',   relativePath: 'skills/peaks-qa/SKILL.md' },
];

const CALLOUT_HEADING = '## Two-axis naming convention';

/**
 * The "Two-axis naming convention" callout itself discusses the `<sid>`
 * placeholder as a concept (it has to, in order to explain the bug). Any
 * `<sid>` mention inside the callout is exempt from AC-1 (zero bare
 * `<sid>`). This function returns the index where the callout ends so the
 * outer AC-1 assertion can skip the callout region.
 */
function findCalloutEndIndex(content: string): number {
  const start = content.indexOf(CALLOUT_HEADING);
  if (start < 0) {
    return -1;
  }
  // The callout runs from the heading up to (but not including) the next
  // H1 ("# ") heading, which is the file's body title.
  const afterHeading = content.indexOf('\n# ', start);
  return afterHeading >= 0 ? afterHeading : content.length;
}

/**
 * AC-1: zero bare `<sid>` placeholders outside the callout.
 * A bare `<sid>` is `<sid>` not followed/preceded by `-` or another letter
 * (so `<session-id>` and `<sid-extra>` are exempt; only the exact `<sid>`
 * token is flagged).
 */
function findBareSidMentions(content: string): Array<{ line: number; text: string }> {
  const calloutStart = content.indexOf(CALLOUT_HEADING);
  const calloutEnd = findCalloutEndIndex(content);

  const lines = content.split('\n');
  const hits: Array<{ line: number; text: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    // Skip the callout region (calloutStart line through calloutEnd line).
    const lineStartOffset = content.indexOf(line);
    if (calloutStart >= 0 && calloutEnd >= 0
        && lineStartOffset >= calloutStart
        && lineStartOffset < calloutEnd) {
      continue;
    }
    // Match <sid> as a whole token (not <session-id>, <sid-foo>, etc.).
    const matches = line.match(/(?<![\w-])<sid>(?![\w-])/g);
    if (matches && matches.length > 0) {
      hits.push({ line: i + 1, text: line.trim().slice(0, 200) });
    }
  }
  return hits;
}

/**
 * AC-2: every `.peaks/<X>/` reference is annotated with the right axis label.
 * Allowlist:
 *   - `.peaks/_runtime/<sessionId>` / `.peaks/_runtime/<session-id>` (session-axis)
 *   - `.peaks/_sub_agents/<sessionId>` / `.peaks/_sub_agents/<session-id>` (sub-agent-axis)
 *   - `.peaks/<changeId>` / `.peaks/<change-id>` (change-axis root)
 * Anything else is flagged.
 */
const ALLOWED_PEAKS_PATTERNS: RegExp[] = [
  // session-axis: `_runtime/...`
  /\.peaks\/_runtime\/<session-?id>/gi,
  // sub-agent-axis: `_sub_agents/...`
  /\.peaks\/_sub_agents\/<session-?id>/gi,
  // change-axis: root `.peaks/<changeId>/...` (must NOT be inside `_runtime/`)
  /\.peaks\/<change-?id>/gi,
  // `.peaks/` followed by a path that uses a non-axis placeholder like
  // <rid> or <repo> is allowed (e.g. `.peaks/<rid>/...` or `.peaks/<repo>/...`).
  /\.peaks\/<(rid|repo|role|ext|batchId|dispatchRecordPath|evidence-path|state-or-step)>/g,
  // `.peaks/.session.json` / `.peaks/.active-skill.json` (dotfiles, not dirs).
  /\.peaks\/\.[a-z][a-z0-9-]*\.json/g,
  // `.peaks/` followed by a static literal subdir (no placeholder).
  /\.peaks\/[a-z_][a-z0-9_]*\//g,
];

interface PeaksRefHit {
  line: number;
  text: string;
  match: string;
}

function findUnannotatedPeaksRefs(content: string): PeaksRefHit[] {
  const calloutStart = content.indexOf(CALLOUT_HEADING);
  const calloutEnd = findCalloutEndIndex(content);

  // Find every `.peaks/<X>/` reference (any placeholder after `.peaks/`).
  const refRegex = /\.peaks\/<[^>]+>\//g;
  const lines = content.split('\n');
  const hits: PeaksRefHit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const lineStartOffset = content.indexOf(line);
    if (calloutStart >= 0 && calloutEnd >= 0
        && lineStartOffset >= calloutStart
        && lineStartOffset < calloutEnd) {
      continue;
    }
    let match: RegExpExecArray | null;
    refRegex.lastIndex = 0;
    while ((match = refRegex.exec(line)) !== null) {
      const ref = match[0];
      // Check against allowlist patterns.
      const allowed = ALLOWED_PEAKS_PATTERNS.some((pattern) => {
        pattern.lastIndex = 0;
        return pattern.test(ref);
      });
      if (!allowed) {
        hits.push({ line: i + 1, text: line.trim().slice(0, 200), match: ref });
      }
    }
  }
  return hits;
}

/**
 * AC-3: each SKILL.md has the "Two-axis naming convention" callout.
 * The callout must be present at the top of the file (after the YAML
 * frontmatter, before the first H1). Concretely, the callout's H2 heading
 * must appear before the first `# ` H1 heading.
 */
function hasCalloutAtTop(content: string): { ok: boolean; reason: string } {
  const yamlEnd = content.indexOf('\n---\n', content.indexOf('---') + 3);
  if (yamlEnd < 0) {
    return { ok: false, reason: 'no YAML frontmatter terminator found' };
  }
  const afterFrontmatter = content.slice(yamlEnd + '\n---\n'.length);
  const calloutIdx = afterFrontmatter.indexOf(CALLOUT_HEADING);
  if (calloutIdx < 0) {
    return { ok: false, reason: 'callout heading not found after frontmatter' };
  }
  // Find the first H1 after the frontmatter.
  const firstH1Match = afterFrontmatter.match(/^# /m);
  if (!firstH1Match) {
    return { ok: false, reason: 'no H1 body title after frontmatter' };
  }
  const firstH1Idx = firstH1Match.index ?? -1;
  if (calloutIdx >= firstH1Idx) {
    return { ok: false, reason: `callout at offset ${calloutIdx} is AFTER first H1 at offset ${firstH1Idx} (must be before)` };
  }
  return { ok: true, reason: '' };
}

describe('skills SKILL.md naming convention (slice 006-5th-writer-changeid-path)', () => {
  for (const skill of SKILL_FILES) {
    describe(`${skill.name} SKILL.md`, () => {
      const absolutePath = resolve(REPO_ROOT, skill.relativePath);
      const content = readFileSync(absolutePath, 'utf8');

      test('AC-1: contains zero bare <sid> placeholders (outside the callout)', () => {
        const hits = findBareSidMentions(content);
        if (hits.length > 0) {
          const formatted = hits.map((h) => `  line ${h.line}: ${h.text}`).join('\n');
          throw new Error(
            `Found ${hits.length} bare <sid> placeholder(s) in ${skill.relativePath} ` +
            `(must be 0 outside the "Two-axis naming convention" callout):\n${formatted}`
          );
        }
        expect(hits).toHaveLength(0);
      });

      test('AC-2: every .peaks/<X>/ reference uses an unambiguous axis label', () => {
        const hits = findUnannotatedPeaksRefs(content);
        if (hits.length > 0) {
          const formatted = hits.map((h) => `  line ${h.line}: ${h.match} — ${h.text}`).join('\n');
          throw new Error(
            `Found ${hits.length} unannotated .peaks/<X>/ reference(s) in ${skill.relativePath}. ` +
            `Each .peaks/<X>/ reference MUST use one of: <changeId>/<change-id> (change-axis root), ` +
            `<sessionId>/<session-id> (session-axis via .peaks/_runtime/ or .peaks/_sub_agents/).\n${formatted}`
          );
        }
        expect(hits).toHaveLength(0);
      });

      test('AC-3: has the "Two-axis naming convention" callout at the top of the file', () => {
        const result = hasCalloutAtTop(content);
        if (!result.ok) {
          throw new Error(`${skill.relativePath}: ${result.reason}`);
        }
        expect(result.ok).toBe(true);
      });
    });
  }
});
