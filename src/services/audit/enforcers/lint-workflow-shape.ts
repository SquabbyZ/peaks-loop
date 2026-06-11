/**
 * P2-a Theme F - workflow-bound shape enforcers.
 *
 * Static pattern scans of openspec/changes/STAR/proposal.md, the
 * rd/tech-doc.md template, and the request-artifact-writing skills
 * for canonical shape (acceptance bullets, spec reference,
 * red-line scope, peaks-doctor acknowledgement).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { LintHit, SkillFile } from './lint-style.js';

const AC_BULLET_PATTERN = /^\s*-\s+\S/m;
const SPEC_REFERENCE_HEADING = /^##\s+Spec reference(?:\s+\(canonical\))?\s*$/im;
const RED_LINE_SCOPE_HEADING = /^##\s+Red-line scope\s*$/im;
const IMPL_EVIDENCE_HEADING = /^##\s+Implementation evidence\s*$/im;
const PEAKS_DOCTOR_PATTERN = /\bpeaks[- ]doctor\b/i;

export function lintOpenSpecAcceptanceBullets(projectRoot: string): readonly LintHit[] {
  const openspecDir = join(projectRoot, 'openspec', 'changes');
  if (!existsSync(openspecDir)) return [];
  const hits: LintHit[] = [];
  for (const entry of readdirSync(openspecDir)) {
    const stat = statSync(join(openspecDir, entry));
    if (!stat.isDirectory()) continue;
    const proposal = join(openspecDir, entry, 'proposal.md');
    if (!existsSync(proposal)) continue;
    const body = readFileSync(proposal, 'utf8');
    // Slice ## Acceptance Criteria heading.
    const acMatch = /##\s+Acceptance Criteria\s*$/im.exec(body);
    if (acMatch === null) {
      hits.push({
        catalogId: 'rl-openspec-proposal-has-acceptance-bullets-001',
        rule: 'openspec proposal has non-empty Acceptance Criteria bullets',
        file: proposal,
        line: 1,
        matchedText: '(missing ## Acceptance Criteria heading)'
      });
      continue;
    }
    // Capture everything from ## Acceptance Criteria up to the next ## heading.
    const tail = body.slice(acMatch.index + acMatch[0].length);
    const nextHeading = tail.search(/^##\s/m);
    const acBlock = nextHeading === -1 ? tail : tail.slice(0, nextHeading);
    if (!AC_BULLET_PATTERN.test(acBlock)) {
      hits.push({
        catalogId: 'rl-openspec-proposal-has-acceptance-bullets-001',
        rule: 'openspec proposal has non-empty Acceptance Criteria bullets',
        file: proposal,
        line: 1,
        matchedText: '(no `- ` bullet under ## Acceptance Criteria)'
      });
    }
  }
  return hits;
}

export function lintOpenSpecSpecReference(projectRoot: string): readonly LintHit[] {
  const openspecDir = join(projectRoot, 'openspec', 'changes');
  if (!existsSync(openspecDir)) return [];
  const hits: LintHit[] = [];
  for (const entry of readdirSync(openspecDir)) {
    const stat = statSync(join(openspecDir, entry));
    if (!stat.isDirectory()) continue;
    const proposal = join(openspecDir, entry, 'proposal.md');
    if (!existsSync(proposal)) continue;
    const body = readFileSync(proposal, 'utf8');
    if (!SPEC_REFERENCE_HEADING.test(body)) {
      hits.push({
        catalogId: 'rl-openspec-proposal-has-spec-changes-001',
        rule: 'openspec proposal has Spec reference (canonical) link',
        file: proposal,
        line: 1,
        matchedText: '(missing ## Spec reference (canonical) heading)'
      });
    }
  }
  return hits;
}

export function lintTechDocPresenceShape(projectRoot: string): readonly LintHit[] {
  // Scan every session's rd/tech-doc.md for the two required
  // sections. The session dir is .peaks/_runtime/<sid>/.
  const runtimeDir = join(projectRoot, '.peaks', '_runtime');
  if (!existsSync(runtimeDir)) return [];
  const hits: LintHit[] = [];
  for (const sessionEntry of readdirSync(runtimeDir)) {
    const sessionDir = join(runtimeDir, sessionEntry);
    const stat = statSync(sessionDir);
    if (!stat.isDirectory()) continue;
    const techDoc = join(sessionDir, 'rd', 'tech-doc.md');
    if (!existsSync(techDoc)) continue;
    const body = readFileSync(techDoc, 'utf8');
    if (!RED_LINE_SCOPE_HEADING.test(body) || !IMPL_EVIDENCE_HEADING.test(body)) {
      hits.push({
        catalogId: 'rl-tech-doc-presence-pre-rd-001',
        rule: 'rd/tech-doc.md has Red-line scope + Implementation evidence',
        file: techDoc,
        line: 1,
        matchedText: '(missing ## Red-line scope or ## Implementation evidence)'
      });
    }
  }
  return hits;
}

export function lintPeaksDoctorAcknowledged(skill: SkillFile): readonly LintHit[] {
  // The enforcer fires only for skills that write a request
  // artifact (rd / qa / prd / ui / sc / txt) — detected by the
  // presence of `peaks request init` or `peaks request show` in
  // the body.
  const writesRequestArtifact = /\bpeaks\s+request\s+(init|show|transition)\b/.test(skill.body);
  if (!writesRequestArtifact) return [];
  if (PEAKS_DOCTOR_PATTERN.test(skill.body)) return [];
  return [{
    catalogId: 'rl-peaks-doctor-skill-acknowledged-001',
    rule: 'skill that writes a request artifact acknowledges peaks doctor',
    file: skill.path,
    line: 1,
    matchedText: '(no peaks doctor / peaks-doctor mention in skill body)'
  }];
}
