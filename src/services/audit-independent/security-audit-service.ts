/**
 * peaks-security-audit service — independent security audit skill driver.
 *
 * Slice v2.12.0 (Group A, Tier 2). The skill is decoupled from the
 * CLI surface: `peaks security-audit run --rid <id> ...`.
 *
 * The service owns:
 *   - 5-state detection of the security-audit runtime
 *     (handoff-missing / template-missing / dispatch-failed / template-malformed / ready)
 *   - Loading + sha256 verification of the slice's prd/handoff-<rid>.md
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

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveHandoffPath } from '../prd/handoff-service.js';
import { handoffMissingRefusal } from './handoff-missing-refusal.js';
import {
  renderSecurityAuditArtifact,
  writeSecurityAuditArtifact
} from './security-audit-artifact.js';
import {
  declarationMissingDetect,
  renderJudgedDeclaration,
  type JudgedDeclaration
} from './judged-declaration.js';
import { buildJudgedDeclarationFor } from './judged-declaration-build.js';

/**
 * 5-state detection result. Mirrors `detectEcc` in `services/code-review/ecc-bridge.ts`.
 *
 *   - `ready`              — handoff + template + project all present
 *   - `handoff-missing`    — this slice's `.peaks/_runtime/<sid>/prd/handoff-<rid>.md`
 *   - `template-missing`   — `.peaks/project-scan/security-template.md` absent
 *   - `dispatch-failed`    — parent LLM threw before returning the audit envelope
 *   - `envelope-malformed` — parent LLM returned a value that fails `isSecurityAuditEnvelope`
 */
export type SecurityAuditDetectState =
  | 'ready'
  | 'handoff-missing'
  | 'template-missing'
  | 'dispatch-failed'
  | 'envelope-malformed'
  | 'declaration-missing';

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
    if (
      vo.severity !== 'CRITICAL' &&
      vo.severity !== 'HIGH' &&
      vo.severity !== 'MED' &&
      vo.severity !== 'LOW'
    ) {
      return false;
    }
    if (typeof vo.file !== 'string') return false;
    if (typeof vo.line !== 'number' || !Number.isFinite(vo.line)) return false;
    if (typeof vo.hint !== 'string') return false;
  }
  return true;
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
  /**
   * The slice whose capsule this run audits. Slice
   * filename, so a caller that knows it must pass it or the probe resolves
   * `runSecurityAudit` always did, and `peaks security-audit detect` forwards
   * its long-standing `--rid` flag as of the post-verification repair round.
   */
  readonly requestId?: string;
  readonly dispatchError?: unknown;
  readonly envelope?: unknown;
}): SecurityAuditDetectResult {
  const warnings: string[] = [];
  const nextActions: string[] = [];

  const handoffPath = resolveHandoffPath({
    projectRoot: input.projectRoot,
    sessionId: input.sessionId,
    ...(input.requestId !== undefined ? { requestId: input.requestId } : {})
  });
  const handoffPresent = handoffPath !== null;

  const templatePath = join(input.projectRoot, '.peaks', 'project-scan', 'security-template.md');
  const templatePresent = existsSync(templatePath);

  if (!handoffPresent) {
    const refusal = handoffMissingRefusal({
      role: 'security',
      projectRoot: input.projectRoot,
      sessionId: input.sessionId,
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
      // Measured, not assumed: `detect` supplies no envelope at all.
      envelopeValidated: input.envelope !== undefined && isSecurityAuditEnvelope(input.envelope)
    });
    return {
      state: 'handoff-missing',
      handoffPresent: false,
      templatePresent,
      warnings: refusal.warnings,
      nextActions: refusal.nextActions
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
        'If the envelope shape is intentionally different, file a bug at the peaks-loop repo.'
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
  /** Project-relative paths this audit judged; written into the artifact as
   *  the declaration the transition gate reads back. Required — a path that
   *  cannot be hashed is refused, because a declaration naming a file that is
   *  not there cannot be checked later. */
  readonly judgedPaths: readonly string[];
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
    requestId: input.rid,
    ...(input.dispatchError !== undefined ? { dispatchError: input.dispatchError } : {}),
    ...(input.envelope !== undefined ? { envelope: input.envelope } : {})
  });

  // The stamp is built inside the producer, before anything is written, so a
  // caller that reaches the service alone still cannot leave an unstamped
  // artifact behind. Folding its failure into the probe's own verdict keeps the
  // refusal on this function's single early-return rather than a second one.
  const built = buildJudgedDeclarationFor(input);
  // A probe that is already refusing keeps its own diagnosis: the declaration
  // is what this run would write, not what stopped it earlier.
  const probe: SecurityAuditDetectResult =
    built.ok || detect.state !== 'ready' ? detect : declarationMissingDetect(detect, built);

  if (probe.state !== 'ready' || input.envelope === undefined || !built.ok) {
    return { detect: probe, artifactPath: null, violationsCount: 0, verdict: null };
  }

  // probe.state === 'ready' implies input.envelope passed isSecurityAuditEnvelope.
  const env = input.envelope as SecurityAuditEnvelope;

  const renderOpts = {
    rid: input.rid,
    handoffHash: built.handoffHash,
    generatedAt: input.generatedAt
  };
  const rendered = renderSecurityAuditArtifact(env, renderOpts);

  const declared: JudgedDeclaration = built.declaration;
  const body = `${rendered.body}\n${renderJudgedDeclaration(declared)}`;
  const artifactPath = writeSecurityAuditArtifact(
    input.projectRoot,
    input.sessionId,
    input.rid,
    body
  );

  return {
    detect,
    artifactPath,
    violationsCount: rendered.violationsCount,
    verdict: rendered.verdict
  };
}
