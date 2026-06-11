/**
 * L1a task classification — types and per-level gate sets.
 *
 * Spec: docs/superpowers/specs/2026-06-11-peaks-cli-l1-l2-l3-redesign.md §4
 *
 * Five task levels: typo / bug / feature / refactor / migration. Each
 * level has a gate set (the "配套 gate set" — L1b) that the slice
 * checker runs. Higher levels = more gates = slower but safer.
 *
 * The classification is a HYBRID mechanism:
 *   1. Heuristic signal (file count, line count, keyword presence)
 *   2. User override (`peaks classify override --level <level> --reason "<>"`)
 *   3. Audit log of every classification (forensics)
 *
 * Conservatism modifier (per .peaks/preferences.json:classifyConservatism):
 *   - 'default' — use the signal thresholds as-is
 *   - 'strict'  — always upgrade to next level
 *   - 'lax'     — always downgrade to previous level
 */

export type TaskLevel = 'typo' | 'bug' | 'feature' | 'refactor' | 'migration';

export const TASK_LEVELS: readonly TaskLevel[] = ['typo', 'bug', 'feature', 'refactor', 'migration'] as const;

/** Numeric ordering for "next level" / "previous level" promotion. */
export const TASK_LEVEL_ORDER: Readonly<Record<TaskLevel, number>> = {
  typo: 0,
  bug: 1,
  feature: 2,
  refactor: 3,
  migration: 4,
};

export interface ClassifySignals {
  /** Number of files changed in the diff. */
  readonly filesChanged: number;
  /** Number of lines added + removed in the diff. */
  readonly linesChanged: number;
  /** Whether the diff includes dependency files (package.json, etc.). */
  readonly touchesDependencies: boolean;
  /** Whether the diff includes migration scripts / codemods. */
  readonly touchesMigrationScripts: boolean;
  /** Whether the diff is mostly renames / formatting / comment changes. */
  readonly isPureRefactor: boolean;
  /** Keywords found in the change description or commit message. */
  readonly keywords: readonly string[];
}

/** The gate set that runs for a given task level (L1b). */
export interface TaskLevelGateSet {
  readonly level: TaskLevel;
  /** Human-readable description. */
  readonly description: string;
  /** Which slice-check stages run at this level. */
  readonly stages: readonly string[];
  /** Whether PRD is required at this level. */
  readonly requiresPrd: boolean;
  /** Whether a tech-doc is required at this level. */
  readonly requiresTechDoc: boolean;
  /** Whether a code review is required at this level. */
  readonly requiresCodeReview: boolean;
  /** Whether a security review is required at this level. */
  readonly requiresSecurityReview: boolean;
  /** Whether a perf baseline is required at this level. */
  readonly requiresPerfBaseline: boolean;
  /** Whether the slice must transition through QA handoff. */
  readonly requiresQaHandoff: boolean;
  /** Whether the user must explicitly confirm destructive paths. */
  readonly requiresDestructiveConfirmation: boolean;
}

export const TASK_LEVEL_GATE_SETS: Readonly<Record<TaskLevel, TaskLevelGateSet>> = {
  typo: {
    level: 'typo',
    description: 'Single-line fix: typo, comment, formatting. No new logic.',
    stages: ['typecheck', 'lint'],
    requiresPrd: false,
    requiresTechDoc: false,
    requiresCodeReview: false,
    requiresSecurityReview: false,
    requiresPerfBaseline: false,
    requiresQaHandoff: false,
    requiresDestructiveConfirmation: false,
  },
  bug: {
    level: 'bug',
    description: 'Bug fix: existing behavior wrong, patched in 1-3 files.',
    stages: ['typecheck', 'unit-tests', 'lint'],
    requiresPrd: false,
    requiresTechDoc: false,
    requiresCodeReview: true,
    requiresSecurityReview: false,
    requiresPerfBaseline: false,
    requiresQaHandoff: false,
    requiresDestructiveConfirmation: false,
  },
  feature: {
    level: 'feature',
    description: 'New feature: new behavior, new files, new tests.',
    stages: ['typecheck', 'unit-tests', 'lint', 'review-fanout', 'gate-verify-pipeline'],
    requiresPrd: true,
    requiresTechDoc: true,
    requiresCodeReview: true,
    requiresSecurityReview: true,
    requiresPerfBaseline: true,
    requiresQaHandoff: true,
    requiresDestructiveConfirmation: true,
  },
  refactor: {
    level: 'refactor',
    description: 'Refactor: behavior-preserving structural change.',
    stages: ['typecheck', 'unit-tests', 'lint', 'review-fanout'],
    requiresPrd: false,
    requiresTechDoc: true,
    requiresCodeReview: true,
    requiresSecurityReview: true,
    requiresPerfBaseline: false,
    requiresQaHandoff: true,
    requiresDestructiveConfirmation: false,
  },
  migration: {
    level: 'migration',
    description: 'Migration: codemod, schema change, data backfill, dependency upgrade.',
    stages: ['typecheck', 'unit-tests', 'lint', 'review-fanout', 'gate-verify-pipeline', 'backward-compat'],
    requiresPrd: true,
    requiresTechDoc: true,
    requiresCodeReview: true,
    requiresSecurityReview: true,
    requiresPerfBaseline: true,
    requiresQaHandoff: true,
    requiresDestructiveConfirmation: true,
  },
};

/** Result of a classification (deterministic given signals + conservatism). */
export interface ClassifyResult {
  readonly level: TaskLevel;
  readonly signals: ClassifySignals;
  /** Why this level was chosen (1-2 sentence explanation). */
  readonly rationale: string;
  /** The gate set that will run for this level. */
  readonly gateSet: TaskLevelGateSet;
  /** The audit log entry (every classification is logged). */
  readonly audit: ClassifyAuditEntry;
}

export interface ClassifyAuditEntry {
  readonly timestamp: string;
  readonly inputs: ClassifySignals;
  readonly output: TaskLevel;
  readonly conservatism: 'default' | 'strict' | 'lax';
  readonly overrideApplied: boolean;
  readonly reason: string;
}
