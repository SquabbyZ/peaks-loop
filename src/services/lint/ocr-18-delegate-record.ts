/**
 * OCR 1.x delegation — phase 2: validate the host agent's findings and record them.
 *
 * The envelope is authored by the agent, so it is untrusted input: a malformed
 * entry is refused with the offending index named, never coerced. A finding is
 * mapped onto `Ocr18Finding` through the same `severityFor` map the API path uses,
 * and carries `ocr-delegate` attribution so it is never mistaken for an OCR
 * finding.
 *
 * The packet is the other half of the binding: findings are recorded only against
 * an existing packet in state `awaiting-envelope`, so a packet cannot be invented
 * by submitting an envelope. Recording does not advance the packet — the findings
 * document is the record of phase 2 — so recording again replaces the earlier
 * findings file and reports `replaced: true`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { isInsidePath, pathsEqual, stableRealPath } from '../../shared/path-utils.js';
import { languageForPath } from './ocr-18-language-routing.js';
import {
  emptyByLanguage,
  severityFor,
  summarize,
  type Ocr18Finding,
  type Ocr18Summary
} from './ocr-multilang-adapter.js';

/** The vocabulary the envelope may use; anything else is refused, not mapped to `info`. */
const ENVELOPE_SEVERITIES: ReadonlySet<string> = new Set([
  'error',
  'critical',
  'high',
  'warn',
  'warning',
  'medium',
  'info',
  'low'
]);

const PACKET_STATES = new Set([
  'no-routed-language',
  'unsupported-files-only',
  'ocr-unavailable',
  'awaiting-envelope'
]);

export type DelegateFinding = Ocr18Finding & { readonly attribution: 'ocr-delegate' };

export type DelegateFindingsDocument = {
  readonly schema_version: '1';
  readonly mode: 'delegate';
  readonly state: 'recorded';
  readonly attribution: 'ocr-delegate';
  readonly rid: string;
  readonly session: string;
  readonly packet: string;
  readonly findings: readonly DelegateFinding[];
  readonly summary: Ocr18Summary;
};

export type EnvelopeResult =
  | { readonly ok: true; readonly packet: string; readonly findings: readonly DelegateFinding[] }
  | { readonly ok: false; readonly message: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textProblem(record: Record<string, unknown>, key: string, at: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0
    ? null
    : `${at}.${key} must be a non-empty string`;
}

function lineProblem(record: Record<string, unknown>, at: string): string | null {
  const start = record['start_line'];
  if (typeof start !== 'number' || !Number.isInteger(start) || start < 1) {
    return `${at}.start_line must be a positive integer`;
  }
  const end = record['end_line'];
  if (end === undefined) return null;
  return typeof end === 'number' && Number.isInteger(end) && end >= start
    ? null
    : `${at}.end_line must be an integer at or after start_line`;
}

function severityProblem(record: Record<string, unknown>, at: string): string | null {
  const severity = record['severity'];
  return typeof severity === 'string' && ENVELOPE_SEVERITIES.has(severity)
    ? null
    : `${at}.severity must be one of ${[...ENVELOPE_SEVERITIES].join('|')} — got ${JSON.stringify(severity)}`;
}

function categoryProblem(record: Record<string, unknown>, at: string): string | null {
  const category = record['category'];
  if (category === undefined || category === null) return null;
  return typeof category === 'string' && category.trim().length > 0
    ? null
    : `${at}.category must be a non-empty string when present`;
}

function parseEntry(value: unknown, index: number): DelegateFinding | string {
  const at = `findings[${String(index)}]`;
  const record = asRecord(value);
  if (record === null) return `${at} is not an object`;
  const problem =
    textProblem(record, 'path', at) ??
    textProblem(record, 'content', at) ??
    lineProblem(record, at) ??
    severityProblem(record, at) ??
    categoryProblem(record, at);
  if (problem !== null) return problem;
  const category = record['category'];
  return {
    filePath: (record['path'] as string).trim(),
    line: record['start_line'] as number,
    ruleId: typeof category === 'string' ? category : null,
    severity: severityFor(record['severity']),
    message: (record['content'] as string).trim(),
    attribution: 'ocr-delegate'
  };
}

/** Validate the envelope. Pure: no filesystem, so every refusal is unit-testable. */
export function parseEnvelope(text: string): EnvelopeResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, message: 'envelope is not JSON' };
  }
  const record = asRecord(raw);
  if (record === null) return { ok: false, message: 'envelope is not a JSON object' };
  const version = record['schema_version'];
  if (version !== '1') {
    return { ok: false, message: 'envelope.schema_version must be the string "1"' };
  }
  const packet = record['packet'];
  if (typeof packet !== 'string' || packet.trim().length === 0) {
    return { ok: false, message: 'envelope.packet must name the packet the findings belong to' };
  }
  const entries = record['findings'];
  if (!Array.isArray(entries)) {
    return { ok: false, message: 'envelope.findings must be an array (use [] for a clean review)' };
  }
  const findings: DelegateFinding[] = [];
  for (const [index, entry] of entries.entries()) {
    const finding = parseEntry(entry, index);
    if (typeof finding === 'string') return { ok: false, message: finding };
    findings.push(finding);
  }
  return { ok: true, packet, findings };
}

