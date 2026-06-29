/**
 * v2.15.0 follow-up — G3: prd 4 必填块 checker.
 *
 * Validates that a PRD artifact body contains the 4 mandatory sections
 * required by the 12 Gaps positioning memory:
 *
 *   1. 业务场景(目标用户 / 业务流程 / 性能 / 现有系统 / 业务禁区)
 *   2. 边界 case 清单
 *   3. UI 装配意图(页面模式 / 关键交互 / 信息密度)
 *   4. 上游基线(仅 fork 场景必填)
 *
 * Returns a structured report; the CLI surfaces it as a lint
 * complement to `peaks request lint` (which checks placeholders).
 * `peaks prd check-blocks` ensures the design quality is locked at
 * the prd stage (the principle: 质量杠杆前置到 prd).
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface PrdBlockFinding {
  /** Block identifier (1-4). */
  readonly block: 1 | 2 | 3 | 4;
  /** Block name (Chinese). */
  readonly name: string;
  /** Whether the block is required (block 4 only required for fork projects). */
  readonly required: boolean;
  /** Whether the block was found in the document. */
  readonly present: boolean;
  /** The content under the heading, or null when not found. */
  readonly content: string | null;
  /** Issues detected (empty array when the block is OK). */
  readonly issues: readonly string[];
}

export interface PrdBlocksReport {
  /** Project root. */
  readonly projectRoot: string;
  /** Path to the artifact. */
  readonly artifactPath: string;
  /** Whether this is a fork project (controls block 4 required flag). */
  readonly isFork: boolean;
  /** Findings for each of the 4 blocks. */
  readonly findings: readonly PrdBlockFinding[];
  /** Overall pass/fail: all required blocks present + no issues. */
  readonly ok: boolean;
}

const BLOCK_HEADINGS: readonly { block: 1 | 2 | 3 | 4; name: string; pattern: RegExp; requiredByDefault: boolean }[] = [
  { block: 1, name: '业务场景', pattern: /^#{1,4}\s*(?:\d+\.\s*)?业务场景[^\n]*$/m, requiredByDefault: true },
  { block: 2, name: '边界 case', pattern: /^#{1,4}\s*(?:\d+\.\s*)?边界\s*case[^\n]*$/mi, requiredByDefault: true },
  { block: 3, name: 'UI 装配意图', pattern: /^#{1,4}\s*(?:\d+\.\s*)?UI\s*装配[^\n]*$/mi, requiredByDefault: true },
  { block: 4, name: '上游基线', pattern: /^#{1,4}\s*(?:\d+\.\s*)?上游基线[^\n]*$/m, requiredByDefault: false }
];

const MIN_CONTENT_LENGTH = 50;

export function findPrdArtifact(projectRoot: string, requestId: string): string | null {
  // Look under .peaks/_runtime/<session>/prd/requests/<rid>.md
  // Use the first hit (the most common layout is single-session).
  const candidates = [
    join(projectRoot, '.peaks', '_runtime', 'prd', 'requests', `${requestId}.md`),
    join(projectRoot, '.peaks', '_runtime', 'change', requestId, 'prd', 'requests', `${requestId}.md`)
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // Fall back to a glob-like search through .peaks/_runtime/*/prd/requests/.
  const runtimeRoot = join(projectRoot, '.peaks', '_runtime');
  if (!existsSync(runtimeRoot)) return null;
  for (const sessionOrChange of readdirSync(runtimeRoot)) {
    for (const sub of ['prd/requests', 'change']) {
      const dir = join(runtimeRoot, sessionOrChange, sub, requestId);
      if (existsSync(dir) && statSync(dir).isFile()) return dir;
    }
  }
  return null;
}

export function readPrdArtifact(artifactPath: string): string {
  return readFileSync(artifactPath, 'utf8');
}

/**
 * Detect whether the project is a fork by looking for `.peaks/fork-state.json`
 * (the G11 CLI's state file) or `.peaks/release-state.json` history entries
 * that reference an upstream. Lightweight heuristic.
 */
export function detectForkProject(projectRoot: string): boolean {
  const forkStatePath = resolve(projectRoot, '.peaks/fork-state.json');
  if (existsSync(forkStatePath)) return true;
  // Future: also check the upcoming `peaks fork status` baseline.
  return false;
}

export function checkPrdBlocks(projectRoot: string, requestId: string): PrdBlocksReport {
  const artifactPath = findPrdArtifact(projectRoot, requestId);
  if (artifactPath === null) {
    return {
      projectRoot,
      artifactPath: '(not found)',
      isFork: false,
      findings: BLOCK_HEADINGS.map((h) => ({
        block: h.block,
        name: h.name,
        required: h.requiredByDefault,
        present: false,
        content: null,
        issues: h.requiredByDefault
          ? ['PRD artifact not found — write the prd body first.']
          : []
      })),
      ok: false
    };
  }
  const body = readPrdArtifact(artifactPath);
  const isFork = detectForkProject(projectRoot);
  const findings: PrdBlockFinding[] = BLOCK_HEADINGS.map((h) => {
    const required = h.requiredByDefault || (h.block === 4 && isFork);
    const match = body.match(h.pattern);
    if (match === null) {
      return {
        block: h.block,
        name: h.name,
        required,
        present: false,
        content: null,
        issues: required
          ? [`Missing required block: ${h.name}. Add a heading like "## ${h.name}" with at least ${MIN_CONTENT_LENGTH} chars of content.`]
          : []
      };
    }
    // Extract content: from the matched heading to the next same-or-higher-level heading.
    const headingStart = match.index ?? 0;
    const headingLineEnd = body.indexOf('\n', headingStart);
    const start = headingLineEnd === -1 ? body.length : headingLineEnd + 1;
    const headingLevel = (match[0]?.match(/^#+/) ?? [''])[0]?.length ?? 2;
    const restBody = body.slice(start);
    const nextHeading = new RegExp(`^#{1,${headingLevel}}\\s+`, 'm').exec(restBody);
    const end = nextHeading ? nextHeading.index : restBody.length;
    const content = restBody.slice(0, end).trim();
    const issues: string[] = [];
    if (content.length < MIN_CONTENT_LENGTH) {
      issues.push(`Block "${h.name}" is too short (${content.length} chars; minimum ${MIN_CONTENT_LENGTH}). Add more concrete details.`);
    }
    // Block 1: must include 业务禁区 (no-go areas) — anti-pattern guard.
    if (h.block === 1 && !/业务禁区|non-goal|non goal|不\s*做\s*什么/i.test(content)) {
      issues.push('Block "业务场景" missing "业务禁区" sub-section (the 12 Gaps positioning memory requires this).');
    }
    return {
      block: h.block,
      name: h.name,
      required,
      present: true,
      content,
      issues
    };
  });
  const ok = findings.every((f) => f.issues.length === 0);
  return { projectRoot, artifactPath, isFork, findings, ok };
}
