/**
 * `peaks code-review` delegation verbs — the two-phase, no-credential review path.
 *
 * Phase 1 (`run-ocr-18 --delegate`) writes a packet: OCR's deterministic file
 * selection, the pattern that selected each file, the resolved rules, the range
 * and the cost. Phase 2 (`ocr-delegate-record`) validates the host agent's
 * findings envelope and records it with `ocr-delegate` attribution.
 *
 * Neither phase calls an LLM and neither reads a provider key: the agent that
 * holds the tools reviews with the model it is already running on.
 */
import { join } from 'node:path';
import { getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import {
  collectDelegatePacket,
  isDelegateRid,
  writeDelegatePacket,
  type DelegatePacketResult
} from '../../services/lint/ocr-18-delegate-packet.js';
import { getSessionDir } from '../../services/session/getSessionDir.js';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';

const RUN_COMMAND = 'code-review.run-ocr-18';

/** Reported by both phases, so a caller never has to guess the field name. */
const NOT_A_CLEAN_REVIEW = 'Nothing was reviewed — this is not a clean review.';

const NOT_LANGUAGE_SCOPED =
  '`--delegate` is not language-scoped — `ocr delegate preview` takes no language.';

export type DelegateRunOptions = {
  rid?: string;
  sessionId?: string;
  language?: string;
  languages?: string;
  from?: string;
  to?: string;
  commit?: string;
  json?: boolean;
};

type Refusal = { readonly code: string; readonly message: string };

type DelegateTarget = { readonly rid: string; readonly sessionId: string };

function refused<T extends object>(target: T | Refusal): target is Refusal {
  return 'code' in target;
}

function refuse(io: ProgramIO, options: DelegateRunOptions, code: string, message: string): void {
  printResult(
    io,
    fail(RUN_COMMAND, code, message, { state: 'packet-refused' }, [NOT_A_CLEAN_REVIEW]),
    options.json
  );
}

function resolveSession(options: DelegateRunOptions, projectRoot: string): string | null {
  const sessionId =
    options.sessionId ?? process.env['PEAKS_SESSION_ID'] ?? getCurrentSessionId(projectRoot);
  return sessionId === null || sessionId === undefined || sessionId.length === 0 ? null : sessionId;
}

/** Everything `--delegate` cannot express is refused here, before anything is spawned. */
function delegateTarget(
  options: DelegateRunOptions,
  projectRoot: string
): Refusal | DelegateTarget {
  if (options.languages !== undefined && options.languages.trim().toLowerCase() !== 'auto') {
    return {
      code: 'LANGUAGE_FLAGS_CONFLICT',
      message: `${NOT_LANGUAGE_SCOPED} Use \`--languages auto\`.`
    };
  }
  if (options.language !== undefined) {
    return { code: 'LANGUAGE_FLAGS_CONFLICT', message: NOT_LANGUAGE_SCOPED };
  }
  const rid = options.rid?.trim();
  if (rid === undefined || rid.length === 0) {
    return {
      code: 'RID_REQUIRED',
      message: '`--delegate` writes a durable packet named after the request; pass `--rid <rid>`.'
    };
  }
  // The rid names a file, so it is validated before it is ever joined into a path.
  if (!isDelegateRid(rid)) {
    return {
      code: 'INVALID_RID',
      message: `\`--rid\` must be a single path segment: ${rid}`
    };
  }
  const sessionId = resolveSession(options, projectRoot);
  if (sessionId === null) {
    return {
      code: 'NO_ACTIVE_SESSION',
      message: 'No session is bound: pass `--session-id <sid>` or set PEAKS_SESSION_ID.'
    };
  }
  return { rid, sessionId };
}

function rangeOf(options: DelegateRunOptions): { from?: string; to?: string; commit?: string } {
  return {
    ...(options.from !== undefined ? { from: options.from } : {}),
    ...(options.to !== undefined ? { to: options.to } : {}),
    ...(options.commit !== undefined ? { commit: options.commit } : {})
  };
}

function printUnavailable(
  io: ProgramIO,
  options: DelegateRunOptions,
  failure: { readonly state: string },
  data: unknown
): void {
  printResult(
    io,
    fail(
      RUN_COMMAND,
      failure.state.toUpperCase().replace(/-/g, '_'),
      `ocr 1.x state: ${failure.state}`,
      data,
      ['Re-run `peaks code-review detect-ocr-18 --json` to refresh.', NOT_A_CLEAN_REVIEW]
    ),
    options.json
  );
}

function printCollected(
  io: ProgramIO,
  options: DelegateRunOptions,
  collected: DelegatePacketResult,
  packetPath: string
): void {
  const data = { ...collected.packet, packetPath };
  if (collected.failure !== null) {
    printUnavailable(io, options, collected.failure, data);
    return;
  }
  if (collected.packet.state !== 'awaiting-envelope') {
    printResult(
      io,
      ok(
        RUN_COMMAND,
        data,
        [
          `Delegation packet state: ${collected.packet.state} — nothing was handed to the host agent.`,
          NOT_A_CLEAN_REVIEW
        ],
        []
      ),
      options.json
    );
    return;
  }
  printResult(
    io,
    ok(
      RUN_COMMAND,
      data,
      [...collected.packet.warnings],
      [
        'Review the selected files against the resolved rules, then record the findings:',
        `peaks code-review ocr-delegate-record --packet ${packetPath} --envelope <path to the findings envelope file> --json`
      ]
    ),
    options.json
  );
}

function collectOrReport(
  io: ProgramIO,
  options: DelegateRunOptions,
  target: DelegateTarget,
  projectRoot: string
): DelegatePacketResult | null {
  try {
    return collectDelegatePacket({
      cwd: projectRoot,
      rid: target.rid,
      session: target.sessionId,
      range: rangeOf(options)
    });
  } catch (error: unknown) {
    printResult(
      io,
      fail(
        RUN_COMMAND,
        'OCR18_DETECT_FAILED',
        getErrorMessage(error),
        { state: 'detection-failed' },
        ['The git range could not be read, so nothing was reviewed.', NOT_A_CLEAN_REVIEW]
      ),
      options.json
    );
    return null;
  }
}

function writeOrReport(
  io: ProgramIO,
  options: DelegateRunOptions,
  packetPath: string,
  collected: DelegatePacketResult
): boolean {
  try {
    writeDelegatePacket(packetPath, collected.packet);
    return true;
  } catch (error: unknown) {
    printResult(
      io,
      fail(
        RUN_COMMAND,
        'OCR18_PACKET_WRITE_FAILED',
        getErrorMessage(error),
        { state: 'packet-write-failed', packetPath },
        ['Check that the session directory is writable.', NOT_A_CLEAN_REVIEW]
      ),
      options.json
    );
    process.exitCode = 1;
    return false;
  }
}

export function runDelegatePacket(io: ProgramIO, options: DelegateRunOptions): void {
  const projectRoot = process.cwd();
  const target = delegateTarget(options, projectRoot);
  if (refused(target)) {
    refuse(io, options, target.code, target.message);
    return;
  }

  let packetPath: string;
  try {
    packetPath = join(
      getSessionDir(projectRoot, target.sessionId),
      'rd',
      'ocr-delegate',
      `${target.rid}-packet.json`
    );
  } catch (error: unknown) {
    refuse(io, options, 'INVALID_SESSION_ID', getErrorMessage(error));
    return;
  }

  const collected = collectOrReport(io, options, target, projectRoot);
  if (collected === null) return;
  if (!writeOrReport(io, options, packetPath, collected)) return;
  printCollected(io, options, collected, packetPath);
}
