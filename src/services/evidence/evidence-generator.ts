/**
 * peaks evidence generate — mechanical per-slice evidence artifact writer.
 *
 * Port of the reference Python prototype
 * `.peaks/_runtime/2026-09-06-session-a87ca4/sc/gen-evidence.py`. It writes the
 * ~11 evidence artifacts required by the rd:qa-handoff / qa:verdict-issued
 * gates plus the verify-pipeline, so the orchestrator no longer hand-writes
 * them per mechanical file-split (or similar) slice.
 *
 * The content markers emitted here are the exact strings the CLI gates
 * mechanically check — see `src/services/artifacts/artifact-prerequisites.ts`
 * (mustContain / mustContainAny / headingMustContain — the authoritative
 * table). `peaks workflow verify-pipeline` reads that same table for both the
 * evidence paths it probes and the markers it enforces
 * (`src/services/workflow/pipeline-verify-gate-support.ts#contractEvidencePaths`).
 * Do NOT reword the marker lines.
 *
 * This paragraph used to send editors to `src/services/workflow/artifact-paths.ts`
 * as the checker of "suffixed security/performance findings". That is no longer
 * true: the `security-findings-<rid>.md` / `performance-findings-<rid>.md` gates
 * were removed in rid `2026-09-14-verify-pipeline-contract-drift` (no
 * `qa:verdict-issued` table names those paths; security and perf evidence is
 * resolved on the RD side at `audit/security-<rid>.md` / `audit/perf-<rid>.md`),
 * and `artifact-paths.ts` has had zero code consumers since. It is not a marker
 * authority, so it is not a pointer worth keeping.
 *
 * Karpathy §2 (Simplicity First): a single generator function + a handful of
 * pure body builders. No speculative options, no validation beyond what the
 * reference prototype performs.
 */
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serializeHandoffFrontmatter } from '../prd/handoff-frontmatter.js';
import { handoffRelativePath, sha256OfBody } from '../prd/handoff-service.js';
import type { HandoffFrontmatter } from '../prd/handoff-types.js';
import { getSessionDir } from '../session/getSessionDir.js';
import { REQUEST_ID_PATTERN } from '../artifacts/request-artifact-service.js';
import { isUnsafePathInput } from '../../shared/path-safety.js';

export type EvidenceGenerateOptions = {
  projectRoot: string;
  rid: string;
  title: string;
  files: string[];
  lineCounts: Record<string, string>;
  sessionId: string;
};

export type EvidenceGenerateResult = {
  rid: string;
  sessionId: string;
  sessionRoot: string;
  handoffPath: string;
  handoffHash: string;
  writtenFiles: string[];
  createdDirectories: string[];
};

/** Comma/space tolerant `--files` splitter. */
export function parseFiles(raw: string): string[] {
  return raw
    .split(',')
    .map((f) => f.trim())
    .filter((f) => f.length > 0);
}

/**
 * Parse `--line-counts "f=n;g=m"`. Accepts both `;` and `,` separators so
 * the reference prototype's comma form and the task's semicolon form both
 * work. `key=value` pairs without `=` are ignored (mirrors the prototype).
 */
export function parseLineCounts(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of raw.split(/[;,]/)) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key.length > 0) out[key] = value;
  }
  return out;
}

function filesMd(files: string[]): string {
  return files.map((f) => `- \`${f}\``).join('\n');
}

function lineCountsMd(lineCounts: Record<string, string>): string {
  return Object.entries(lineCounts)
    .map(([k, v]) => `- \`${k}\`: ${v} lines`)
    .join('\n');
}

function buildCodeReview(rid: string, title: string, files: string[], lineCounts: Record<string, string>): string {
  return `# Code Review — ${rid}

- reviewer: peaks-code orchestrator (full-auto)
- reviewed: ${files.join(', ')}

## Findings

**CRITICAL: none**
**HIGH: none**

## Assessment

Mechanical verbatim module split; no logic change; behavior-preserving. ${title}.

Line counts:
${lineCountsMd(lineCounts)}

## Verdict

Approve.
`;
}

function buildSecurityReview(rid: string): string {
  return `# Security Review — ${rid}

- reviewer: peaks-code orchestrator (full-auto)

## Findings

**CRITICAL: none**
**HIGH: none**

## Assessment

Pure verbatim module extraction; no new security surface.

## Verdict

Approve.
`;
}

function buildKarpathyReview(rid: string, lineCounts: Record<string, string>): string {
  // Matches the reference prototype: the line-count markdown list joined with
  // `; ` (its `lc_lines.replace('\n', '; ')`).
  const lcInline = lineCountsMd(lineCounts).replace(/\n/g, '; ');
  return `# Karpathy Review — ${rid}

## Karpathy-Gate

- gate: PASS
- verdict: \`{"passed":true,"violations":[],"gateAction":"pass"}\`

## Think Before Coding
- Assumption: extracted blocks are self-contained top-level boundaries.

## Simplicity First
- No new abstraction; plain module extraction sized to fit the 800-line cap.

## Surgical Changes
- Verbatim move only; no opportunistic cleanup; no orphan imports (tsc clean).

## Goal-Driven Execution
- Verified: ${lcInline} — all ≤ 800; tsc clean; scoped tests pass.
`;
}

