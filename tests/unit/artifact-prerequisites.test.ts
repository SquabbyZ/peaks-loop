import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';

vi.mock('../../src/services/mode/mode-enforcement.js', () => ({
  requireUserConfirmation: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../../src/services/artifacts/artifact-lint-service.js', () => ({
  lintRequestArtifact: vi.fn().mockResolvedValue(null)
}));

import {
  createRequestArtifact,
  transitionRequestArtifact,
  PrerequisitesNotSatisfiedError
} from '../../src/services/artifacts/request-artifact-service.js';

const SESSION = '2026-05-25-gated';
const TS = '2026-05-25T08:00:00.000Z';

async function makeProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'peaks-prereq-'));
}

async function seedRd(project: string, requestId: string): Promise<void> {
  await createRequestArtifact({
    role: 'rd', requestId, projectRoot: project, sessionId: SESSION, apply: true, clock: () => TS
  });
}

async function seedQa(project: string, requestId: string): Promise<void> {
  await createRequestArtifact({
    role: 'qa', requestId, projectRoot: project, sessionId: SESSION, apply: true, clock: () => TS
  });
}

async function writeArtifact(project: string, relativePath: string, body: string): Promise<void> {
  const fullPath = join(project, '.peaks', SESSION, relativePath);
  await mkdir(join(fullPath, '..'), { recursive: true });
  await writeFile(fullPath, body, 'utf8');
}

