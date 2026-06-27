/**
 * TDD coverage for the security-audit service
 * (`src/services/audit-independent/security-audit-service.ts`).
 *
 * Covers (per PRD v2.12.0 AC-2.8 — 6 cases):
 *   1. isSecurityAuditEnvelope — strict shape validator (pass / reject)
 *   2. detectSecurityAudit — 5-state (ready / handoff-missing /
 *      template-missing / dispatch-failed / envelope-malformed)
 *   3. readAndVerifyHandoff — sha256 verification (match / mismatch)
 *   4. readSecurityTemplate — project-level template loader (present /
 *      missing)
 *   5. renderSecurityAuditArtifact — markdown body rendering with
 *      all required sections per audit-output-schema.md
 *   6. runSecurityAudit — convenience wrapper (happy path + missing
 *      template short-circuit)
 *
 * No real handoff / template required — all fixtures are synthetic
 * and use a tmp dir.
 */
import { describe, expect, test } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  detectSecurityAudit,
  isSecurityAuditEnvelope,
  readAndVerifyHandoff,
  readSecurityTemplate,
  renderSecurityAuditArtifact,
  runSecurityAudit,
  type SecurityAuditEnvelope,
  type SecurityAuditViolation
} from '../../../../src/services/audit-independent/security-audit-service.js';

const ISO = '2026-06-27T10:00:00.000Z';

function makeViolation(over: Partial<SecurityAuditViolation> = {}): SecurityAuditViolation {
  return {
    dimension: 'Path traversal & filesystem trust',
    severity: 'HIGH',
    file: 'src/services/foo.ts',
    line: 42,
    hint: 'path.resolve not called before fs.readFile',
    ...over
  };
}

function makeEnvelope(over: Partial<SecurityAuditEnvelope> = {}): SecurityAuditEnvelope {
  return {
    verdict: 'pass',
    violations: [],
    summary: 'No security issues found in the in-scope surface.',
    ...over
  };
}

function makeProjectRoot(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-security-audit-test-'));
}

function makeHandoffFixture(projectRoot: string, sid: string, bodyContent: string): string {
  const runtimeDir = join(projectRoot, '.peaks', '_runtime', sid, 'prd');
  mkdirSync(runtimeDir, { recursive: true });
  const body = bodyContent;
  const sha256 = createHash('sha256').update(body, 'utf8').digest('hex');
  const content = `---\nschemaVersion: 2\nsha256: ${sha256}\n---\n${body}`;
  const handoffPath = join(runtimeDir, 'handoff.md');
  writeFileSync(handoffPath, content, 'utf8');
  return handoffPath;
}

function makeTemplateFixture(projectRoot: string): void {
  const scanDir = join(projectRoot, '.peaks', 'project-scan');
  mkdirSync(scanDir, { recursive: true });
  writeFileSync(
    join(scanDir, 'security-template.md'),
    '---\nschemaVersion: 1\n---\n# Security template (test fixture)\n',
    'utf8'
  );
}

describe('isSecurityAuditEnvelope — strict shape validator', () => {
  test('accepts the canonical envelope shape (empty + non-empty violations)', () => {
    expect(isSecurityAuditEnvelope(makeEnvelope())).toBe(true);
    expect(isSecurityAuditEnvelope(makeEnvelope({
      verdict: 'block',
      violations: [makeViolation({ severity: 'CRITICAL' }), makeViolation({ severity: 'MED' })]
    }))).toBe(true);
  });

  test('rejects null / non-objects / wrong verdict / wrong severity / wrong types', () => {
    expect(isSecurityAuditEnvelope(null)).toBe(false);
    expect(isSecurityAuditEnvelope(undefined)).toBe(false);
    expect(isSecurityAuditEnvelope('pass')).toBe(false);
    expect(isSecurityAuditEnvelope({ verdict: 'PASS', violations: [], summary: 'x' })).toBe(false);
    expect(isSecurityAuditEnvelope({ verdict: 'pass', violations: 'not-array', summary: 'x' })).toBe(false);
    expect(isSecurityAuditEnvelope({ verdict: 'pass', violations: [], summary: 42 })).toBe(false);
    expect(isSecurityAuditEnvelope({
      verdict: 'pass',
      violations: [{ dimension: 'x', severity: 'FATAL', file: 'a', line: 1, hint: 'h' }],
      summary: 'x'
    })).toBe(false);
    expect(isSecurityAuditEnvelope({
      verdict: 'pass',
      violations: [{ dimension: 'x', severity: 'HIGH', file: 'a', line: '1', hint: 'h' }],
      summary: 'x'
    })).toBe(false);
  });
});

