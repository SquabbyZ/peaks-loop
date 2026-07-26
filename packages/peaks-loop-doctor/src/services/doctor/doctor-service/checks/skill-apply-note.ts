/**
 * Check: destructive `--apply` commands in the runbook carry an
 * authorization/dry-run note (`skill-apply-note:<skill-name>`).
 *
 * Emits one `DoctorCheck` per *required* skill that has a
 * `## Default runbook` section. The check extracts the runbook
 * section, scans it for known destructive `--apply` patterns
 * (`peaks memory sync --apply`, `peaks openspec archive --apply`,
 * etc.), and requires an authorization-style note when any match
 * is found. Skills with no destructive `--apply` commands emit a
 * passing "no destructive --apply commands to gate" check so the
 * CLI summary still surfaces a 1:1 row per required skill.
 *
 * The destructive-apply regex table and authorization keyword regex
 * live in this file (not a shared util) because they are doctor-
 * internal heuristics; the CLI's `runs/apply.ts` has its own
 * (slightly different) authorisation gate.
 */

import { readText } from 'peaks-loop-shared/fs';
import { requiredSkillNames } from 'peaks-loop-shared/paths';
import { getErrorMessage } from 'peaks-loop-shared/result';

import type { DoctorCheck, DoctorCheckPlugin, DoctorContext } from '../types.js';

const REQUIRED_SKILL_NAMES = new Set<string>(requiredSkillNames);

const DESTRUCTIVE_APPLY_PATTERNS: ReadonlyArray<RegExp> = [
  /peaks\s+memory\s+sync[^\n]*--apply/,
  /peaks\s+memory\s+extract[^\n]*--apply/,
  /peaks\s+artifacts\s+sync[^\n]*--apply/,
  /peaks\s+openspec\s+archive[^\n]*--apply/,
  /peaks\s+standards\s+(?:init|update)[^\n]*--apply/
];

const AUTHORIZATION_KEYWORDS_PATTERN = /authoriz|explicit|--dry-run|approv|only after|only when/i;

function extractRunbookSection(body: string): string | null {
  const match = /## Default runbook\n+([\s\S]*?)(?=\n## |$)/.exec(body);
  return match === null ? null : (match[1] ?? null);
}

function findDestructiveApplyLines(section: string): string[] {
  const lines = section.split(/\r?\n/);
  return lines.filter((line) => DESTRUCTIVE_APPLY_PATTERNS.some((pattern) => pattern.test(line)));
}

async function run({ registry }: DoctorContext): Promise<readonly DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  for (const skill of registry.skills) {
    if (!REQUIRED_SKILL_NAMES.has(skill.name)) {
      continue;
    }
    try {
      const body = await readText(skill.skillPath);
      const runbookSection = extractRunbookSection(body);
      if (runbookSection === null) {
        // No runbook section → the runbook check is the canonical
        // signal for this failure; we intentionally do NOT emit a
        // second `skill-apply-note:<name>` here so the doctor
        // summary surfaces exactly one row per required skill.
        continue;
      }
      const destructiveLines = findDestructiveApplyLines(runbookSection);
      if (destructiveLines.length === 0) {
        checks.push({
          id: `skill-apply-note:${skill.name}`,
          ok: true,
          message: `Skill ${skill.name} runbook has no destructive --apply commands to gate`
        });
        continue;
      }
      const hasAuthorizationNote = AUTHORIZATION_KEYWORDS_PATTERN.test(runbookSection);
      checks.push({
        id: `skill-apply-note:${skill.name}`,
        ok: hasAuthorizationNote,
        message: hasAuthorizationNote
          ? `Skill ${skill.name} gates ${destructiveLines.length} destructive --apply command(s) with an authorization note`
          : `Skill ${skill.name} has ${destructiveLines.length} destructive --apply command(s) without an authorization/dry-run note in the runbook section`
      });
    } catch (error) {
      // Mirror the legacy behaviour: a read failure surfaces as a
      // runbook failure (already emitted by the runbook check) and
      // does NOT double-report here.
      void getErrorMessage(error);
    }
  }
  return checks;
}

export const check: DoctorCheckPlugin = {
  name: 'skill-apply-note',
  run
};