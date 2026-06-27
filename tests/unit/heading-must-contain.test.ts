/**
 * Slice 2.6.1.F — headingMustContain field
 * Slice v2.12.0 Group B Tier 5 — audit/{security,perf}.md + prd/handoff.md prereqs.
 *
 * Verifies the L3 LOW mitigation: when a prereq declares
 * `headingMustContain`, the file must have each entry as an actual
 * markdown heading (`#`–`###` line prefix), not just as prose.
 *
 * Strategy: stand up the full `rd:qa-handoff` chain (code-review,
 * audit/security, audit/perf, prd/handoff, karpathy-review,
 * qa/test-cases, qa/.initiated) and vary only the karpathy-review.md
 * body. The other files are minimal stubs that satisfy their own
 * `mustContain` checks; the karpathy file is the unit under test.
 *
 * v2.12.0 Group B Tier 5: the v2.11.x rd/security-review.md +
 * rd/perf-baseline.md slots are replaced by audit/security.md +
 * audit/perf.md (new peaks-security-audit / peaks-perf-audit
 * outputs). The PRD handoff is required via AUDIT_REQUIRES_HANDOFF.
 *
 * AC-1 4 guideline headings + Karpathy-Gate header -> pass
 * AC-2 4 markers as prose (no heading prefix) -> fail
 * AC-3 missing 1 of 4 headings -> fail with the missing marker named
 * AC-4 headings inside a code fence (regex is strict, not fence-aware) -> documented pass
 */

import { describe, expect, it } from 'vitest';
import {
  checkPrerequisites
} from '../../src/services/artifacts/artifact-prerequisites.js';
import { createRequestArtifact } from '../../src/services/artifacts/request-artifact-service.js';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SESSION = '2026-06-18-hmc';
const REQUEST_ID = '2026-06-18-hmc-feat';

async function setupFullChain(karpathyBody: string): Promise<{
  projectRoot: string;
  result: Awaited<ReturnType<typeof checkPrerequisites>>;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), 'hmc-'));
  const sessionRoot = join(root, '.peaks', '_runtime', SESSION);
  await mkdir(join(sessionRoot, 'rd'), { recursive: true });
  await mkdir(join(sessionRoot, 'audit'), { recursive: true });
  await mkdir(join(sessionRoot, 'prd'), { recursive: true });
  await mkdir(join(sessionRoot, 'qa'), { recursive: true });
  await mkdir(join(sessionRoot, 'qa', 'test-cases'), { recursive: true });

  // Stand up the request artifact so changeId-resolution works.
  await createRequestArtifact({
    role: 'rd',
    requestId: REQUEST_ID,
    projectRoot: root,
    sessionId: SESSION,
    apply: true,
    clock: () => '2026-06-18T08:00:00.000Z'
  });

  // The 6 prereqs that rd:qa-handoff expects (v2.12.0 Group B Tier 5):
  // code-review, audit/security (new peaks-security-audit output),
  // audit/perf (new peaks-perf-audit output), prd/handoff
  // (AUDIT_REQUIRES_HANDOFF), karpathy-review, qa/test-cases,
  // qa/.initiated.
  await writeFile(
    join(sessionRoot, 'rd/code-review.md'),
    '# CR\n\n## Findings\n- none\n\nCRITICAL: 0\n'
  );
  await writeFile(
    join(sessionRoot, 'audit/security.md'),
    '# Security audit\n\n## Verdict\n\n- pass\n'
  );
  await writeFile(
    join(sessionRoot, 'audit/perf.md'),
    '# Perf audit\n\n## Baseline\n\n| metric | baseline | target |\n|---|---|---|\n| x | 1 | <2 |\n'
  );
  // PRD handoff must carry schemaVersion: 2 + sha256: marker so the
  // AUDIT_REQUIRES_HANDOFF gate accepts it.
  await writeFile(
    join(sessionRoot, 'prd/handoff.md'),
    '# Handoff\n\nschemaVersion: 2\nsha256: a1b2c3\n\n## Goals\n\n- ...\n'
  );
  await writeFile(join(sessionRoot, 'rd/karpathy-review.md'), karpathyBody);
  await writeFile(
    join(sessionRoot, 'qa/test-cases', `${REQUEST_ID}.md`),
    '# cases\n\n## Test cases\n\ntest("example")\n'
  );
  await writeFile(join(sessionRoot, 'qa/.initiated'), '');

  const result = await checkPrerequisites({
    role: 'rd',
    newState: 'qa-handoff',
    projectRoot: root,
    changeId: SESSION,
    sessionId: SESSION,
    requestId: REQUEST_ID
  });
  return {
    projectRoot: root,
    result,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    }
  };
}

function missingDescription(result: Awaited<ReturnType<typeof checkPrerequisites>>, substr: string): string {
  const found = result.missing.find((m) => m.description.includes(substr));
  return found?.description ?? '';
}

describe('Slice 2.6.1.F — headingMustContain', () => {
  it('AC-1 a file with 4 guideline headings passes the full rd:qa-handoff chain', async () => {
    const { result, cleanup } = await setupFullChain(
      `# Karpathy review

## Think Before Coding
Done.

## Simplicity First
Done.

## Surgical Changes
Done.

## Goal-Driven Execution
Done.

## Karpathy-Gate
passes.
`
    );
    try {
      expect(result.ok).toBe(true);
      expect(result.missing).toHaveLength(0);
    } finally {
      await cleanup();
    }
  });

  it('AC-2 a file with the 4 markers as prose (no heading prefix) fails', async () => {
    const { result, cleanup } = await setupFullChain(
      `# Karpathy review

This file mentions Think Before Coding, Simplicity First, Surgical Changes, and Goal-Driven Execution as plain prose, but it does not have them as headings.

## Karpathy-Gate
passes the substring check.
`
    );
    try {
      expect(result.ok).toBe(false);
      const desc = missingDescription(result, 'missing heading(s)');
      expect(desc).toContain('Think Before Coding');
      expect(desc).toContain('Simplicity First');
      expect(desc).toContain('Surgical Changes');
      expect(desc).toContain('Goal-Driven Execution');
    } finally {
      await cleanup();
    }
  });

  it('AC-3 a file missing 1 of 4 headings fails with the missing marker named', async () => {
    const { result, cleanup } = await setupFullChain(
      `# Karpathy review

## Think Before Coding
Done.

## Simplicity First
Done.

## Surgical Changes
Done.

## Karpathy-Gate
passes.
`
    );
    try {
      expect(result.ok).toBe(false);
      const desc = missingDescription(result, 'missing heading(s)');
      // The "missing heading(s):" list is appended to the prereq description.
      // Check the suffix specifically (the prereq description itself mentions
      // all 4 markers in prose, which would be a false positive).
      expect(desc).toMatch(/missing heading\(s\):\s*Goal-Driven Execution/);
      expect(desc).not.toMatch(/missing heading\(s\):.*Think Before Coding/);
    } finally {
      await cleanup();
    }
  });

  it('AC-4 headings inside a code fence (regex is strict, not fence-aware) -> documented pass', async () => {
    const { result, cleanup } = await setupFullChain(
      `# Karpathy review

\`\`\`
## Think Before Coding
## Simplicity First
## Surgical Changes
## Goal-Driven Execution
\`\`\`

## Karpathy-Gate
passes the substring check.
`
    );
    try {
      // The current regex matches every `^#{1,3}` line, including fenced
      // lines. This is documented as a known limitation; the test pins
      // the behaviour so future refactors do not silently change it.
      expect(result.ok).toBe(true);
    } finally {
      await cleanup();
    }
  });
});
