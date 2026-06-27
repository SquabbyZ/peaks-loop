/**
 * peaks-security-audit service — independent security audit skill driver.
 *
 * Slice v2.12.0 (Group A, Tier 2). The skill is decoupled from the
 * peaks-rd 5-way fan-out (per PRD AC-2.x) and lives as a standalone
 * CLI surface: `peaks security-audit run --rid <id> ...`.
 *
 * The service owns:
 *   - 5-state detection of the security-audit runtime
 *     (handoff-missing / template-missing / dispatch-failed / template-malformed / ready)
 *   - Loading + sha256 verification of the prd/handoff.md
 *   - Loading the project-level security-template.md
 *   - Producing the audit envelope (verdict + violations) to write
 *     to `.peaks/_runtime/<sid>/audit/security-<rid>.md`
 *
 * The actual LLM-in-loop audit step is NOT in this service — the
 * parent LLM (peaks-security-audit skill prompt) reads the template,
 * runs the audit, and returns a structured envelope. This service
 * is the pure I/O + validation core; the LLM is the judgement core.
 *
 * Why a service (not inlined in the CLI):
 *   - Unit-testable in isolation (6 case per PRD AC-2.8)
 *   - The 5-state detector mirrors the ecc-bridge detectEcc pattern
 *     (slice 7 Group D), keeping the surface uniform
 *   - Future migration to peaks sub-agent dispatch (peaks-rd main
 *     loop can opt to call this service directly without re-implementing
 *     the handoff verification)
 *
 * Cross-references:
 *   - PRD: `.peaks/_runtime/<sid>/prd/handoff.md` (sha256-locked, schemaVersion: 2)
 *   - Template: `.peaks/project-scan/security-template.md`
 *   - Output: `.peaks/_runtime/<sid>/audit/security-<rid>.md`
 *   - Schema: `.peaks/project-scan/audit-output-schema.md` (schemaVersion: 1)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * 5-state detection result. Mirrors `detectEcc` in `services/code-review/ecc-bridge.ts`.
 *
 *   - `ready`              — handoff + template + project all present
 *   - `handoff-missing`    — `.peaks/_runtime/<sid>/prd/handoff.md` absent
 *   - `template-missing`   — `.peaks/project-scan/security-template.md` absent
 *   - `dispatch-failed`    — parent LLM threw before returning the audit envelope
 *   - `envelope-malformed` — parent LLM returned a value that fails `isSecurityAuditEnvelope`
 */
export type SecurityAuditDetectState =
  | 'ready'
  | 'handoff-missing'
  | 'template-missing'
  | 'dispatch-failed'
  | 'envelope-malformed';

export interface SecurityAuditDetectResult {
  readonly state: SecurityAuditDetectState;
  readonly handoffPresent: boolean;
  readonly templatePresent: boolean;
  readonly warnings: readonly string[];
  readonly nextActions: readonly string[];
}

export type SecurityAuditVerdict = 'pass' | 'warn' | 'block';

export interface SecurityAuditViolation {
  readonly dimension: string;
  readonly severity: 'CRITICAL' | 'HIGH' | 'MED' | 'LOW';
  readonly file: string;
  readonly line: number;
  readonly hint: string;
}

export interface SecurityAuditEnvelope {
  readonly verdict: SecurityAuditVerdict;
  readonly violations: ReadonlyArray<SecurityAuditViolation>;
  readonly summary: string;
}

/**
 * Validate a raw value as a SecurityAuditEnvelope. Mirrors the
 * `isEccEnvelope` strict-shape pattern.
 */
export function isSecurityAuditEnvelope(value: unknown): value is SecurityAuditEnvelope {
  if (value === null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.verdict !== 'string') return false;
  if (obj.verdict !== 'pass' && obj.verdict !== 'warn' && obj.verdict !== 'block') {
    return false;
  }
  if (!Array.isArray(obj.violations)) return false;
  if (typeof obj.summary !== 'string') return false;
  for (const v of obj.violations) {
    if (v === null || typeof v !== 'object') return false;
    const vo = v as Record<string, unknown>;
    if (typeof vo.dimension !== 'string') return false;
    if (typeof vo.severity !== 'string') return false;
    if (vo.severity !== 'CRITICAL' && vo.severity !== 'HIGH' && vo.severity !== 'MED' && vo.severity !== 'LOW') {
      return false;
    }
    if (typeof vo.file !== 'string') return false;
    if (typeof vo.line !== 'number' || !Number.isFinite(vo.line)) return false;
    if (typeof vo.hint !== 'string') return false;
  }
  return true;
}

/**
 * Handoff frontmatter — minimal projection of peaks-prd v2.11.0 handoff
 * frontmatter. We only need sha256 for verification; the rest of the
 * handoff body is consumed by the parent LLM, not by this service.
 */
export interface HandoffFrontmatter {
  readonly sha256: string;
  readonly schemaVersion: number;
}