type PacketFacts = { readonly rid: string; readonly session: string; readonly state: string };

function readPacket(packetPath: string): PacketFacts | string {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(packetPath, 'utf8')) as unknown;
  } catch {
    return `packet is not readable JSON: ${packetPath}`;
  }
  const record = asRecord(raw);
  if (record === null) return `packet is not a JSON object: ${packetPath}`;
  if (record['schema_version'] !== '1' || record['mode'] !== 'delegate') {
    return `not a delegation packet (schema_version 1, mode delegate): ${packetPath}`;
  }
  const state = record['state'];
  if (typeof state !== 'string' || !PACKET_STATES.has(state)) {
    return `packet has no recognised state: ${packetPath}`;
  }
  const rid = record['rid'];
  const session = record['session'];
  if (typeof rid !== 'string' || typeof session !== 'string') {
    return `packet is missing rid/session: ${packetPath}`;
  }
  // A packet is a phase-1 document. A findings ARRAY here means the file is a
  // findings document, not a packet; an omitted key is not a claim about findings.
  if (Array.isArray(record['findings'])) {
    return `packet carries findings; it is not a phase-1 packet: ${packetPath}`;
  }
  return { rid, session, state };
}

function absoluteFrom(projectRoot: string, value: string): string {
  return isAbsolute(value) ? resolve(value) : resolve(projectRoot, value);
}

function summaryOf(findings: readonly DelegateFinding[]): Ocr18Summary {
  const counts = { ...emptyByLanguage() };
  for (const finding of findings) {
    const language = languageForPath(finding.filePath);
    if (language !== null) counts[language] += 1;
  }
  return summarize(findings, counts);
}

export type RecordRefusalCode = 'ENVELOPE_INVALID' | 'PACKET_INVALID' | 'PACKET_MISMATCH';

export type RecordDelegateOptions = {
  readonly projectRoot: string;
  readonly packetPath: string;
  readonly envelopeText: string;
};

export type RecordDelegateResult =
  | {
      readonly ok: true;
      readonly document: DelegateFindingsDocument;
      readonly findingsPath: string;
      readonly replaced: boolean;
    }
  | { readonly ok: false; readonly code: RecordRefusalCode; readonly message: string };

type PacketRefusal = { readonly code: RecordRefusalCode; readonly message: string };

type Binding = { readonly packetPath: string; readonly packet: PacketFacts };

/** The packet is the other half of the binding: it must exist, be this file, and await a review. */
function bindPacket(
  projectRoot: string,
  packetPath: string,
  declared: string
): Binding | PacketRefusal {
  if (!existsSync(projectRoot)) {
    return { code: 'PACKET_INVALID', message: `project root does not exist: ${projectRoot}` };
  }
  if (!pathsEqual(packetPath, declared)) {
    return {
      code: 'PACKET_MISMATCH',
      message: `envelope names ${declared}, which is not the packet given (${packetPath})`
    };
  }
  if (!existsSync(packetPath)) {
    return { code: 'PACKET_INVALID', message: `packet does not exist: ${packetPath}` };
  }
  if (!isInsidePath(stableRealPath(packetPath), stableRealPath(projectRoot))) {
    return { code: 'PACKET_INVALID', message: `packet is outside the project root: ${packetPath}` };
  }
  const packet = readPacket(packetPath);
  if (typeof packet === 'string') return { code: 'PACKET_INVALID', message: packet };
  if (packet.state !== 'awaiting-envelope') {
    return {
      code: 'PACKET_INVALID',
      message: `packet state is ${packet.state}: there was no delegated review to record`
    };
  }
  return { packetPath, packet };
}

export function recordDelegateFindings(options: RecordDelegateOptions): RecordDelegateResult {
  const envelope = parseEnvelope(options.envelopeText);
  if (!envelope.ok) return { ok: false, code: 'ENVELOPE_INVALID', message: envelope.message };

  const bound = bindPacket(
    options.projectRoot,
    absoluteFrom(options.projectRoot, options.packetPath),
    absoluteFrom(options.projectRoot, envelope.packet)
  );
  if ('code' in bound) return { ok: false, ...bound };

  const findingsPath = join(
    dirname(bound.packetPath),
    `${basename(bound.packetPath).replace(/\.json$/i, '')}.findings.json`
  );
  const document: DelegateFindingsDocument = {
    schema_version: '1',
    mode: 'delegate',
    state: 'recorded',
    attribution: 'ocr-delegate',
    rid: bound.packet.rid,
    session: bound.packet.session,
    packet: bound.packetPath,
    findings: envelope.findings,
    summary: summaryOf(envelope.findings)
  };
  const replaced = existsSync(findingsPath);
  mkdirSync(dirname(findingsPath), { recursive: true });
  writeFileSync(findingsPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  return { ok: true, document, findingsPath, replaced };
}