describe('transitionRequestArtifact — prerequisite enforcement', () => {
  test('rd→implemented is blocked without tech-doc.md', async () => {
    const project = await makeProject();
    await seedRd(project, '2026-05-25-feat');
    await expect(
      transitionRequestArtifact({
        role: 'rd', requestId: '2026-05-25-feat', projectRoot: project,
        newState: 'implemented', sessionId: SESSION, clock: () => TS
      })
    ).rejects.toBeInstanceOf(PrerequisitesNotSatisfiedError);
  });

  test('rd→implemented passes when tech-doc.md exists', async () => {
    const project = await makeProject();
    await seedRd(project, '2026-05-25-feat');
    await writeArtifact(project, 'rd/tech-doc.md', '# Tech doc\n\n## Red-line scope\n\n- ...\n\n## Implementation evidence\n\n- ...');
    const result = await transitionRequestArtifact({
      role: 'rd', requestId: '2026-05-25-feat', projectRoot: project,
      newState: 'implemented', sessionId: SESSION, clock: () => TS
    });
    expect(result?.state).toBe('implemented');
    expect(result?.bypassedPrerequisites).toBeUndefined();
  });

  test('rd→qa-handoff is blocked when code-review.md, security-review.md, or perf-baseline.md is missing', async () => {
    const project = await makeProject();
    await seedRd(project, '2026-05-25-feat');
    await writeArtifact(project, 'rd/tech-doc.md', '# Tech doc\n\n## Red-line scope\n\n- ...\n\n## Implementation evidence\n\n- ...');
    // code-review.md, security-review.md, perf-baseline.md, unit-tests, and qa-initiated intentionally missing
    let caught: PrerequisitesNotSatisfiedError | null = null;
    try {
      await transitionRequestArtifact({
        role: 'rd', requestId: '2026-05-25-feat', projectRoot: project,
        newState: 'qa-handoff', sessionId: SESSION, clock: () => TS
      });
    } catch (error) {
      if (error instanceof PrerequisitesNotSatisfiedError) caught = error;
    }
    expect(caught).not.toBeNull();
    const missingPaths = (caught?.missing ?? []).map((entry) => entry.path);
    expect(missingPaths).toContain('rd/code-review.md');
    expect(missingPaths).toContain('rd/security-review.md');
    expect(missingPaths).toContain('rd/perf-baseline.md');
    expect(missingPaths).toContain('qa/test-cases/2026-05-25-feat.md');
    expect(missingPaths).toContain('qa/.initiated');
    expect(missingPaths).not.toContain('rd/tech-doc.md');
  });

  test('rd→qa-handoff passes when perf-baseline.md carries a Results table (Gate B9)', async () => {
    const project = await makeProject();
    await seedRd(project, '2026-05-25-feat');
    await writeArtifact(project, 'rd/tech-doc.md', '# Tech doc\n\n## Red-line scope\n\n- ...\n\n## Implementation evidence\n\n- ...');
    await writeArtifact(project, 'rd/code-review.md', '# CR\n\n## Findings\n\n- none\n\nCRITICAL: 0');
    await writeArtifact(project, 'rd/security-review.md', '# SR\n\n## Findings\n\n- none');
    // perf-baseline with a real Results table
    await writeArtifact(
      project,
      'rd/perf-baseline.md',
      '# Perf baseline\n\n## Results\n\n| metric | baseline | target |\n|---|---|---|\n| render-time | 120ms | <200ms |\n'
    );
    await writeArtifact(project, 'qa/test-cases/2026-05-25-feat.md', '# cases\n\n## Test cases\n\ntest("example")');
    await writeArtifact(project, 'qa/.initiated', '');
    const result = await transitionRequestArtifact({
      role: 'rd', requestId: '2026-05-25-feat', projectRoot: project,
      newState: 'qa-handoff', sessionId: SESSION, clock: () => TS
    });
    expect(result?.state).toBe('qa-handoff');
    expect(result?.bypassedPrerequisites).toBeUndefined();
  });

  test('rd→qa-handoff passes when perf-baseline.md carries the N/A — no perf surface marker (escape hatch)', async () => {
    const project = await makeProject();
    await seedRd(project, '2026-05-25-feat');
    await writeArtifact(project, 'rd/tech-doc.md', '# Tech doc\n\n## Red-line scope\n\n- ...\n\n## Implementation evidence\n\n- ...');
    await writeArtifact(project, 'rd/code-review.md', '# CR\n\n## Findings\n\n- none\n\nCRITICAL: 0');
    await writeArtifact(project, 'rd/security-review.md', '# SR\n\n## Findings\n\n- none');
    // perf-baseline with the N/A escape hatch (no Results table)
    await writeArtifact(
      project,
      'rd/perf-baseline.md',
      '# Perf baseline\n\n## Notes\n\nN/A — no perf surface (this is a pure data-migration slice).\n'
    );
    await writeArtifact(project, 'qa/test-cases/2026-05-25-feat.md', '# cases\n\n## Test cases\n\ntest("example")');
    await writeArtifact(project, 'qa/.initiated', '');
    const result = await transitionRequestArtifact({
      role: 'rd', requestId: '2026-05-25-feat', projectRoot: project,
      newState: 'qa-handoff', sessionId: SESSION, clock: () => TS
    });
    expect(result?.state).toBe('qa-handoff');
  });

  test('rd→qa-handoff is blocked when perf-baseline.md exists but has neither Results table nor N/A marker', async () => {
    const project = await makeProject();
    await seedRd(project, '2026-05-25-feat');
    await writeArtifact(project, 'rd/tech-doc.md', '# Tech doc\n\n## Red-line scope\n\n- ...\n\n## Implementation evidence\n\n- ...');
    await writeArtifact(project, 'rd/code-review.md', '# CR\n\n## Findings\n\n- none\n\nCRITICAL: 0');
    await writeArtifact(project, 'rd/security-review.md', '# SR\n\n## Findings\n\n- none');
    // perf-baseline stub WITHOUT a Results table and WITHOUT the N/A marker
    await writeArtifact(project, 'rd/perf-baseline.md', '# Perf baseline\n\nWIP\n');
    await writeArtifact(project, 'qa/test-cases/2026-05-25-feat.md', '# cases\n\n## Test cases\n\ntest("example")');
    await writeArtifact(project, 'qa/.initiated', '');
    let caught: PrerequisitesNotSatisfiedError | null = null;
    try {
      await transitionRequestArtifact({
        role: 'rd', requestId: '2026-05-25-feat', projectRoot: project,
        newState: 'qa-handoff', sessionId: SESSION, clock: () => TS
      });
    } catch (error) {
      if (error instanceof PrerequisitesNotSatisfiedError) caught = error;
    }
    expect(caught).not.toBeNull();
    const missingPaths = (caught?.missing ?? []).map((entry) => entry.path);
    expect(missingPaths).toContain('rd/perf-baseline.md');
  });

  test('qa→verdict-issued is blocked without security-findings.md and performance-findings.md', async () => {
    const project = await makeProject();
    await seedQa(project, '2026-05-25-feat');
    await writeArtifact(project, 'qa/test-cases/2026-05-25-feat.md', '# cases');
    await writeArtifact(project, 'qa/test-reports/2026-05-25-feat.md', '# report');
    let caught: PrerequisitesNotSatisfiedError | null = null;
    try {
      await transitionRequestArtifact({
        role: 'qa', requestId: '2026-05-25-feat', projectRoot: project,
        newState: 'verdict-issued', sessionId: SESSION, clock: () => TS
      });
    } catch (error) {
      if (error instanceof PrerequisitesNotSatisfiedError) caught = error;
    }
    expect(caught).not.toBeNull();
    const missingPaths = (caught?.missing ?? []).map((entry) => entry.path);
    expect(missingPaths).toContain('qa/security-findings.md');
    expect(missingPaths).toContain('qa/performance-findings.md');
  });

  test('qa→verdict-issued passes when every gated file exists', async () => {
    const project = await makeProject();
    await seedQa(project, '2026-05-25-feat');
    await writeArtifact(project, 'qa/test-cases/2026-05-25-feat.md', '# cases\n\n## Test cases\n\ntest("example")');
    await writeArtifact(project, 'qa/test-reports/2026-05-25-feat.md', '# report\n\n## Test execution\n\n- pass');
    await writeArtifact(project, 'qa/security-findings.md', '# security\n\n## Findings\n\n- none');
    await writeArtifact(project, 'qa/performance-findings.md', '# perf\n\n## Baseline\n\n- 100ms');
    const result = await transitionRequestArtifact({
      role: 'qa', requestId: '2026-05-25-feat', projectRoot: project,
      newState: 'verdict-issued', sessionId: SESSION, clock: () => TS
    });
    expect(result?.state).toBe('verdict-issued');
  });

  test('allowIncomplete=true bypasses the check and records the bypass in the artifact body', async () => {
    const project = await makeProject();
    await seedRd(project, '2026-05-25-doc-only');
    const result = await transitionRequestArtifact({
      role: 'rd', requestId: '2026-05-25-doc-only', projectRoot: project,
      newState: 'qa-handoff', sessionId: SESSION, allowIncomplete: true,
      reason: 'docs-only change, no implementation', clock: () => TS
    });
    expect(result?.state).toBe('qa-handoff');
    expect(result?.bypassedPrerequisites?.ok).toBe(false);
    expect(result?.bypassedPrerequisites?.missing.length).toBeGreaterThan(0);
    const body = await readFile(result?.path ?? '', 'utf8');
    expect(body).toContain('docs-only change');
    expect(body).toContain('bypassed prerequisites');
    expect(body).toContain('rd/tech-doc.md');
  });

  test('transitions with no prerequisites stay unaffected (prd→confirmed-by-user)', async () => {
    const project = await makeProject();
    await createRequestArtifact({
      role: 'prd', requestId: '2026-05-25-feat', projectRoot: project,
      sessionId: SESSION, apply: true, clock: () => TS
    });
    const result = await transitionRequestArtifact({
      role: 'prd', requestId: '2026-05-25-feat', projectRoot: project,
      newState: 'confirmed-by-user', sessionId: SESSION, clock: () => TS
    });
    expect(result?.state).toBe('confirmed-by-user');
    expect(result?.bypassedPrerequisites).toBeUndefined();
  });
});
