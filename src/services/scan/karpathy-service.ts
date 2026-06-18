/**
 * Karpathy scan service (Slice 5/6 — karpathy-enforcement).
 *
 * Surface-level structural scan for the 4 Karpathy-guidelines
 * sections. Detects simple textual signals in `rd/karpathy-review.md`
 * (or a manually-supplied karpathy review blob) and reports
 * violation counts per guideline. This is a STRUCTURAL scanner, not
 * a semantic reviewer; the semantic review happens in the
 * `karpathy-reviewer` sub-agent (5-way fanout). Pattern follows
 * `orphan-service.ts` and `api-surface-service.ts`.
 *
 * karpathy §2: minimum code, no abstractions, no speculative
 * features.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type KarpathyViolationKind =
  | 'think-before-coding'
  | 'simplicity-first'
  | 'surgical-changes'
  | 'goal-driven-execution';

export type KarpathyScanOptions = {
  projectRoot: string;
  /** Limit walk to the supplied review file path (default: rd/karpathy-review.md). */
  reviewFile?: string;
  /** Scope: working-tree (default) | all. working-tree emits a warning if the file is missing. */
  scope?: 'working-tree' | 'all';
};

export type KarpathyViolation = {
  kind: KarpathyViolationKind;
  line: number;
  snippet: string;
  hint: string;
};

export type KarpathyScanReport = {
  projectRoot: string;
  reviewFile: string;
  scannedAt: string;
  present: boolean;
  counts: Record<KarpathyViolationKind, number>;
  totalViolations: number;
  violations: KarpathyViolation[];
  /** Section coverage: which of the 4 guidelines has its dedicated heading in the file. */
  sectionCoverage: Record<KarpathyViolationKind, boolean>;
  /** Gate action: pass when totalViolations === 0; warn when > 0; block when file missing under 'all' scope. */
  gateAction: 'pass' | 'warn' | 'block';
  warnings: string[];
};

/** 4 Karpathy-guidelines heading markers (case-insensitive, prefix-matched). */
const GUIDELINE_MARKERS: Record<KarpathyViolationKind, RegExp> = {
  'think-before-coding': /^#{1,3}\s*(?:§?\s*1\s*[-.)]?\s*)?think\s+before\s+coding/im,
  'simplicity-first': /^#{1,3}\s*(?:§?\s*2\s*[-.)]?\s*)?simplicity\s+first/im,
  'surgical-changes': /^#{1,3}\s*(?:§?\s*3\s*[-.)]?\s*)?surgical\s+changes/im,
  'goal-driven-execution': /^#{1,3}\s*(?:§?\s*4\s*[-.)]?\s*)?goal[-\s]*driven\s+execution/im
};

/** Violation hints keyed by guideline. */
const VIOLATION_HINTS: Record<KarpathyViolationKind, string> = {
  'think-before-coding': 'State assumptions explicitly. Surface tradeoffs. Do not hide confusion.',
  'simplicity-first': 'If 200 lines could be 50, rewrite. No features beyond what was asked.',
  'surgical-changes': 'Touch only what the user asked. Clean up only your own mess. Every changed line must trace to the request.',
  'goal-driven-execution': 'Define verifiable success criteria. For multi-step work, state plan + verify checkpoints.'
};

const DEFAULT_REVIEW_FILE = 'rd/karpathy-review.md';

