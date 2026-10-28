/**
 * `src/services/skills/presence-role.ts`
 *
 * The role tier of a Peaks-Loop skill: `orchestrator` — a user-facing
 * workflow that owns the gate transitions — or `bee` — a 1-level sub-role
 * dispatched by an orchestrator and owning one stage.
 *
 * THE LIST IS THE OUTPUT-STYLE DOCUMENT'S. The response contract in
 * `.claude/output-styles/peaks-skill-swarm.md` names both tiers and the
 * skills in each; this module is that list in code, so the status header's
 * `Role` cell is a machine fact read from the presence projection rather
 * than a tier the model decides for itself.
 *
 * THE LIST IS COMPLETE OVER THE SHIPPED SKILLS. Every skill under `skills/`
 * is in exactly one tier, so the Role cell is never empty for a shipped skill;
 * one outside the shipped set yields `null`. The guard
 * `tests/unit/skills/presence-role-coverage.test.ts` holds the two copies together.
 *
 * AN UNKNOWN SKILL HAS NO TIER. A skill in neither list yields `null`; the
 * caller renders `null` rather than falling back to a tier that may be wrong.
 */

/** The two tiers the Peaks-Loop skill family is built from. */
export type PresenceRoleTier = 'orchestrator' | 'bee';

/** The 1-level skills that own the gate transitions. */
export const ORCHESTRATOR_ROLE_SKILLS: readonly string[] = [
  'peaks-code',
  'peaks-content',
  'peaks-doctor',
  'peaks-issue-fix-orchestrator',
  'peaks-solo',
  'peaks-ide',
  'peaks-sop',
  // The entry point of every peaks-* workflow: the goal is audited and
  // accepted here, before any PRD or RD skill may run. Nothing dispatches it.
  'peaks-audit',
  // The fast lane — a user-facing entry the user picks instead of the full workflow.
  'peaks-race-code',
  // The always-loaded entry that writes the skill pool and the local SkillHub:
  // the user reaches it by describing what they want, and it is never
  // dispatched by another skill.
  'peaks-maker'
];

/** The 1-level sub-roles an orchestrator dispatches. */
export const BEE_ROLE_SKILLS: readonly string[] = [
  'peaks-prd',
  'peaks-rd',
  'peaks-qa',
  'peaks-ui',
  'peaks-sc',
  'peaks-txt',
  'peaks-final-review',
  'peaks-resume',
  'peaks-status',
  'peaks-test',
  'peaks-reviewer',
  // One stage of a larger flow: it reads what the caller produced and
  // emits one artifact back to that caller.
  'peaks-slice-decompose',
  // One dimension audited, decoupled from the RD fan-out: one envelope,
  // written for the caller that asked for the audit.
  'peaks-perf-audit',
  'peaks-security-audit',
  // One stage of a larger flow: peaks-code and peaks-rd dispatch it after the
  // TACT chain exists, and it writes one measurement report back.
  'peaks-mut'
];

/** The two lists as ONE lookup, so a skill's tier is decided in one place. */
const ROLE_TIERS: ReadonlyMap<string, PresenceRoleTier> = new Map([
  ...ORCHESTRATOR_ROLE_SKILLS.map((skill): [string, PresenceRoleTier] => [skill, 'orchestrator']),
  ...BEE_ROLE_SKILLS.map((skill): [string, PresenceRoleTier] => [skill, 'bee'])
]);

/**
 * The tier of `skill`, or `null` when the skill is in neither list.
 *
 * Never throws and never guesses: a skill the family does not name has no
 * tier, and the status header renders that as "no tier" instead of inventing
 * one.
 */
export function presenceRoleTier(skill: string): PresenceRoleTier | null {
  return ROLE_TIERS.get(skill) ?? null;
}