describe('detectSecurityAudit — 5-state detector', () => {
  test('returns handoff-missing when handoff absent', () => {
    const projectRoot = makeProjectRoot();
    const result = detectSecurityAudit({ projectRoot, sessionId: 'sid-1' });
    expect(result.state).toBe('handoff-missing');
    expect(result.handoffPresent).toBe(false);
    expect(result.nextActions.length).toBeGreaterThan(0);
    rmSync(projectRoot, { recursive: true, force: true });
  });

  test('returns template-missing when handoff present but template absent', () => {
    const projectRoot = makeProjectRoot();
    const sid = 'sid-template-missing';
    makeHandoffFixture(projectRoot, sid, '# Goals\n- G1: ship it\n');
    const result = detectSecurityAudit({ projectRoot, sessionId: sid });
    expect(result.state).toBe('template-missing');
    expect(result.handoffPresent).toBe(true);
    expect(result.templatePresent).toBe(false);
    rmSync(projectRoot, { recursive: true, force: true });
  });

  test('returns ready when both handoff and template are present', () => {
    const projectRoot = makeProjectRoot();
    const sid = 'sid-ready';
    makeHandoffFixture(projectRoot, sid, '# Goals\n- G1: ship it\n');
    makeTemplateFixture(projectRoot);
    const result = detectSecurityAudit({ projectRoot, sessionId: sid });
    expect(result.state).toBe('ready');
    expect(result.handoffPresent).toBe(true);
    expect(result.templatePresent).toBe(true);
    rmSync(projectRoot, { recursive: true, force: true });
  });

  test('returns dispatch-failed when dispatchError is set', () => {
    const projectRoot = makeProjectRoot();
    const sid = 'sid-dispatch-failed';
    makeHandoffFixture(projectRoot, sid, '# Goals\n- G1\n');
    makeTemplateFixture(projectRoot);
    const result = detectSecurityAudit({
      projectRoot,
      sessionId: sid,
      dispatchError: new Error('parent LLM threw')
    });
    expect(result.state).toBe('dispatch-failed');
    expect(result.handoffPresent).toBe(true);
    expect(result.templatePresent).toBe(true);
    rmSync(projectRoot, { recursive: true, force: true });
  });

  test('returns envelope-malformed when envelope fails validation', () => {
    const projectRoot = makeProjectRoot();
    const sid = 'sid-envelope-malformed';
    makeHandoffFixture(projectRoot, sid, '# Goals\n- G1\n');
    makeTemplateFixture(projectRoot);
    const result = detectSecurityAudit({
      projectRoot,
      sessionId: sid,
      envelope: { verdict: 'PASS', violations: [], summary: 'x' } // wrong case
    });
    expect(result.state).toBe('envelope-malformed');
    rmSync(projectRoot, { recursive: true, force: true });
  });
});

