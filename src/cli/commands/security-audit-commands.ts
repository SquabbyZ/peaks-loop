/**
 * peaks security-audit * CLI surface — independent security audit skill
 * driver. Per slice v2.12.0 (Group A, Tier 2). Decouples security
 * review from peaks-rd's 5-way fan-out's `security-reviewer` slot.
 *
 * Subcommands:
 *   - `peaks security-audit detect` — JSON envelope describing the
 *     5-state security-audit runtime (ready / handoff-missing /
 *     template-missing / dispatch-failed / envelope-malformed).
 *     Mirrors `peaks code-review detect-ocr` semantics.
 *   - `peaks security-audit run` — runs the full pipeline:
 *     detect → read handoff + template → write audit artifact to
 *     `.peaks/_runtime/<sid>/audit/security-<rid>.md`. Reads the
 *     envelope JSON from --envelope file or stdin.
 *
 * The actual LLM-in-loop judgement is NOT in this CLI — the parent
 * LLM (peaks-security-audit skill prompt) is the judgement core.
 * This CLI is the I/O + validation shell, mirroring the ecc-bridge
 * pattern (slice 7 Group D).
 */
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import {
  detectSecurityAudit,
  isSecurityAuditEnvelope,
  runSecurityAudit,
  type SecurityAuditEnvelope,
} from '../../services/audit-independent/security-audit-service.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from '../../shared/result.js';

type DetectOptions = {
  rid?: string;
  sid?: string;
  project?: string;
  json?: boolean;
};

type RunOptions = {
  rid?: string;
  sid?: string;
  project?: string;
  envelope?: string;
  json?: boolean;
};

function resolveEnvelope(envelopePath: string | undefined): unknown {
  if (envelopePath === undefined || envelopePath === '-') {
    // Read from stdin
    return readStdinSync();
  }
  try {
    const raw = readFileSync(envelopePath, 'utf8');
    return JSON.parse(raw);
  } catch (error: unknown) {
    throw new Error(
      `Failed to read envelope from ${envelopePath}: ${getErrorMessage(error)}`
    );
  }
}

function readStdinSync(): unknown {
  // Node 22: read stdin synchronously via fs.readFileSync(0, 'utf8').
  // We use the file descriptor 0 convention.
  try {
    // Lazy import to avoid pulling readline at module load
    const { readFileSync: rfs } = require('node:fs') as typeof import('node:fs');
    const raw = rfs(0, 'utf8');
    if (raw.trim().length === 0) {
      throw new Error('stdin was empty; expected JSON envelope on stdin or --envelope <path>');
    }
    return JSON.parse(raw);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('stdin was empty')) {
      throw error;
    }
    throw new Error(`Failed to read envelope from stdin: ${getErrorMessage(error)}`);
  }
}

