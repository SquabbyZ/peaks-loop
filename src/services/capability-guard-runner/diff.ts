// src/services/capability-guard-runner/diff.ts
import type { GuardDiff } from './types.js';

export function formatHumanReadableDiff(diff: GuardDiff): string {
  return [
    `reason: ${diff.reason}`,
    `- ${diff.before}`,
    `+ ${diff.after}`
  ].join('\n');
}