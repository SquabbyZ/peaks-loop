/**
 * The `handoff-missing` refusal text, in one module so the security and perf
 * arms cannot drift apart.
 *
 * WHY THIS EXISTS. Both audit services read `prd/handoff-<rid>.md` and refuse
 * with detect state `handoff-missing` when it is absent — writing nothing. The
 * refusal used to name only the DIRECTORY and never said the audit itself had
 * succeeded. Measured twice on 2026-10-13, once per slice, by four independent
 * reviewers — the two slice ids are named in the RD request artifact, not here,
 * so this comment carries the fact without carrying provenance that rots:
 * each produced an envelope that PASSED `isSecurityAuditEnvelope` /
 * `isPerfAuditEnvelope` — so the run got past validation to this gate — and then
 * could not land it. The refusal named a file they had never been told they
 * would need, and the real order is handoff → audit.
 *
 * So the refusal now states the order: the envelope was valid, only the write is
 * blocked, here is the missing path, here is the one command that creates it.
 *
 * NOT DONE HERE, deliberately: creating the handoff. An audit must not author
 * its own input — synthesising the capsule would make the audit's premise
 * self-supplied — so this module names the creating command and stops.
 */
import { join } from 'node:path';

import { handoffRelativePath } from '../prd/handoff-service.js';

export type AuditRole = 'security' | 'perf';

/** Per-role names, so the two arms differ by data rather than by copy-paste. */
const ROLE: Record<AuditRole, { readonly skill: string; readonly validator: string }> = {
  security: { skill: 'peaks-security-audit', validator: 'isSecurityAuditEnvelope' },
  perf: { skill: 'peaks-perf-audit', validator: 'isPerfAuditEnvelope' }
};

export interface HandoffMissingRefusal {
  readonly warnings: readonly string[];
  readonly nextActions: readonly string[];
}

/** The replaced range, by name: C0 … DEL … C1. */
const LAST_C0_CODE_POINT = 0x1f;
const DEL_CODE_POINT = 0x7f;
const FIRST_C1_CODE_POINT = 0x80;
const LAST_C1_CODE_POINT = 0x9f;

const isControlCodePoint = (code: number): boolean =>
  code <= LAST_C0_CODE_POINT ||
  code === DEL_CODE_POINT ||
  (code >= FIRST_C1_CODE_POINT && code <= LAST_C1_CODE_POINT);

/**
 * A value as it may be PRINTED: control code points replaced with `?`, never
 * truncated — the same set `printableWarningText` (`src/cli/cli-helpers.ts`) and
 * `printableToken` (`.husky/pipeline/contract-verdict.mjs`) replace, and the same
 * code-point comparison `printableWarningText` uses to find them.
 *
 * `requestId` is safe without this (`handoffRelativePath` enforces
 * `REQUEST_ID_PATTERN`), but `sessionId` is guarded only by `isUnsafePathInput`,
 * which rejects traversal and drive paths and NOT C0/C1 control characters. A
 * newline in a `--sid` would otherwise split a refusal line and forge one of its
 * own — on the very surface this module exists to make readable.
 */
function printable(value: string): string {
  let rendered = '';
  for (const char of value) {
    rendered += isControlCodePoint(char.codePointAt(0) ?? 0) ? '?' : char;
  }
  return rendered;
}

/**
 * Build the refusal payload for a `handoff-missing` detect result.
 *
 * `envelopeValidated` is a MEASUREMENT, not an assumption — pass
 * `envelope !== undefined && is<Role>AuditEnvelope(envelope)`. The load-bearing
 * sentence is emitted only when it is true: the read-only `detect` surface
 * carries no envelope at all, so claiming there that the envelope was valid
 * would be a claim stronger than the code.
 *
 * An omitted `requestId` is the un-scoped probe: `resolveHandoffPath` could only
 * have tried `prd/handoff.md`, so the refusal must not name the slice-scoped path
 * as the missing one, and must say that the creating command needs a `--rid`
 * this run does not have.
 */
export function handoffMissingRefusal(opts: {
  readonly role: AuditRole;
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly requestId?: string;
  readonly envelopeValidated: boolean;
}): HandoffMissingRefusal {
  const { skill, validator } = ROLE[opts.role];
  // The real paths are built from the RAW ids, so `handoffRelativePath`'s guard
  // runs on exactly the bytes `resolveHandoffPath` would probe. Each value is
  // sanitised at the point it is interpolated, below — not here — so the render
  // is the only thing that changes.
  const prdDir = join(opts.projectRoot, '.peaks', '_runtime', opts.sessionId, 'prd');

  // The path the creating command WRITES. With a rid that is the slice-scoped
  // capsule; `resolveHandoffPath` already ran `handoffRelativePath` for these
  // same ids on the way in, so this join cannot throw where that one did not.
  const missingPath =
    opts.requestId === undefined
      ? join(prdDir, 'handoff.md')
      : join(opts.projectRoot, handoffRelativePath(opts.sessionId, opts.requestId));

  const createCommand =
    opts.requestId === undefined
      ? `peaks prd handoff init --rid <request-id> --sid ${opts.sessionId} --body <body> --apply`
      : `peaks prd handoff init --rid ${opts.requestId} --sid ${opts.sessionId} --body <body> --apply`;

  return {
    warnings: [
      `peaks-prd handoff not found under ${printable(prdDir)}`,
      ...(opts.requestId === undefined
        ? [
            "No --rid was supplied, so only the pre-rid-scoping `prd/handoff.md` could be probed. Pass --rid to resolve this slice's `prd/handoff-<rid>.md`."
          ]
        : [])
    ],
    nextActions: [
      ...(opts.envelopeValidated
        ? [
            `The audit envelope passed validation (${validator}); only the artifact write is blocked.`
          ]
        : []),
      opts.requestId === undefined
        ? `The only handoff path probed was: ${printable(missingPath)}`
        : `Missing peaks-prd handoff: ${printable(missingPath)}`,
      `Create it with: ${printable(createCommand)}`,
      `Until the handoff exists, ${skill} cannot start (gate fail).`
    ]
  };
}
