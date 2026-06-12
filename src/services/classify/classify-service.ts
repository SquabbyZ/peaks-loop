/**
 * L1a task classification service.
 *
 * Spec: docs/superpowers/specs/2026-06-11-peaks-cli-l1-l2-l3-redesign.md §4
 *
 * Hybrid mechanism: signal-based heuristic + user override + audit log.
 *
 * Signal rules (per the spec, conservative defaults):
 *   - filesChanged >= feature_threshold_files OR linesChanged >= feature_threshold_lines
 *     AND touchesDependencies → 'migration'
 *   - touchesMigrationScripts → 'migration'
 *   - isPureRefactor AND linesChanged > 50 → 'refactor'
 *   - filesChanged >= feature_threshold_files OR linesChanged >= feature_threshold_lines
 *     → 'feature'
 *   - keywords contains 'fix' / 'bug' / 'broken' → 'bug'
 *   - filesChanged <= 3 AND linesChanged <= 5 → 'typo'
 *   - default → 'bug' (mid-low)
 *
 * Conservatism:
 *   - 'strict' promotes the result by one level
 *   - 'lax' demotes the result by one level
 *   - 'default' leaves it as-is
 *
 * Override (the user can force a level):
 *   - `peaks classify override --level <level> --reason "<text>"` writes
 *     to the audit log; cannot be downgraded (per spec: downgrade
 *     is always refused)
 */

import {
  TASK_LEVELS,
  TASK_LEVEL_GATE_SETS,
  TASK_LEVEL_ORDER,
  type ClassifyAuditEntry,
  type ClassifyResult,
  type ClassifySignals,
  type TaskLevel,
} from './classify-types.js';
import type { ClassifyConservatism } from '../preferences/preferences-types.js';

export interface ClassifyInput {
  readonly signals: ClassifySignals;
  readonly conservatism: ClassifyConservatism;
  /** When set, force the level (bypasses the heuristic). */
  readonly override?: { level: TaskLevel; reason: string };
  /** Optional clock for testability. */
  readonly clock?: () => string;
}

const FEATURE_KEYWORDS = ['fix', 'bug', 'broken', 'crash', 'regression'] as const;
const MIGRATION_KEYWORDS = ['migrate', 'migration', 'codemod', 'backfill', 'schema', 'bump'] as const;
const REFACTOR_KEYWORDS = ['refactor', 'rename', 'extract', 'inline', 'cleanup'] as const;

function detectLevel(signals: ClassifySignals, featureThresholdFiles: number, featureThresholdLines: number): TaskLevel {
  // 1. Migration takes priority.
  if (signals.touchesMigrationScripts) return 'migration';
  const lower = signals.keywords.map((k) => k.toLowerCase());
  if (signals.touchesDependencies && lower.some((k) => MIGRATION_KEYWORDS.includes(k as typeof MIGRATION_KEYWORDS[number]))) {
    return 'migration';
  }
  if (signals.touchesDependencies) return 'migration';
  if (signals.touchesDependencies === false && signals.isPureRefactor && signals.linesChanged > 50) {
    return 'refactor';
  }
  if (lower.some((k) => REFACTOR_KEYWORDS.includes(k as typeof REFACTOR_KEYWORDS[number])) && signals.isPureRefactor) {
    return 'refactor';
  }
  // 2. Feature threshold.
  if (signals.filesChanged >= featureThresholdFiles || signals.linesChanged >= featureThresholdLines) {
    return 'feature';
  }
  // 3. Bug-fix keywords.
  if (lower.some((k) => FEATURE_KEYWORDS.includes(k as typeof FEATURE_KEYWORDS[number]))) {
    return 'bug';
  }
  // 4. Small diff: typo.
  if (signals.filesChanged <= 3 && signals.linesChanged <= 5) {
    return 'typo';
  }
  // 5. Default: bug (mid-low).
  return 'bug';
}

function applyConservatism(level: TaskLevel, conservatism: ClassifyConservatism): TaskLevel {
  if (conservatism === 'default') return level;
  const order = TASK_LEVEL_ORDER[level];
  const index = TASK_LEVELS.indexOf(level);
  if (conservatism === 'strict') {
    const next = Math.min(index + 1, TASK_LEVELS.length - 1);
    return TASK_LEVELS[next] ?? level;
  }
  // 'lax'
  const prev = Math.max(index - 1, 0);
  return TASK_LEVELS[prev] ?? level;
}

function buildRationale(signals: ClassifySignals, level: TaskLevel, overrideApplied: boolean): string {
  if (overrideApplied) return `level forced via override`;
  const parts: string[] = [];
  parts.push(`${signals.filesChanged} file(s), ${signals.linesChanged} line(s)`);
  if (signals.touchesMigrationScripts) parts.push('touches migration scripts');
  if (signals.touchesDependencies) parts.push('touches dependencies');
  if (signals.isPureRefactor) parts.push('pure refactor (no behavior change)');
  if (signals.keywords.length > 0) parts.push(`keywords: ${signals.keywords.join(', ')}`);
  parts.push(`→ ${level}`);
  return parts.join('; ');
}

export function classifyTask(input: ClassifyInput, featureThresholdFiles = 10, featureThresholdLines = 100): ClassifyResult {
  const heuristicLevel = detectLevel(input.signals, featureThresholdFiles, featureThresholdLines);

  let finalLevel: TaskLevel;
  let overrideApplied = false;
  if (input.override !== undefined) {
    finalLevel = input.override.level;
    overrideApplied = true;
  } else {
    finalLevel = applyConservatism(heuristicLevel, input.conservatism);
  }

  const gateSet = TASK_LEVEL_GATE_SETS[finalLevel];
  const rationale = buildRationale(input.signals, finalLevel, overrideApplied);
  const timestamp = (input.clock ?? (() => new Date().toISOString()))();

  const audit: ClassifyAuditEntry = {
    timestamp,
    inputs: input.signals,
    output: finalLevel,
    conservatism: input.conservatism,
    overrideApplied,
    reason: input.override?.reason ?? rationale,
  };

  return {
    level: finalLevel,
    signals: input.signals,
    rationale,
    gateSet,
    audit,
  };
}