export async function scanKarpathy(options: KarpathyScanOptions): Promise<KarpathyScanReport> {
  const reviewRel = options.reviewFile ?? DEFAULT_REVIEW_FILE;
  const abs = join(options.projectRoot, reviewRel);
  const scope = options.scope ?? 'working-tree';

  const violations: KarpathyViolation[] = [];
  const counts: Record<KarpathyViolationKind, number> = {
    'think-before-coding': 0,
    'simplicity-first': 0,
    'surgical-changes': 0,
    'goal-driven-execution': 0
  };
  const sectionCoverage: Record<KarpathyViolationKind, boolean> = {
    'think-before-coding': false,
    'simplicity-first': false,
    'surgical-changes': false,
    'goal-driven-execution': false
  };
  const warnings: string[] = [];

  let body: string;
  try {
    body = await readFile(abs, 'utf8');
  } catch {
    // Per karpathy §1, "surface assumptions" — when the review file is missing
    // we report the gap explicitly. Hard gate behaviour is determined by scope.
    if (scope === 'all') {
      return {
        projectRoot: options.projectRoot,
        reviewFile: reviewRel,
        scannedAt: new Date().toISOString(),
        present: false,
        counts,
        totalViolations: 0,
        violations,
        sectionCoverage,
        gateAction: 'block',
        warnings: [
          `Karpathy review file missing: ${reviewRel}`,
          'Per karpathy §1 Think Before Coding: state your assumptions. Without a review file, no 5-way fanout evidence is available.',
          'Per karpathy §3 Surgical Changes: touch only what the request requires. Create a minimal rd/karpathy-review.md stub before requesting qa-handoff.'
        ]
      };
    }
    return {
      projectRoot: options.projectRoot,
      reviewFile: reviewRel,
      scannedAt: new Date().toISOString(),
      present: false,
      counts,
      totalViolations: 0,
      violations,
      sectionCoverage,
      gateAction: 'warn',
      warnings: [
        `Karpathy review file missing: ${reviewRel} (scope=${scope}; not blocking).`,
        'Per karpathy §1 Think Before Coding: surface the missing file to the user.'
      ]
    };
  }

  // Section coverage: each of the 4 guidelines should have a heading.
  for (const kind of Object.keys(GUIDELINE_MARKERS) as KarpathyViolationKind[]) {
    sectionCoverage[kind] = GUIDELINE_MARKERS[kind].test(body);
    if (!sectionCoverage[kind]) {
      violations.push({
        kind,
        line: 1,
        snippet: '(missing section)',
        hint: `Add a heading that matches ${VIOLATION_HINTS[kind]}`
      });
      counts[kind] += 1;
    }
  }

  // Heuristic violation detection: any line that contains the
  // anti-pattern markers. Single pass over the file; O(n) total.
  const lines = body.split('\n');
  const ANTI_PATTERNS: Array<{ kind: KarpathyViolationKind; re: RegExp; hint: string }> = [
    {
      kind: 'surgical-changes',
      re: /\b(?:TODO|FIXME|XXX|HACK)\b/i,
      hint: 'Found an unresolved TODO/FIXME. Per karpathy §3, complete the work or remove the marker.'
    },
    {
      kind: 'simplicity-first',
      re: /\b(?:temporar(?:y|ily)|workaround|for now|just in case)\b/i,
      hint: 'Found speculative-flexibility language. Per karpathy §2, remove unless the request asked for it.'
    },
    {
      kind: 'goal-driven-execution',
      re: /\b(?:maybe|perhaps|probably|should be fine|we'll see)\b/i,
      hint: 'Weak success criteria. Per karpathy §4, replace with a verifiable check.'
    }
  ];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    for (const ap of ANTI_PATTERNS) {
      if (ap.re.test(line)) {
        violations.push({ kind: ap.kind, line: i + 1, snippet: line.trim().slice(0, 120), hint: ap.hint });
        counts[ap.kind] += 1;
      }
    }
  }

  if (violations.length === 0) {
    warnings.push('No anti-patterns detected. Karpathy-Gate passes.');
  }

  return {
    projectRoot: options.projectRoot,
    reviewFile: reviewRel,
    scannedAt: new Date().toISOString(),
    present: true,
    counts,
    totalViolations: violations.length,
    violations,
    sectionCoverage,
    gateAction: violations.length === 0 ? 'pass' : 'warn',
    warnings
  };
}

export function formatKarpathyMarkdown(report: KarpathyScanReport, opts: { title?: string } = {}): string {
  const title = opts.title ?? '## Karpathy inventory';
  const lines: string[] = [];
  lines.push(title);
  lines.push('');
  lines.push(`- **Project:** ${report.projectRoot}`);
  lines.push(`- **Review file:** ${report.reviewFile}`);
  lines.push(`- **Present:** ${report.present ? 'yes' : 'no'}`);
  lines.push(`- **Gate action:** ${report.gateAction}`);
  lines.push(`- **Scanned at:** ${report.scannedAt}`);
  lines.push('');

  lines.push('### Section coverage (4 guidelines)');
  lines.push('');
  for (const kind of Object.keys(report.sectionCoverage) as KarpathyViolationKind[]) {
    const present = report.sectionCoverage[kind];
    lines.push(`- **${kind}**: ${present ? 'present' : '**MISSING**'}`);
  }
  lines.push('');

  lines.push('### Violation counts (4 guidelines)');
  lines.push('');
  for (const kind of Object.keys(report.counts) as KarpathyViolationKind[]) {
    lines.push(`- **${kind}**: ${report.counts[kind]}`);
  }
  lines.push('');

  lines.push(`### Violations (total ${report.totalViolations})`);
  lines.push('');
  if (report.violations.length === 0) {
    lines.push('_No violations detected. karpathy-guidelines 4 段全部 pass._');
  } else {
    for (const v of report.violations) {
      lines.push(`- **L${v.line} [${v.kind}]**: ${v.snippet}`);
      lines.push(`  - _hint:_ ${v.hint}`);
    }
  }
  lines.push('');

  if (report.warnings.length > 0) {
    lines.push('### Warnings');
    lines.push('');
    for (const w of report.warnings) {
      lines.push(`- ${w}`);
    }
    lines.push('');
  }

  lines.push('### Karpathy-Gate');
  lines.push('');
  lines.push('Per `andrej-karpathy-skills:karpathy-guidelines` §1 Think Before Coding / §3 Surgical Changes, the hard Karpathy-Gate requires `rd/karpathy-review.md` to be present with all 4 guideline sections before `peaks request transition --state qa-handoff`.');
  return lines.join('\n');
}