describe('readAndVerifyHandoff — sha256 verification', () => {
  test('returns parsed frontmatter + body on sha256 match', () => {
    const projectRoot = makeProjectRoot();
    const sid = 'sid-verify';
    const body = '# Goals\n- G1: do the thing\n';
    makeHandoffFixture(projectRoot, sid, body);
    const handoffPath = join(projectRoot, '.peaks', '_runtime', sid, 'prd', 'handoff.md');
    const result = readAndVerifyHandoff(handoffPath, projectRoot);
    expect(result).not.toBeNull();
    expect(result?.frontmatter.schemaVersion).toBe(2);
    expect(result?.frontmatter.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result?.body).toBe(body);
    rmSync(projectRoot, { recursive: true, force: true });
  });

  test('returns null on sha256 mismatch', () => {
    const projectRoot = makeProjectRoot();
    const sid = 'sid-mismatch';
    const body = '# Goals\n- G1\n';
    const handoffPath = makeHandoffFixture(projectRoot, sid, body);
    // Tamper with the body, leaving the frontmatter sha256 stale.
    const tampered = `# Goals\n- G1: tampered\n`;
    writeFileSync(handoffPath, readFileSync(handoffPath, 'utf8').replace(body, tampered), 'utf8');
    const result = readAndVerifyHandoff(handoffPath, projectRoot);
    expect(result).toBeNull();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  test('returns null when file absent', () => {
    const projectRoot = makeProjectRoot();
    const result = readAndVerifyHandoff(join(projectRoot, 'missing.md'), projectRoot);
    expect(result).toBeNull();
    rmSync(projectRoot, { recursive: true, force: true });
  });
});

describe('readSecurityTemplate — project-level template loader', () => {
  test('returns template body when file present', () => {
    const projectRoot = makeProjectRoot();
    makeTemplateFixture(projectRoot);
    const result = readSecurityTemplate(projectRoot);
    expect(result).not.toBeNull();
    expect(result).toContain('Security template');
    rmSync(projectRoot, { recursive: true, force: true });
  });

  test('returns null when template absent', () => {
    const projectRoot = makeProjectRoot();
    expect(readSecurityTemplate(projectRoot)).toBeNull();
    rmSync(projectRoot, { recursive: true, force: true });
  });
});

describe('renderSecurityAuditArtifact — markdown body rendering', () => {
  test('renders all required sections per audit-output-schema.md', () => {
    const env = makeEnvelope({
      verdict: 'warn',
      violations: [
        makeViolation({ severity: 'CRITICAL', dimension: 'SQL/NoSQL injection' }),
        makeViolation({ severity: 'MED', dimension: 'Input validation' })
      ]
    });
    const rendered = renderSecurityAuditArtifact(env, {
      rid: '2026-06-27-test-1',
      handoffHash: 'a'.repeat(64),
      generatedAt: ISO
    });
    expect(rendered.verdict).toBe('warn');
    expect(rendered.violationsCount).toBe(2);
    expect(rendered.body).toContain('## Summary');
    expect(rendered.body).toContain('## Threat model coverage');
    expect(rendered.body).toContain('## Findings');
    expect(rendered.body).toContain('## Required fixes');
    expect(rendered.body).toContain('## Verdict');
    expect(rendered.body).toContain('CRITICAL: 1');
    expect(rendered.body).toContain('verdict: warn');
    expect(rendered.body).toContain('SQL/NoSQL injection');
  });

  test('renders zero-violation artifact cleanly (no Required fixes section)', () => {
    const env = makeEnvelope({ verdict: 'pass' });
    const rendered = renderSecurityAuditArtifact(env, {
      rid: '2026-06-27-test-2',
      handoffHash: 'b'.repeat(64),
      generatedAt: ISO
    });
    expect(rendered.violationsCount).toBe(0);
    expect(rendered.body).toContain('## Findings');
    expect(rendered.body).toContain('- (none)');
    expect(rendered.body).not.toContain('## Required fixes');
    expect(rendered.body).toContain('CRITICAL: 0');
  });
});

describe('runSecurityAudit — convenience wrapper', () => {
  test('happy path: writes the artifact and returns the detect + verdict', () => {
    const projectRoot = makeProjectRoot();
    const sid = 'sid-run-happy';
    const body = '# Goals\n- G1\n';
    makeHandoffFixture(projectRoot, sid, body);
    makeTemplateFixture(projectRoot);

    const result = runSecurityAudit({
      projectRoot,
      sessionId: sid,
      rid: '2026-06-27-run-1',
      generatedAt: ISO,
      envelope: makeEnvelope({ verdict: 'block', violations: [makeViolation({ severity: 'CRITICAL' })] })
    });

    expect(result.detect.state).toBe('ready');
    expect(result.artifactPath).not.toBeNull();
    expect(result.violationsCount).toBe(1);
    expect(result.verdict).toBe('block');
    expect(existsSync(result.artifactPath!)).toBe(true);

    const written = readFileSync(result.artifactPath!, 'utf8');
    expect(written).toContain('verdict: block');
    expect(written).toContain('CRITICAL: 1');

    rmSync(projectRoot, { recursive: true, force: true });
  });

  test('short-circuits with null artifactPath when template is missing', () => {
    const projectRoot = makeProjectRoot();
    const sid = 'sid-run-no-template';
    makeHandoffFixture(projectRoot, sid, '# Goals\n- G1\n');

    const result = runSecurityAudit({
      projectRoot,
      sessionId: sid,
      rid: '2026-06-27-run-2',
      generatedAt: ISO,
      envelope: makeEnvelope()
    });

    expect(result.detect.state).toBe('template-missing');
    expect(result.artifactPath).toBeNull();
    expect(result.violationsCount).toBe(0);
    expect(result.verdict).toBeNull();

    rmSync(projectRoot, { recursive: true, force: true });
  });
});
