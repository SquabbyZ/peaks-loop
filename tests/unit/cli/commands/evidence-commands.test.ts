// tests/unit/cli/commands/evidence-commands.test.ts
//
// Unit test for `peaks evidence generate`. Exercises the full Commander
// wiring on a tmp workspace (no real .peaks/** state) and asserts each of
// the 11 evidence artifacts exists with the exact markers the CLI gates +
// verify-pipeline mechanically check (see
// src/services/artifacts/artifact-prerequisites.ts + the rd-evidence-cmd
// slice spec). Mirrors the marker checks one-for-one.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { withTmpWorkspacePerTest, type TmpWorkspace } from '../../_setup/tmp-workspace.js';
import { makeCapturedIo } from '../../_setup/io.js';
import { registerEvidenceCommands } from '~/src/cli/commands/evidence-commands';

const getWs = withTmpWorkspacePerTest('peaks-evidence-');

const RID = '2026-09-06-evidence-test';
const SID = '2026-09-06-session-test';
const TITLE = 'Mechanical test split';

function rel(ws: TmpWorkspace, ...segments: string[]): string {
  return join(ws.path, ...segments);
}

function readRel(ws: TmpWorkspace, ...segments: string[]): string {
  return readFileSync(rel(ws, ...segments), 'utf8');
}

function hasHeading(body: string, heading: string): boolean {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => /^#{1,3}\s+/.test(line) && line.toLowerCase().includes(heading.toLowerCase()));
}

