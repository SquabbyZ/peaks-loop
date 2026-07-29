/**
 * P2-b sweep — PRD source-snapshot placement enforcer.
 *
 * Targets the BLOCKING markers around the peaks-prd
 * "Document snapshot placement" + "Prohibited paths" guidance
 * (rl-discovered-skills-bee-peaks-prd-skill-md-292 + 301).
 * The contract: PRD source snapshots from external documents
 * (Feishu / Lark / wiki / web) MUST go to
 * `.peaks/_runtime/<sessionId>/prd/source/`, never to the
 * project root.
 *
 * The enforcer pattern-scans the peaks-prd SKILL.md for the
 * required guidance phrasing. Two hits (placement heading +
  * prohibited-paths line) are both required for a clean
 * enforcer pass. A single missing item emits a synthetic hit
 * pointing at the line the user is most likely to look at
 * (the placement heading line, or line 1 if missing).
 *
 * This is the second prose-only enforcer in the sweep
 * (after lint-skill-presence-mandatory.ts). It demonstrates
 * the path for the remaining 65 discovered lines: each
 * enforcer is small, single-purpose, and has its own catalog
 * entry. The catalog governance ratio will tick down with
 * every enforcer shipped.
 */
import type { LintHit, SkillFile } from './lint-style.js';

const PLACEMENT_HEADING = /^##\s+.*Document snapshot placement/im;
const PROHIBITED_PATHS = /Prohibited paths/im;
const SOURCE_SUBDIR = /\.peaks\/_runtime\/<session-id>\/prd\/source\//;

function findPrdSourceSnapshotGuidance(lines: ReadonlyArray<string>): { placementLine: number | null; hasProhibited: boolean; hasSubdir: boolean } {
  let placementLine: number | null = null;
  let hasProhibited = false;
  let hasSubdir = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (PLACEMENT_HEADING.test(line)) {
      placementLine = i + 1;
      // Look ahead up to 30 lines for the prohibited-paths
      // line + the source subdir reference.
      for (let j = i; j < Math.min(i + 30, lines.length); j++) {
        const next = lines[j] ?? '';
        if (PROHIBITED_PATHS.test(next)) hasProhibited = true;
        if (SOURCE_SUBDIR.test(next)) hasSubdir = true;
      }
      break;
    }
  }
  return { placementLine, hasProhibited, hasSubdir };
}

export function lintPrdSourceSnapshot(skill: SkillFile): ReadonlyArray<LintHit> {
  // Scope: peaks-prd only. Other bee skills do not have the
  // source-snapshot contract.
  if (skill.name !== 'peaks-prd') return [];
  const lines = skill.lines.length > 0
    ? skill.lines
    : skill.body.split(/\r?\n/);
  const { placementLine, hasProhibited, hasSubdir } = findPrdSourceSnapshotGuidance(lines);
  if (placementLine !== null && hasProhibited && hasSubdir) return [];
  const detail = placementLine === null
    ? 'missing `## Document snapshot placement` heading'
    : `placement heading at line ${placementLine} but guidance incomplete (prohibited=${hasProhibited}, subdir=${hasSubdir})`;
  return [{
    catalogId: 'rl-prd-source-snapshot-placement-001',
    rule: 'PRD source-snapshot placement (BLOCKING): external-document snapshots must land in .peaks/_runtime/<sessionId>/prd/source/, never project root',
    file: skill.path,
    line: placementLine ?? 1,
    matchedText: detail
  }];
}
