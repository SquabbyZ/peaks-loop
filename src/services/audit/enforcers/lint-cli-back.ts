/**
 * P2-a Theme D — CLI-back gaps enforcers.
 *
 * A red line that says "BLOCKING" / "MANDATORY" / "MUST NOT" / "MUST"
 * / "REQUIRED" must point at a `peaks *` enforcer in the
 * surrounding ±2 lines, or it stays as `prose-only` (per §5.2).
 *
 * The enforcer walks each skill body, locates every
 * `MANDATORY` / `BLOCKING` / `MUST NOT` marker, and reports an
 * orphan-hit when the surrounding text does NOT name a peaks CLI
 * command.
 */
import type { LintHit, SkillFile } from './lint-style.js';

const MANDATORY_PATTERN = /\bMANDATORY\b/;
const BLOCKING_PATTERN = /\bBLOCKING\b/;
const MUST_NOT_PATTERN = /\bMUST NOT\b/;
const PEAKS_CLI_PATTERN = /\bpeaks\s+[a-z][a-z0-9-]*/;

function findOrphans(
  skill: SkillFile,
  pattern: RegExp,
  catalogId: string,
  rule: string
): readonly LintHit[] {
  const hits: LintHit[] = [];
  for (let i = 0; i < skill.lines.length; i += 1) {
    const line = skill.lines[i] ?? '';
    if (!pattern.test(line)) continue;
    // Look at ±2 lines for a `peaks *` reference
    const ctx = skill.lines
      .slice(Math.max(0, i - 2), Math.min(skill.lines.length, i + 3))
      .join('\n');
    if (!PEAKS_CLI_PATTERN.test(ctx)) {
      hits.push({
        catalogId,
        rule,
        file: skill.path,
        line: i + 1,
        matchedText: line.trim()
      });
    }
  }
  return hits;
}

export function lintCliBackMandatorText(skill: SkillFile): readonly LintHit[] {
  return findOrphans(
    skill,
    MANDATORY_PATTERN,
    'rl-cli-back-mandatory-text-001',
    'MANDATORY text has peaks * enforcer in the surrounding ±2 lines'
  );
}

export function lintCliBackNoOrphanBlocking(skill: SkillFile): readonly LintHit[] {
  return findOrphans(
    skill,
    BLOCKING_PATTERN,
    'rl-cli-back-no-orphan-blocking-001',
    'no orphan BLOCKING marker without a peaks * enforcer'
  );
}

export function lintCliBackNoOrphanMustNot(skill: SkillFile): readonly LintHit[] {
  return findOrphans(
    skill,
    MUST_NOT_PATTERN,
    'rl-cli-back-no-orphan-must-not-001',
    'no orphan MUST NOT marker without a peaks * enforcer'
  );
}
