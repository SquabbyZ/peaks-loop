/**
 * P2-b (Slice #6+1) — Skill presence MANDATORY enforcer.
 *
 * Targets the `peaks-prd` / `peaks-rd` / `peaks-qa` SKILL.md
 * "Skill presence (MANDATORY first action)" heading that the
 * audit classified as `rl-discovered-skills-bee-peaks-prd-skill-md-56`
 * (and the parallel peaks-rd / peaks-qa lines). The marker
 * MANDATORY + the phrase "Skill presence" + "first action" are
 * all required; if any of the three is missing on a `peaks-*`
 * SKILL.md the enforcer emits a synthetic hit so the audit
 * report can render the entry.
 *
 * This file is a single-purpose enforcer (one enforcerRef per
 * catalog entry). It deliberately does NOT cover every
 * discovered prose-only line — the next rid (catalog
 * governance sweep) is the right place to add the rest. This
 * commit's goal is to close the first one and prove the
 * catalog-entry + enforcerRef + test path works end-to-end.
 *
 * No new deps. No shell-out. No FS writes. The enforcer
 * function is sync + side-effect-free so the audit hot path
 * stays fast.
 */
import type { LintHit, SkillFile } from './lint-style.js';

const SKILL_PRESENCE_HEADING = /^##\s+Skill presence\s*\([^)]*MANDATORY[^)]*first action\)/im;
const SKILL_PRESENCE_BODY = /immediately run:/i;
const MANDATORY_MARKER = /\bMANDATORY\b/;

const TARGET_SKILL_PREFIX = 'peaks-';

function findSkillPresenceSection(lines: ReadonlyArray<string>): { heading: number | null; bodyOk: boolean; hasMarker: boolean } {
  let heading: number | null = null;
  let bodyOk = false;
  let hasMarker = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (SKILL_PRESENCE_HEADING.test(line)) {
      heading = i + 1;
      // Look ahead up to 8 lines for the body / marker.
      for (let j = i; j < Math.min(i + 8, lines.length); j++) {
        const next = lines[j] ?? '';
        if (SKILL_PRESENCE_BODY.test(next)) bodyOk = true;
        if (MANDATORY_MARKER.test(next)) hasMarker = true;
      }
      break;
    }
  }
  return { heading, bodyOk, hasMarker };
}

export function lintSkillPresenceMandatory(skill: SkillFile): ReadonlyArray<LintHit> {
  // Scope: peaks-* bee SKILL.md. The path check is the primary
  // gate; the name check is a defense-in-depth guard for callers
  // that pass a skill whose name does not match its path
  // (e.g. tests with a synthetic SkillFile).
  if (!skill.path.includes('skills/bee/')) return [];
  if (!skill.name.startsWith(TARGET_SKILL_PREFIX)) return [];
  // Reconstruct lines from body (the SkillFile interface exposes body
  // and lines; for compatibility, prefer lines if non-empty).
  const lines = skill.lines.length > 0
    ? skill.lines
    : skill.body.split(/\r?\n/);
  const { heading, bodyOk, hasMarker } = findSkillPresenceSection(lines);
  if (heading !== null && bodyOk && hasMarker) return [];
  const detail = heading === null
    ? 'missing `## Skill presence (MANDATORY first action)` heading'
    : `heading present at line ${heading} but body/marker incomplete (body=${bodyOk}, marker=${hasMarker})`;
  return [{
    catalogId: 'rl-skill-presence-mandatory-001',
    rule: 'Skill presence (MANDATORY first action) — peaks-* bee SKILL.md must declare the section',
    file: skill.path,
    line: heading ?? 1,
    matchedText: detail
  }];
}