/**
 * Read the peaks-prd handoff frontmatter + body, verify sha256 matches
 * the body. Returns null on missing file or sha256 mismatch; otherwise
 * returns the parsed frontmatter + body string.
 *
 * Defensive: we read frontmatter via a 1-line regex match, not via
 * a YAML parser. The handoff service (`src/services/prd/handoff-service.ts`)
 * is the canonical writer; we only consume its output here.
 */
export function readAndVerifyHandoff(
  handoffPath: string,
  projectRoot: string
): { frontmatter: HandoffFrontmatter; body: string } | null {
  if (!handoffPath || !isAbsolute(handoffPath)) {
    const absolutePath = resolve(projectRoot, handoffPath);
    if (!existsSync(absolutePath)) return null;
    return readAndVerifyHandoff(absolutePath, projectRoot);
  }
  if (!existsSync(handoffPath)) return null;

  let raw: string;
  try {
    raw = readFileSync(handoffPath, 'utf8');
  } catch {
    return null;
  }

  // Frontmatter pattern: `---` line, then key: value pairs, then `---` line.
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (match === null) return null;

  const frontmatterRaw = match[1]!;
  const body = match[2]!;

  const sha256Match = frontmatterRaw.match(/^sha256:\s*([a-f0-9]{64})\s*$/m);
  const schemaVersionMatch = frontmatterRaw.match(/^schemaVersion:\s*(\d+)\s*$/m);
  if (sha256Match === null || schemaVersionMatch === null) return null;

  const sha256Expected = sha256Match[1]!;
  const schemaVersion = parseInt(schemaVersionMatch[1]!, 10);
  const sha256Actual = createHash('sha256').update(body, 'utf8').digest('hex');

  if (sha256Expected !== sha256Actual) return null;

  return {
    frontmatter: { sha256: sha256Expected, schemaVersion },
    body,
  };
}

/**
 * Read the project-level security-template.md. Returns the body
 * string (with frontmatter stripped) or null if the file is absent.
 * Does NOT validate the template content; the parent LLM validates
 * by reading.
 */
