/**
 * The dispatch-ledger reader: the half of the in-flight probe that touches the
 * filesystem.
 *
 * WHAT IT READS. The session's ledger under `.peaks/_sub_agents/<sid>/`:
 * the `active-dispatches.json` index (which rows are active) and the dispatch
 * record each row names (what those dispatches are doing). The index is the
 * enumeration and the records are the facts, and the two are read separately
 * because only the record carries a lifecycle.
 *
 * WHY THE INDEX ENUMERATES. The index is bounded by the ledger reaper, so a
 * session's index stays small while its records directory grows for the whole
 * retention window. Reading the directory instead would read every record a
 * session ever wrote on every probe.
 *
 * WHAT IT DOES NOT DECIDE. Nothing here says whether a dispatch is in flight.
 * The reader reports facts — a record that is there, a record that is gone, a
 * record that cannot be read — and the pure probe
 * (`../workflow/workflow-inflight-probe.js`) turns them into the answer. That
 * split is what lets the decision be tested without a filesystem.
 *
 * THE DIRECTION OF THE FACTS. A record that cannot be read is reported as
 * unreadable rather than as absent, because "I could not look" and "there is
 * nothing there" are different facts and only one of them may end a deferral.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import { activeDispatchIndexPath } from './active-dispatch-index.js';
import { upgradeRecord } from './dispatch-record-upgrade.js';
import { assertSafeDispatchRecordPath } from '../security/safe-settings-path.js';
import { isSinglePathSegment } from '../session/getSessionDir.js';
import type { LedgerDispatchFact, LedgerFacts } from '../workflow/workflow-inflight-probe.js';

export interface DispatchLedgerInput {
  readonly projectRoot: string;
  readonly sessionId: string;
}

/** The rows the index names, or the refusal to enumerate them. */
type IndexRows =
  { readonly ok: true; readonly recordPaths: readonly string[] } | { readonly ok: false };

/** One record's fields, or the refusal to read it. */
type ParsedRecord =
  | {
      readonly ok: true;
      readonly status: string;
      readonly outcome: string;
      readonly lastBeatAt: string | null;
      readonly createdAt: string;
      readonly disposed: boolean;
    }
  | { readonly ok: false };

/**
 * Read one session's dispatch ledger.
 *
 * `absent` when the session has no ledger at all (no dispatch was ever
 * registered), `unreadable` when the index is there but cannot be parsed, and
 * `readable` with one fact per row otherwise.
 */
export function readDispatchLedgerFacts(input: DispatchLedgerInput): LedgerFacts {
  // The session id is the last caller-supplied segment of the ledger's path,
  // so it is checked BEFORE the path is built: an id carrying a separator
  // would point this reader outside the project root. A refused id is an
  // unknown, not an absence, so the answer defers.
  if (!isSinglePathSegment(input.sessionId)) {
    return { ledgerState: 'unreadable', dispatches: [] };
  }
  const indexPath = activeDispatchIndexPath(input.projectRoot, input.sessionId);
  if (!existsSync(indexPath)) return { ledgerState: 'absent', dispatches: [] };
  const rows = readIndexRows(indexPath);
  if (!rows.ok) return { ledgerState: 'unreadable', dispatches: [] };
  const ledgerDir = dirname(indexPath);
  const dispatches = rows.recordPaths.map((recordPath) =>
    readDispatchFact(input.projectRoot, ledgerDir, recordPath)
  );
  return { ledgerState: 'readable', dispatches };
}

/** The record paths the index names, or the refusal to enumerate them. */
function readIndexRows(indexPath: string): IndexRows {
  let raw: string;
  try {
    raw = readFileSync(indexPath, 'utf8');
  } catch (error: unknown) {
    void error;
    return { ok: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    void error;
    return { ok: false };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false };
  }
  return { ok: true, recordPaths: Object.keys(parsed) };
}

/**
 * The record's path, guarded.
 *
 * A row whose path leaves the ledger is refused here: the row may name a
 * dispatch, but the path it names is not one this session may read, so the
 * facts behind it stay unknown.
 */
function safeRecordPath(projectRoot: string, ledgerDir: string, recordPath: string): string | null {
  const candidate = isAbsolute(recordPath) ? recordPath : resolve(ledgerDir, recordPath);
  try {
    return assertSafeDispatchRecordPath(candidate, projectRoot);
  } catch (error: unknown) {
    void error;
    return null;
  }
}

/** One row's facts: the record behind it, or why there are none. */
function readDispatchFact(
  projectRoot: string,
  ledgerDir: string,
  recordPath: string
): LedgerDispatchFact {
  const safe = safeRecordPath(projectRoot, ledgerDir, recordPath);
  if (safe === null) return { kind: 'unreadable', recordPath };
  if (!existsSync(safe)) return { kind: 'absent', recordPath: safe };
  const parsed = parseRecord(safe);
  if (!parsed.ok) return { kind: 'unreadable', recordPath: safe };
  return {
    kind: 'record',
    recordPath: safe,
    status: parsed.status,
    outcome: parsed.outcome,
    lastBeatAt: parsed.lastBeatAt,
    createdAt: parsed.createdAt,
    disposed: parsed.disposed
  };
}

/**
 * One record's fields.
 *
 * The record is upgraded through the writer's own reader, so a legacy record
 * is read the same way every other reader reads it and a record from a build
 * this one does not understand is refused rather than half-believed. The
 * STATUS is taken from the raw record rather than from the upgrade: the
 * upgrade maps a status it does not recognise onto `unreadable`, and this
 * reader must be able to tell the probe that the record said something the
 * probe does not know.
 */
function parseRecord(recordPath: string): ParsedRecord {
  let raw: string;
  try {
    raw = readFileSync(recordPath, 'utf8');
  } catch (error: unknown) {
    void error;
    return { ok: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    void error;
    return { ok: false };
  }
  let upgraded;
  try {
    upgraded = upgradeRecord(parsed);
  } catch (error: unknown) {
    void error;
    return { ok: false };
  }
  const status = (parsed as { status?: unknown }).status;
  if (typeof status !== 'string') return { ok: false };
  return {
    ok: true,
    status,
    outcome: upgraded.outcome,
    lastBeatAt: upgraded.lastBeatAt,
    createdAt: upgraded.createdAt,
    disposed: upgraded.disposed
  };
}