export function registerSecurityAuditCommands(program: Command, io: ProgramIO): void {
  const securityAudit = program
    .command('security-audit')
    .description(
      'Independent security audit skill driver. Reads the immutable peaks-prd handoff (sha256-locked) + the project-level security-template.md, then writes a structured security-<rid>.md artifact. Decoupled from peaks-rd 5-way fan-out per slice v2.12.0 (Group A, Tier 2). See skills/peaks-security-audit/SKILL.md for the full workflow.'
    );

  addJsonOption(
    securityAudit
      .command('detect')
      .description(
        'Read-only probe: returns the 5-state security-audit runtime as a JSON envelope (ready / handoff-missing / template-missing / dispatch-failed / envelope-malformed). The peaks-security-audit skill calls this first to decide whether to invoke `run`. Mirrors `peaks code-review detect-ocr` semantics.'
      )
      .option('--rid <rid>', 'request id (e.g. 2026-06-27-v2-12-...)')
      .option('--sid <sid>', 'session id (e.g. 2026-06-27-session-...)')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((options: DetectOptions) => {
    const projectRoot = options.project ?? process.cwd();
    const sid = options.sid;
    if (sid === undefined || sid.length === 0) {
      printResult(
        io,
        fail(
          'security-audit.detect',
          'SID_REQUIRED',
          'session id (--sid) is required for security-audit.detect',
          { state: 'sid-missing' },
          ['Pass --sid <session-id> (e.g. 2026-06-27-session-...)', 'Run `peaks session info --active --json` to find the active sid.']
        ),
        options.json
      );
      process.exitCode = 1;
      return;
    }
    try {
      const detect = detectSecurityAudit({
        projectRoot,
        sessionId: sid,
      });
      const envelope = detect.state === 'ready'
        ? ok('security-audit.detect', detect, [...detect.warnings], [...detect.nextActions])
        : fail(
            'security-audit.detect',
            detect.state.toUpperCase().replace(/-/g, '_'),
            `security-audit is not ready: ${detect.state}`,
            detect,
            [...detect.nextActions]
          );
      printResult(io, envelope, options.json);
      if (detect.state !== 'ready') {
        process.exitCode = 1;
      }
    } catch (error: unknown) {
      printResult(
        io,
        fail(
          'security-audit.detect',
          'DETECT_SECURITY_AUDIT_FAILED',
          getErrorMessage(error),
          {
            state: 'detection-failed',
            handoffPresent: false,
            templatePresent: false,
            warnings: [],
            nextActions: [],
          },
          ['Re-run with --project <path> pointing at a known-good project root.']
        ),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    securityAudit
      .command('run')
      .description(
        'Run the full security-audit pipeline: detect → read handoff + template → write audit artifact to `.peaks/_runtime/<sid>/audit/security-<rid>.md`. Reads the envelope JSON from --envelope <path> or stdin. The peaks-security-audit skill emits the envelope; this CLI validates the shape via isSecurityAuditEnvelope and writes the artifact. Exits 0 on success, 1 on any failure mode (detection, validation, or write).'
      )
      .option('--rid <rid>', 'request id (e.g. 2026-06-27-v2-12-...)')
      .option('--sid <sid>', 'session id (e.g. 2026-06-27-session-...)')
      .option('--project <path>', 'project root (default: cwd)')
      .option('--envelope <path>', 'path to envelope JSON file; "-" reads from stdin (default: stdin)')
  ).action((options: RunOptions) => {
    const projectRoot = options.project ?? process.cwd();
    const sid = options.sid;
    const rid = options.rid;
    if (sid === undefined || sid.length === 0) {
      printResult(
        io,
        fail(
          'security-audit.run',
          'SID_REQUIRED',
          'session id (--sid) is required for security-audit.run',
          {},
          ['Pass --sid <session-id> (e.g. 2026-06-27-session-...)']
        ),
        options.json
      );
      process.exitCode = 1;
      return;
    }
    if (rid === undefined || rid.length === 0) {
      printResult(
        io,
        fail(
          'security-audit.run',
          'RID_REQUIRED',
          'request id (--rid) is required for security-audit.run',
          {},
          ['Pass --rid <request-id> (e.g. 2026-06-27-v2-12-...)']
        ),
        options.json
      );
      process.exitCode = 1;
      return;
    }
    try {
      const envelopeValue = resolveEnvelope(options.envelope);
      if (!isSecurityAuditEnvelope(envelopeValue)) {
        printResult(
          io,
          fail(
            'security-audit.run',
            'ENVELOPE_MALFORMED',
            'envelope failed isSecurityAuditEnvelope validation (expected { verdict, violations, summary })',
            { receivedType: typeof envelopeValue },
            [
              'Verify the peaks-security-audit skill prompt matches the strict-shape contract.',
              'Re-emit the envelope; see skills/peaks-security-audit/references/audit-protocol.md.'
            ]
          ),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      const result = runSecurityAudit({
        projectRoot,
        sessionId: sid,
        rid,
        generatedAt: new Date().toISOString(),
        envelope: envelopeValue as SecurityAuditEnvelope,
      });
      if (result.detect.state !== 'ready' || result.artifactPath === null) {
        printResult(
          io,
          fail(
            'security-audit.run',
            result.detect.state.toUpperCase().replace(/-/g, '_'),
            `security-audit is not ready: ${result.detect.state}`,
            result,
            [...result.detect.nextActions]
          ),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      printResult(
        io,
        ok(
          'security-audit.run',
          {
            detect: result.detect,
            artifactPath: result.artifactPath,
            violationsCount: result.violationsCount,
            verdict: result.verdict,
          },
          [...result.detect.warnings],
          [...result.detect.nextActions]
        ),
        options.json
      );
    } catch (error: unknown) {
      printResult(
        io,
        fail(
          'security-audit.run',
          'RUN_SECURITY_AUDIT_FAILED',
          getErrorMessage(error),
          {},
          ['Verify the envelope JSON is well-formed and matches the strict-shape contract.']
        ),
        options.json
      );
      process.exitCode = 1;
    }
  });
}
