/**
 * `src/services/code/mode-gate-types.ts`
 *
 * The declaration surface of the D5 gate: the mode alias, the gated-step
 * vocabulary, and the commit-boundary vocabulary with its regex matchers.
 * Extracted verbatim from `mode-gate.ts` (wave 3, file-size cap campaign) so
 * the gate module stays under the 300 raw-line cap. Mechanical move only — no
 * decision logic lives here. `mode-gate.ts` imports and re-exports every name
 * below, so importers keep resolving them from `mode-gate.js` unchanged.
 *
 * The hard-floor vocabulary deliberately does NOT live here:
 * `feedback-promotion` certifies a layer-C rule by reading
 * `HardFloorCategory` and `HARD_FLOOR_CATEGORIES` out of `mode-gate.ts`
 * itself (see `promotion-artifact-evidence.ts`).
 */

import type { SkillPresenceMode } from '../skills/skill-presence-service.js';

export type CodeMode = SkillPresenceMode;

export const CODE_MODES: readonly CodeMode[] = ['full-auto', 'assisted', 'strict', '24h'] as const;

/**
 * The 14 SKILL.md AskUserQuestion sites mapped in the D5 memory's
 * "Inventory of unconditional confirmation gates" table. Each row
 * is the bare minimum needed to gate it through `shouldPauseAtGate`.
 */
export type GatedStepId =
  | 'step-0.5-openspec-opt-in'
  | 'step-0.6-audit-goal'
  | 'step-0.7-resume-detection'
  | 'step-1-mode-select'
  | 'step-2.5-session-title'
  | 'phase-2-prd-confirm'
  | 'phase-3-swarm-gate-b'
  | 'phase-6-qa-gate-d'
  | 'phase-10-txt-memory-extract'
  | 'step-n+1-final-review'
  | 'frontend-only-mismatch'
  | 'step-0.75-checkpoint-resume'
  | 'standards-preflight';

export const GATED_STEPS: readonly GatedStepId[] = [
  'step-0.5-openspec-opt-in',
  'step-0.6-audit-goal',
  'step-0.7-resume-detection',
  'step-1-mode-select',
  'step-2.5-session-title',
  'phase-2-prd-confirm',
  'phase-3-swarm-gate-b',
  'phase-6-qa-gate-d',
  'phase-10-txt-memory-extract',
  'step-n+1-final-review',
  'frontend-only-mismatch',
  'step-0.75-checkpoint-resume',
  'standards-preflight'
] as const;

/**
 * v2.15.0 slice 002 AC-4: the 5 action identifiers that qualify as
 * commit-boundary side effects. Matched by the LLM-side caller
 * (peaks-code body / peaks-rd fork agent) when it is about to run a
 * Bash command that maps to one of these. Set `commitBoundaryAction:
 * true` on the `shouldPauseAtGate` call to trigger the hard-floor
 * override.
 */
export type CommitBoundaryActionId =
  'git-push' | 'git-tag' | 'npm-publish' | 'npm-install-global' | 'peaks-global-install';

export const COMMIT_BOUNDARY_ACTIONS: readonly CommitBoundaryActionId[] = [
  'git-push',
  'git-tag',
  'npm-publish',
  'npm-install-global',
  'peaks-global-install'
] as const;

/**
 * v2.15.0 slice 002 AC-4: regex matchers the LLM-side caller uses
 * to flag a Bash command as a commit-boundary action. Centralised
 * here so the test seam + the CLI wiring share one source of
 * truth. Each entry is an anchored pattern matched against the
 * user-invoked command (after commander / shell normalisation,
 * before execution).
 *
 * Patterns intentionally cover the common canonical forms:
 *
 *   - `git-push`            → `git push`, `git push origin main`, `git push --tags`
 *   - `git-tag`             → `git tag v2.15.0`, `git tag -a v2.15.0 -m ...`
 *   - `npm-publish`         → `npm publish`, `npm publish --access public`
 *   - `npm-install-global`  → `npm install -g <pkg>`, `npm i -g <pkg>`
 *   - `peaks-global-install`→ `npm install -g peaks-loop`, `pnpm add -g peaks-loop`
 *
 * These are coarse — false positives are fine (worst case: a
 * non-actionable command gets paused for confirmation; the user
 * can confirm in one click). False negatives are NOT fine — a
 * missed publish would violate the full-auto boundary.
 */
export const COMMIT_BOUNDARY_PATTERNS: Readonly<Record<CommitBoundaryActionId, RegExp>> = {
  'git-push': /\bgit\s+push\b/,
  'git-tag': /\bgit\s+tag\b/,
  'npm-publish': /\bnpm\s+(publish|pub)\b/,
  'npm-install-global': /\bnpm\s+(install|i|add)\s+(-g|--global)\b/,
  'peaks-global-install': /\b(peaks-loop)\b/
};