describe('registerEvidenceCommands', () => {
  beforeEach(() => {
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it('evidence generate writes all 11 artifacts with the required gate markers', async () => {
    const ws = getWs();
    const { io, captured } = makeCapturedIo();
    const program = new Command();
    registerEvidenceCommands(program, io);

    await program.parseAsync(
      [
        'evidence', 'generate',
        '--rid', RID,
        '--title', TITLE,
        '--files', 'src/a.ts,src/b.ts,src/c.ts',
        '--line-counts', 'src/a.ts=120;src/b.ts=300;src/c.ts=450',
        '--session-id', SID,
        '--json'
      ],
      { from: 'user' }
    );

    const envelope = JSON.parse(captured.text().trim());
    expect(envelope.ok).toBe(true);
    expect(process.exitCode === undefined || process.exitCode === 0).toBe(true);

    // 1. rd/code-review-<rid>.md — ## Findings + CRITICAL
    const codeReview = readRel(ws, '.peaks', '_runtime', SID, 'rd', `code-review-${RID}.md`);
    expect(codeReview).toContain('## Findings');
    expect(codeReview).toContain('CRITICAL');

    // 2. audit/security-<rid>.md — ## Findings + CRITICAL (the gate's rid-scoped AUDIT_SECURITY slot)
    const securityReview = readRel(ws, '.peaks', '_runtime', SID, 'audit', `security-${RID}.md`);
    expect(securityReview).toContain('## Findings');
    expect(securityReview).toContain('CRITICAL');

    // 3. rd/karpathy-review-<rid>.md — ## Karpathy-Gate + 4 guideline headings
    const karpathy = readRel(ws, '.peaks', '_runtime', SID, 'rd', `karpathy-review-${RID}.md`);
    expect(karpathy).toContain('## Karpathy-Gate');
    expect(hasHeading(karpathy, 'Think Before Coding')).toBe(true);
    expect(hasHeading(karpathy, 'Simplicity First')).toBe(true);
    expect(hasHeading(karpathy, 'Surgical Changes')).toBe(true);
    expect(hasHeading(karpathy, 'Goal-Driven Execution')).toBe(true);

    // 4. rd/tech-doc.md
    expect(existsSync(rel(ws, '.peaks', '_runtime', SID, 'rd', 'tech-doc.md'))).toBe(true);

    // 5. audit/perf-<rid>.md — ## Results (and the N/A — no perf surface escape hatch)
    const perf = readRel(ws, '.peaks', '_runtime', SID, 'audit', `perf-${RID}.md`);
    expect(perf).toContain('## Results');
    expect(perf).toContain('N/A — no perf surface');

    // 6. qa/test-cases/<rid>.md — ## Test cases + a test( reference
    const testCases = readRel(ws, '.peaks', '_runtime', SID, 'qa', 'test-cases', `${RID}.md`);
    expect(testCases).toContain('## Test cases');
    expect(testCases).toContain('test(');

    // 7. qa/test-reports/<rid>.md — ## Test execution
    const testReport = readRel(ws, '.peaks', '_runtime', SID, 'qa', 'test-reports', `${RID}.md`);
    expect(testReport).toContain('## Test execution');

    // 8. qa/security-findings-<rid>.md — ## Findings (suffixed)
    const securityFindings = readRel(ws, '.peaks', '_runtime', SID, 'qa', `security-findings-${RID}.md`);
    expect(securityFindings).toContain('## Findings');

    // 9. qa/performance-findings-<rid>.md — ## Baseline (suffixed)
    const performanceFindings = readRel(ws, '.peaks', '_runtime', SID, 'qa', `performance-findings-${RID}.md`);
    expect(performanceFindings).toContain('## Baseline');

    // 10. qa/requests/001-<rid>.md — filled (no placeholders) + verdict pass
    const qaRequest = readRel(ws, '.peaks', '_runtime', SID, 'qa', 'requests', `001-${RID}.md`);
    expect(qaRequest).toContain('## Red-line boundary check');
    expect(qaRequest).toContain('## Acceptance checks');
    expect(qaRequest).toContain('## Verdict');
    expect(qaRequest).toContain('- overall: pass');
    expect(/<[A-Za-z][^>]*>/.test(qaRequest)).toBe(false);

    // 11. prd/handoff.md — the one canonical frontmatter: a PLAIN `schemaVersion: 2`
    // plus a PLAIN `sha256:` line whose value is sha256(BODY). That is what the
    // `AUDIT_REQUIRES_HANDOFF` gate and both audit loaders read; the generator
    // used to emit `handoffHash: sha256:<hex>` with no `^sha256:` line and hash
    // `frontmatter + body`, which the gate accepted and the loaders refused.
    const handoff = readRel(ws, '.peaks', '_runtime', SID, 'prd', 'handoff.md');
    expect(handoff).toContain('schemaVersion: 2');
    const shaMatch = handoff.match(/^sha256:\s*([0-9a-f]{64})$/m);
    expect(shaMatch).not.toBeNull();

    // Recompute over the BODY only — the range every consumer re-hashes.
    const fmMatch = handoff.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    expect(fmMatch).not.toBeNull();
    const recomputed = createHash('sha256').update(fmMatch![2]!, 'utf8').digest('hex');
    expect(recomputed).toBe(shaMatch![1]!);
  });

  it('evidence generate writes the qa request to an existing numbered filename when present', async () => {
    const ws = getWs();
    // Pre-seed an existing numbered QA request with a different number.
    const qaRequestsDir = rel(ws, '.peaks', '_runtime', SID, 'qa', 'requests');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(qaRequestsDir, { recursive: true });
    writeFileSync(join(qaRequestsDir, `007-${RID}.md`), '# existing\n', 'utf8');

    const { io, captured } = makeCapturedIo();
    const program = new Command();
    registerEvidenceCommands(program, io);

    await program.parseAsync(
      [
        'evidence', 'generate',
        '--rid', RID,
        '--title', TITLE,
        '--files', 'src/a.ts',
        '--line-counts', 'src/a.ts=120',
        '--session-id', SID,
        '--json'
      ],
      { from: 'user' }
    );

    const envelope = JSON.parse(captured.text().trim());
    expect(envelope.ok).toBe(true);

    expect(existsSync(join(qaRequestsDir, `007-${RID}.md`))).toBe(true);
    expect(existsSync(join(qaRequestsDir, `001-${RID}.md`))).toBe(false);
    const qaRequest = readFileSync(join(qaRequestsDir, `007-${RID}.md`), 'utf8');
    expect(qaRequest).toContain('## Red-line boundary check');
    expect(qaRequest).toContain('## Acceptance checks');
    expect(qaRequest).toContain('## Verdict');
  });
});