export function readSecurityTemplate(projectRoot: string): string | null {
  const templatePath = join(projectRoot, '.peaks', 'project-scan', 'security-template.md');
  if (!existsSync(templatePath)) return null;
  try {
    return readFileSync(templatePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * 5-state detector. The parent skill inspects the state and either
 * proceeds (when `ready`) or records a degradation note and falls
 * back (when any other state).
 *
 * Soft-fail policy mirrors `detectEcc` (slice 7 Group D): the CLI
 * never throws; it returns a typed detect result.
 */
export function detectSecurityAudit(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly dispatchError?: unknown;
  readonly envelope?: unknown;
}): SecurityAuditDetectResult {
  const warnings: string[] = [];
  const nextActions: string[] = [];

  const handoffPath = join(
    input.projectRoot,
    '.peaks',
    '_runtime',
    input.sessionId,
    'prd',
    'handoff.md'
  );
  const handoffPresent = existsSync(handoffPath);

  const templatePath = join(
    input.projectRoot,
    '.peaks',
    'project-scan',
    'security-template.md'
  );
  const templatePresent = existsSync(templatePath);

  if (!handoffPresent) {
    return {
      state: 'handoff-missing',
      handoffPresent: false,
      templatePresent,
      warnings: [`peaks-prd handoff not found at ${handoffPath}`],
      nextActions: [
        'Run peaks-prd handoff init to produce a sha256-locked handoff before running peaks security-audit.',
        'Until the handoff exists, peaks-security-audit cannot start (gate fail).'
      ]
    };
  }

  if (!templatePresent) {
    return {
      state: 'template-missing',
      handoffPresent: true,
      templatePresent: false,
      warnings: [`security-template.md not found at ${templatePath}`],
      nextActions: [
        'Run peaks project template init to bootstrap the 3 audit templates (security-template, perf-template, audit-output-schema).',
        'Until the template exists, peaks-security-audit cannot start (gate fail).'
      ]
    };
  }

  if (input.dispatchError !== undefined) {
    return {
      state: 'dispatch-failed',
      handoffPresent: true,
      templatePresent: true,
      warnings: [
        `Audit dispatch failed: ${input.dispatchError instanceof Error ? input.dispatchError.message : String(input.dispatchError)}`
      ],
      nextActions: [
        'Inspect the audit prompt template for the failure cause.',
        'peaks-security-audit falls back to inline LLM review (degradation note: security-audit-dispatch-failed).'
      ]
    };
  }

  if (input.envelope !== undefined && !isSecurityAuditEnvelope(input.envelope)) {
    return {
      state: 'envelope-malformed',
      handoffPresent: true,
      templatePresent: true,
      warnings: [
        'Security-audit returned a value that failed envelope validation (expected { verdict, violations, summary }).'
      ],
      nextActions: [
        'Verify the security-audit skill prompt matches PRD AC-2.x output shape.',
        'If the envelope shape is intentionally different, file a bug at the peaks-cli repo.'
      ]
    };
  }

  return {
    state: 'ready',
    handoffPresent: true,
    templatePresent: true,
    warnings,
    nextActions
  };
}

/**
 * Render a SecurityAuditEnvelope to the canonical audit artifact body
 * (markdown). Mirrors `adaptEccEnvelopeToRdCodeReview` in ecc-bridge.ts:
 * produce a markdown body with all required sections, ready to write
 * to `.peaks/_runtime/<sid>/audit/security-<rid>.md`.
 */
export function renderSecurityAuditArtifact(
  env: SecurityAuditEnvelope,
  opts: { rid: string; handoffHash: string; generatedAt: string }
): { body: string; violationsCount: number; verdict: SecurityAuditVerdict } {
  const counts: Record<string, number> = {};
  for (const v of env.violations) {
    counts[v.severity] = (counts[v.severity] ?? 0) + 1;
  }
  const criticalCount = counts['CRITICAL'] ?? 0;

  const findingsBullets = env.violations.length === 0
    ? '- (none)'
    : env.violations.map((v) => `- [${v.severity}] ${v.dimension} @ ${v.file}:${v.line} — ${v.hint}`).join('\n');

  const requiredFixes = env.violations.length === 0
    ? ''
    : [
        '## Required fixes',
        '',
        ...env.violations.map((v) => `- [${v.severity}] ${v.file}:${v.line} — ${v.hint}`),
        ''
      ].join('\n');

  const body = [
    '## Summary',
    '',
    env.summary,
    '',
    '## Threat model coverage',
    '',
    `audited at: ${opts.generatedAt}`,
    `verdict: ${env.verdict}`,
    `handoffHash: ${opts.handoffHash}`,
    '',
    '## Findings',
    '',
    findingsBullets,
    '',
    requiredFixes,
    '## Verdict',
    '',
    `verdict: ${env.verdict}`,
    `CRITICAL: ${criticalCount}`,
    ''
  ].filter((s) => s.length > 0).join('\n');

  return {
    body,
    violationsCount: env.violations.length,
    verdict: env.verdict,
  };
}

/**
 * Write the rendered audit artifact to
 * `.peaks/_runtime/<sid>/audit/security-<rid>.md`.
 *
 * Atomic write (tmp + rename) to avoid partial writes on crash.
 * Returns the absolute path on success.
 */
export function writeSecurityAuditArtifact(
  projectRoot: string,
  sessionId: string,
  rid: string,
  body: string
): string {
  const targetDir = join(
    projectRoot,
    '.peaks',
    '_runtime',
    sessionId,
    'audit'
  );
  mkdirSync(targetDir, { recursive: true });
  const targetPath = join(targetDir, `security-${rid}.md`);
  // tmp + rename for atomicity
  const tmpPath = `${targetPath}.tmp`;
  writeFileSync(tmpPath, body, 'utf8');
  // Sync rename: on Windows, fs.renameSync overwrites if target exists (Node 22+)
  const { renameSync } = require('node:fs') as typeof import('node:fs');
  renameSync(tmpPath, targetPath);
  return targetPath;
}

/**
 * Convenience: run `detectSecurityAudit` + `renderSecurityAuditArtifact`
 * + `writeSecurityAuditArtifact` in one call.
 *
 * Returns `{ detect, artifactPath, violationsCount, verdict }` or
 * `{ detect, artifactPath: null, ... }` when not ready.
 */
export function runSecurityAudit(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly rid: string;
  readonly generatedAt: string;
  readonly dispatchError?: unknown;
  readonly envelope?: unknown;
}): {
  detect: SecurityAuditDetectResult;
  artifactPath: string | null;
  violationsCount: number;
  verdict: SecurityAuditVerdict | null;
} {
  const detect = detectSecurityAudit({
    projectRoot: input.projectRoot,
    sessionId: input.sessionId,
    ...(input.dispatchError !== undefined ? { dispatchError: input.dispatchError } : {}),
    ...(input.envelope !== undefined ? { envelope: input.envelope } : {})
  });

  if (detect.state !== 'ready' || input.envelope === undefined) {
    return { detect, artifactPath: null, violationsCount: 0, verdict: null };
  }

  // detect.state === 'ready' implies input.envelope passed isSecurityAuditEnvelope.
  const env = input.envelope as SecurityAuditEnvelope;

  const handoffPath = join(
    input.projectRoot,
    '.peaks',
    '_runtime',
    input.sessionId,
    'prd',
    'handoff.md'
  );
  const verified = readAndVerifyHandoff(handoffPath, input.projectRoot);
  const handoffHash = verified?.frontmatter.sha256 ?? 'unknown';

  const rendered = renderSecurityAuditArtifact(env, {
    rid: input.rid,
    handoffHash,
    generatedAt: input.generatedAt
  });

  const artifactPath = writeSecurityAuditArtifact(
    input.projectRoot,
    input.sessionId,
    input.rid,
    rendered.body
  );

  return {
    detect,
    artifactPath,
    violationsCount: rendered.violationsCount,
    verdict: rendered.verdict
  };
}