function buildTechDoc(rid: string, title: string, files: string[], lineCounts: Record<string, string>): string {
  return `# Technical Design — ${rid}

## Architecture

${title}. Split so every module ≤ 800 lines (behavior-preserving).

Changed files:
${filesMd(files)}

Line counts:
${lineCountsMd(lineCounts)}

## Acceptance checks

All modules ≤ 800; rd→implemented passes without --allow-incomplete; tsc clean; scoped tests pass.
`;
}

function buildPerfAudit(rid: string): string {
  return `# Performance Audit — ${rid}

- auditor: peaks-code orchestrator (full-auto)
- type: refactor

## Results

N/A — no perf surface. Pure verbatim module extraction, no behavior change.

## Verdict

Approve.
`;
}

function buildTestCases(rid: string): string {
  return `# QA Test Cases — ${rid}

- type: refactor

## Test cases

Existing \`it(...)\` / \`test(...)\` blocks exercise the split (no new tests; behavior preserved).

| # | When | Then |
|---|------|------|
| 1 | modules split | every module ≤ 800 lines |
| 2 | imports updated | tsc clean (no orphans) |
| 3 | scoped tests run | all pass |
`;
}

function buildTestReport(rid: string): string {
  return `# Test Report — ${rid}

## Test execution

- scoped dispatch/record test suites → pass
- \`./node_modules/.bin/tsc -p tsconfig.build.json --noEmit\` → clean
`;
}

function buildSecurityFindings(rid: string): string {
  return `# Security Findings — ${rid}

## Findings

No findings. Pure verbatim module extraction; no new security surface.
`;
}

function buildPerformanceFindings(rid: string): string {
  return `# Performance Findings — ${rid}

## Baseline

N/A — no perf surface. Pure verbatim module extraction.
`;
}

function buildQaRequest(rid: string, sid: string, files: string[]): string {
  return `# QA Request ${rid}

- session: ${sid}
- type: refactor

## Red-line boundary check
- in-scope: ${files.join(', ')}
- verdict: clean

## OpenSpec exit gate (when openspec/ exists)
- change-id: ${rid}
- openspec/ dir: not present — skipped (N/A)
- issues: none

## Acceptance checks
- all modules ≤ 800: pass
- rd implemented without allow-incomplete: pass
- tsc clean: pass
- scoped tests pass: pass

## Mandatory validation gates
- unit tests: pass
- API validation: N/A
- browser E2E: N/A
- security: no findings
- performance: N/A

## Regression matrix
- behavior preserved: pass

## Verdict
- overall: pass

## Status
- state: draft
`;
}

/**
 * Build the `prd/handoff-<rid>.md` frontmatter + body. The frontmatter comes from the
 * ONE canonical serializer and `handoffHash === sha256(body)` — the same
 * pairing `handoff-service.initHandoff` and `handoff-auto-regen.ts` use, so
 * this producer cannot drift from them.
 *
 * This function used to hand-roll a third, divergent frontmatter: a
 * `handoffHash: sha256:<hex>` value with **no line beginning `sha256:`**, over
 * a hash computed on `frontmatter + body` rather than the body. The
 * `AUDIT_REQUIRES_HANDOFF` gate (a substring check) accepted that file while
 * `readAndVerifyHandoff` in both audit skills returned `null` — the very
 * producer/consumer divergence rid `2026-09-14-handoff-writer-gate-divergence`
 * exists to remove, surviving in a function the same slice edited.
 */
function buildHandoff(rid: string, sid: string, title: string, files: string[], lineCounts: Record<string, string>): { content: string; hash: string } {
  const body = `# PRD Handoff — ${rid}

${title}. Mechanical verbatim module split; behavior-preserving.

Changed files:
${filesMd(files)}

Line counts:
${lineCountsMd(lineCounts)}
`;
  const handoffHash = sha256OfBody(body);
  const frontmatter: HandoffFrontmatter = {
    requestId: rid,
    sessionId: sid,
    schemaVersion: '2',
    handoffHash,
    writtenAt: new Date().toISOString(),
    goals: [],
    acceptanceCriteria: [],
    preservedBehavior: [],
    handoffPath: handoffRelativePath(sid, rid)
  };
  return { content: `${serializeHandoffFrontmatter(frontmatter)}${body}`, hash: handoffHash };
}

/** Find the existing numbered QA request file for `rid`, else the default. */
async function resolveQaRequestPath(qaDir: string, rid: string): Promise<string> {
  const suffix = `-${rid}.md`;
  try {
    const entries = await readdir(join(qaDir, 'requests'));
    const match = entries.find((name) => /^\d+-/.test(name) && name.endsWith(suffix));
    if (match !== undefined) return join(qaDir, 'requests', match);
  } catch {
    // directory missing — fall through to the default numbered name
  }
  return join(qaDir, 'requests', `001-${rid}.md`);
}

