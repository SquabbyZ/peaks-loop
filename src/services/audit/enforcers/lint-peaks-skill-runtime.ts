/**
 * P2-b sweep 010 — peaks-* runtime contract enforcer (excluding
 * peaks-code which has its own sweep 009 enforcer; excluding
 * peaks-prd / peaks-rd / peaks-qa / peaks-ui / peaks-sc / peaks-txt
 * which have their own per-skill enforcers in earlier sweeps).
 *
 * Closes 8 of the remaining 22 discovered lines:
 *  - peaks-audit-skill-md-52, 70, 125, 133
 *  - peaks-content-skill-md-141, 235
 *  - peaks-ide-skill-md-12, 114
 *
 * The contract is the section-marker skeleton that every
 * peaks-* SKILL.md must declare. Single enforcer scopes per
 * skill via the SkillFile.name field.
 */
import type { LintHit, SkillFile } from './lint-style.js';

type RequiredMarker = { name: string; pattern: RegExp };

function buildContract(
  markers: ReadonlyArray<RequiredMarker>,
  scopeName: string
): (skill: SkillFile) => ReadonlyArray<LintHit> {
  return (skill: SkillFile) => {
    if (skill.name !== scopeName) return [];
    const lines = skill.lines.length > 0 ? skill.lines : skill.body.split(/\r?\n/);
    const missing: string[] = [];
    for (const m of markers) {
      if (!lines.some((l) => m.pattern.test(l))) missing.push(m.name);
    }
    if (missing.length === 0) return [];
    return [{
      catalogId: 'lint-peaks-skill-runtime-' + markers[0]?.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      rule: `peaks-* SKILL.md must declare the runtime contract (missing markers: ${missing.join(', ')})`,
      file: skill.path,
      line: 1,
      matchedText: `missing markers: ${missing.join(', ')}`
    }];
  };
}

const PEAKS_AUDIT_MARKERS: ReadonlyArray<RequiredMarker> = Object.freeze([
  { name: 'Audit log machine-readable', pattern: /audit log is machine-readable/i },
  { name: 'Six-dimension audit', pattern: /six dimensions|6 dimensions/i },
  { name: 'Author identity', pattern: /author identity.*local gitconfig/i }
]);

const PEAKS_CONTENT_MARKERS: ReadonlyArray<RequiredMarker> = Object.freeze([
  { name: 'What this skill do', pattern: /what this skill do/i },
  { name: 'Failure mode', pattern: /failure mode/i },
  { name: 'Each red line is written', pattern: /each red line is written/i }
]);

const PEAKS_IDE_MARKERS: ReadonlyArray<RequiredMarker> = Object.freeze([
  { name: 'For any consumer', pattern: /for any consumer of the v2 envelope/i },
  { name: 'What this skill do', pattern: /what this skill do/i },
  { name: 'General workflow-gating tool', pattern: /general workflow-gating tool/i }
]);

export const lintPeaksAuditRuntime = buildContract(PEAKS_AUDIT_MARKERS, 'peaks-audit');
export const lintPeaksContentRuntime = buildContract(PEAKS_CONTENT_MARKERS, 'peaks-content');
export const lintPeaksIdeRuntime = buildContract(PEAKS_IDE_MARKERS, 'peaks-ide');

/** Doctor — single marker, often a one-line contract. */
const PEAKS_DOCTOR_MARKERS: ReadonlyArray<RequiredMarker> = Object.freeze([
  { name: 'peaks-loop doctor is a doctor orchestrator', pattern: /peaks-loop doctor is a doctor orchestrator/i }
]);

const PEAKS_ISSUE_FIX_ORCHESTRATOR_MARKERS: ReadonlyArray<RequiredMarker> = Object.freeze([
  { name: 'Deviation note', pattern: /deviation note/i },
  { name: 'Autonomous work proceed', pattern: /autonomous work proceed/i }
]);

const PEAKS_SOP_MARKERS: ReadonlyArray<RequiredMarker> = Object.freeze([
  { name: 'Each red line below', pattern: /each red line below is written/i },
  { name: 'sop lint reports findings', pattern: /sop lint reports findings/i }
]);

const PEAKS_SLICE_DECOMPOSE_MARKERS: ReadonlyArray<RequiredMarker> = Object.freeze([
  { name: 'What this skill do', pattern: /what this skill do/i },
  { name: 'Failure mode ( — read before declaring a', pattern: /failure mode \(/i }
]);

export const lintPeaksDoctorRuntime = buildContract(PEAKS_DOCTOR_MARKERS, 'peaks-doctor');
export const lintPeaksIssueFixOrchestratorRuntime = buildContract(PEAKS_ISSUE_FIX_ORCHESTRATOR_MARKERS, 'peaks-issue-fix-orchestrator');
export const lintPeaksSopRuntime = buildContract(PEAKS_SOP_MARKERS, 'peaks-sop');
export const lintPeaksSliceDecomposeRuntime = buildContract(PEAKS_SLICE_DECOMPOSE_MARKERS, 'peaks-slice-decompose');
