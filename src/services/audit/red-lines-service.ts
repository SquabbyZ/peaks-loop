/**
 * red-lines-service — main entry. Orchestrates the three tree scanners,
 * the classifier, and the backing detector, then assembles the final
 * RedLineAudit envelope.
 *
 * Pipeline (per openspec/changes/2026-06-11-l2-1-redlines-audit/design.md):
 *   1. Run all 3 scanners in parallel (skills, rules, openspec)
 *   2. Classifier turns MarkdownLine[] into RedLineEntry[]
 *   3. Backing detector re-classifies each entry (cli-backed vs partial vs prose-only)
 *   4. Tally + return RedLineAudit
 *
 * Sub-agent-sid enforcer (Task 2) is also invoked here: it dogfoods Slice 0.5
 * sid-naming-guard and adds any invalid sids as warnings.
 */

import { classifyFiles } from './classifier.js';
import { classifyBackingBatch } from './backing-detector.js';
import { scanSkillsTree } from './scanners/skills-tree-scanner.js';
import { scanRulesTree } from './scanners/rules-tree-scanner.js';
import { scanOpenSpecTree } from './scanners/openspec-scanner.js';
import { findInvalidSubAgentSids, findInvalidRuntimeSids } from './enforcers/sub-agent-sid.js';
import type { ClassifyFileInput } from './classifier.js';
import type { RedLineAudit, RedLineEntry, ScanWarning } from './types.js';

export interface RedLinesServiceInput {
  readonly projectRoot: string;
}

export interface RedLinesServiceResult {
  readonly audit: RedLineAudit;
  readonly warnings: readonly ScanWarning[];
}

function buildFileInputs(
  skills: { lines: readonly { file: string; line: number; text: string }[] },
  rules: { lines: readonly { file: string; line: number; text: string }[] },
  openspec: { lines: readonly { file: string; line: number; text: string }[] },
): readonly ClassifyFileInput[] {
  const grouped = new Map<string, string[]>();
  for (const line of [...skills.lines, ...rules.lines, ...openspec.lines]) {
    const existing = grouped.get(line.file);
    if (existing) {
      // line numbers are 1-based; pad to ensure the right slot
      while (existing.length < line.line) existing.push('');
      existing[line.line - 1] = line.text;
    } else {
      const arr: string[] = [];
      while (arr.length < line.line - 1) arr.push('');
      arr.push(line.text);
      grouped.set(line.file, arr);
    }
  }
  return Array.from(grouped.entries()).map(([file, lines]) => ({ file, lines }));
}

function tally(entries: readonly RedLineEntry[]): {
  totalRedLines: number;
  cliBacked: number;
  partial: number;
  proseOnly: number;
} {
  let cliBacked = 0;
  let partial = 0;
  let proseOnly = 0;
  for (const entry of entries) {
    if (entry.backing === 'cli-backed') cliBacked++;
    else if (entry.backing === 'partial') partial++;
    else proseOnly++;
  }
  return {
    totalRedLines: entries.length,
    cliBacked,
    partial,
    proseOnly,
  };
}

export function runRedLinesAudit(input: RedLinesServiceInput): RedLinesServiceResult {
  const skills = scanSkillsTree({ projectRoot: input.projectRoot });
  const rules = scanRulesTree({ projectRoot: input.projectRoot });
  const openspec = scanOpenSpecTree({ projectRoot: input.projectRoot });

  const fileInputs = buildFileInputs(skills, rules, openspec);
  const classified = classifyFiles(fileInputs);

  const backed = classifyBackingBatch(classified.entries, input.projectRoot);

  // Sub-agent-sid enforcer (Task 2): dogfoods Slice 0.5 sid-naming-guard.
  const subAgentSids = findInvalidSubAgentSids(input.projectRoot);
  const runtimeSids = findInvalidRuntimeSids(input.projectRoot);

  const warnings: ScanWarning[] = [
    ...skills.warnings,
    ...rules.warnings,
    ...openspec.warnings,
    ...classified.warnings.map((message) => ({ file: '(classifier)', message })),
    ...backed.warnings.map((message) => ({ file: '(backing-detector)', message })),
  ];

  if (subAgentSids.scanned && subAgentSids.invalid.length > 0) {
    for (const sid of subAgentSids.invalid) {
      warnings.push({
        file: '.peaks/_sub_agents/' + sid,
        message: `invalid sub-agent sid: "${sid}" (does not match isValidSessionId)`,
      });
    }
  }
  if (runtimeSids.scanned && runtimeSids.invalid.length > 0) {
    for (const sid of runtimeSids.invalid) {
      warnings.push({
        file: '.peaks/_runtime/' + sid,
        message: `invalid runtime sid: "${sid}" (does not match isValidSessionId)`,
      });
    }
  }

  const counts = tally(backed.entries);
  const audit: RedLineAudit = {
    totalRedLines: counts.totalRedLines,
    cliBacked: counts.cliBacked,
    partial: counts.partial,
    proseOnly: counts.proseOnly,
    audit: backed.entries,
  };

  return { audit, warnings };
}