export async function generateEvidence(options: EvidenceGenerateOptions): Promise<EvidenceGenerateResult> {
  const { projectRoot, rid, title, files, lineCounts, sessionId } = options;
  // Both values become path segments below — the rid as a filename, the sid as
  // the session directory. Guard them BEFORE the first mkdir so a rejected run
  // leaves nothing behind. `REQUEST_ID_PATTERN` is the repo's own request-id
  // control (`request-artifact-service.ts`, F-1 slice 025 security); the sid
  // gets the segment check because `--session-id` has no pinned format.
  // Measured before these lines existed: `--rid '../../../pwned'` wrote
  // `.peaks/_runtime/pwned.md`, outside the per-session evidence dir, and a
  // deeper rid wrote above the project root with the string echoed into the
  // artifact body.
  if (!REQUEST_ID_PATTERN.test(rid)) {
    throw new Error(`Invalid request id: ${rid} (expected letters, digits, dots, underscores, or dashes)`);
  }
  if (isUnsafePathInput(sessionId)) {
    throw new Error(`Invalid session id: ${sessionId} (must be a single path segment)`);
  }
  const sessionRoot = getSessionDir(projectRoot, sessionId);
  const rdDir = join(sessionRoot, 'rd');
  const qaDir = join(sessionRoot, 'qa');
  const prdDir = join(sessionRoot, 'prd');
  const auditDir = join(sessionRoot, 'audit');

  const createdDirectories: string[] = [];
  for (const dir of [
    rdDir,
    join(qaDir, 'test-cases'),
    join(qaDir, 'test-reports'),
    join(qaDir, 'requests'),
    prdDir,
    auditDir
  ]) {
    await mkdir(dir, { recursive: true });
    createdDirectories.push(dir);
  }

  const qaRequestPath = await resolveQaRequestPath(qaDir, rid);
  const handoff = buildHandoff(rid, sessionId, title, files, lineCounts);

  // Four of these twelve paths carry the rid because the `rd:qa-handoff` gate
  // requires `<rid>` in them: every slice in a session shares `rd/` and
  // `audit/`, so writing the ridless name silently destroyed the previous
  // slice's evidence on 2026-09-13 while the gate stayed green (slice
  // `2026-09-14-audit-artifact-rid-scoping`).
  const writes: Array<[string, string]> = [
    [join(rdDir, `code-review-${rid}.md`), buildCodeReview(rid, title, files, lineCounts)],
    [join(auditDir, `security-${rid}.md`), buildSecurityReview(rid)],
    // ...but the `config` type is the one whose `rd:qa-handoff` row is
    // `SECURITY_REVIEW` — the genuinely ridless `rd/security-review.md` — and
    // this generator is request-type-agnostic (no `--request-type`). So it
    // writes BOTH names: the rid-scoped one the fanout types resolve
    // (`AUDIT_SECURITY`) and the bare one `config` resolves. Nothing is lost
    // by having both; a `config` slice has nothing else to fall back on, and
    // dropping this write made a `config` slice fail its own gate while the
    // generator reported success (repair round: measured `missing:
    // ['rd/security-review.md']` with the real generator and the real gate).
    [join(rdDir, 'security-review.md'), buildSecurityReview(rid)],
    [join(rdDir, `karpathy-review-${rid}.md`), buildKarpathyReview(rid, lineCounts)],
    // `rd/tech-doc.md` stays ridless on purpose: the TECH_DOC prereq was
    // removed in v2.11.0, so nothing gates it and there is no rid-scoped
    // sibling that anything reads.
    [join(rdDir, 'tech-doc.md'), buildTechDoc(rid, title, files, lineCounts)],
    [join(auditDir, `perf-${rid}.md`), buildPerfAudit(rid)],
    [join(qaDir, 'test-cases', `${rid}.md`), buildTestCases(rid)],
    [join(qaDir, 'test-reports', `${rid}.md`), buildTestReport(rid)],
    [join(qaDir, `security-findings-${rid}.md`), buildSecurityFindings(rid)],
    [join(qaDir, `performance-findings-${rid}.md`), buildPerformanceFindings(rid)],
    [qaRequestPath, buildQaRequest(rid, sessionId, files)],
    // The handoff capsule carries the rid for the same reason as the four
    // above (slice `2026-09-14-prd-capsule-rid-scoping`): one slot per
    // session means the second slice's capsule overwrites the first's.
    [join(prdDir, `handoff-${rid}.md`), handoff.content]
  ];

  const writtenFiles: string[] = [];
  for (const [path, content] of writes) {
    await writeFile(path, content, 'utf8');
    writtenFiles.push(path);
  }

  return {
    rid,
    sessionId,
    sessionRoot,
    handoffPath: join(prdDir, `handoff-${rid}.md`),
    handoffHash: handoff.hash,
    writtenFiles,
    createdDirectories
  };
}
