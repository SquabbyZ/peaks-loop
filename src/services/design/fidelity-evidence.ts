/**
 * The fidelity artifact pair: `<route-slug>.md` and `<route-slug>.json` under
 * `.peaks/_runtime/<sessionId>/design/fidelity/`.
 *
 * The markdown is the gate-readable half and is written LAST, so a partial
 * write never leaves a readable pass behind. `sha256` covers the result exactly
 * as the oracle returned it; a consumer can recompute it from the result
 * portion of the JSON. Caller-controlled values are neutralised before they
 * reach the markdown, because the later gate reads the verdict marker as a
 * whole-body substring.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { repoRelativeKey } from '../../shared/path-utils.js';
import { getSessionDir, isSinglePathSegment } from '../session/getSessionDir.js';
import { routeSlug } from './design-check-g3.js';
import type {
  FidelityFailure,
  FidelityPrototype,
  FidelityResult,
  ViewportScore
} from './layout/fidelity-model.js';

export type FidelityEvidenceMeta = {
  sessionId: string;
  generatedAt: string;
  sha256: string;
};

export type WriteFidelityEvidenceInput = {
  projectRoot: string;
  sessionId: string;
  result: FidelityResult;
  now?: () => Date;
};

export type WrittenFidelityEvidence = {
  markdownPath: string;
  jsonPath: string;
  sha256: string;
};

/** The refusal for a session id that is not one path segment. */
export class FidelityEvidencePathError extends Error {
  readonly code = 'DESIGN_FIDELITY_PATH_INVALID';

  constructor(value: string) {
    super(`The fidelity evidence session id must be a single path segment: ${value}`);
    this.name = 'FidelityEvidencePathError';
  }
}

export function sha256Hex(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function fidelityDir(projectRoot: string, sessionId: string): string {
  return join(getSessionDir(projectRoot, sessionId), 'design', 'fidelity');
}

export function fidelityMarkdownPath(
  projectRoot: string,
  sessionId: string,
  route: string
): string {
  return join(fidelityDir(projectRoot, sessionId), `${routeSlug(route)}.md`);
}

export function fidelityJsonPath(projectRoot: string, sessionId: string, route: string): string {
  return join(fidelityDir(projectRoot, sessionId), `${routeSlug(route)}.json`);
}

/**
 * What an earlier run recorded for this route: its prototype binding, `null`
 * when no usable record exists (a first run, or a run with no prototype), or
 * the named reason a record exists but cannot be believed.
 */
export type PriorPrototypeSha = { ok: true; sha256: string | null } | { ok: false; reason: string };

/** The errno code of a failed filesystem call, for a reason that names no path. */
function fsErrorCode(error: unknown): string {
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : 'unknown error';
}

/** The prototype sha256 an earlier run recorded for this route, or why there is none. */
export async function readPriorPrototypeSha(
  projectRoot: string,
  sessionId: string,
  route: string
): Promise<PriorPrototypeSha> {
  let text: string;
  try {
    text = await readFile(fidelityJsonPath(projectRoot, sessionId, route), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, sha256: null };
    return { ok: false, reason: `prior record unreadable (${fsErrorCode(error)})` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'prior record is not valid JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null) return { ok: true, sha256: null };
  const prototype = (parsed as { prototype?: unknown }).prototype;
  if (typeof prototype !== 'object' || prototype === null) return { ok: true, sha256: null };
  const sha256 = (prototype as { sha256?: unknown }).sha256;
  return { ok: true, sha256: typeof sha256 === 'string' && sha256 !== '' ? sha256 : null };
}

/** Neutralise a caller-controlled value before it reaches the gate-read text. */
function neutralize(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/design-fidelity:/gi, 'design-fidelity_');
}

function prototypeLine(prototype: FidelityPrototype | null): string {
  if (prototype === null) return 'prototype: (none)';
  const served = prototype.served === null ? '' : ` served=${prototype.served.url} loopback=true`;
  return `prototype: ${prototype.kind} ${neutralize(prototype.ref)} sha256=${prototype.sha256}${served}`;
}

function viewportLine(score: ViewportScore): string {
  return (
    `- ${score.viewport}: ${score.verdict} score=${String(score.score)} ` +
    `anchor=${String(score.anchorScore)} token=${String(score.tokenScore)} ` +
    `role=${String(score.roleScore)} paired=${String(score.paired)} ` +
    `missing=${String(score.missing)} extra=${String(score.extra)} ` +
    `duplicate=${String(score.duplicate)}`
  );
}

function failureLine(failure: FidelityFailure): string {
  return (
    `- ${failure.viewport} ${failure.failureClass} ${neutralize(failure.objectId)} ` +
    `${neutralize(failure.property)} expected=${neutralize(failure.expected)} ` +
    `actual=${neutralize(failure.actual)}`
  );
}

function linesOf(items: readonly FidelityFailure[]): string[] {
  return items.length === 0 ? ['- (none)'] : items.map(failureLine);
}

/** The literal markdown a later prerequisite reads its markers from. */
export function renderFidelityMarkdown(result: FidelityResult, meta: FidelityEvidenceMeta): string {
  return [
    `schemaVersion: ${String(result.schemaVersion)}`,
    `route: ${neutralize(result.route)}`,
    `session: ${neutralize(meta.sessionId)}`,
    `generatedAt: ${meta.generatedAt}`,
    `sha256: ${meta.sha256}`,
    `mode: ${result.mode}`,
    prototypeLine(result.prototype),
    '## Fidelity',
    `design-fidelity: ${result.verdict}`,
    `reason: ${result.reason === null ? '(none)' : neutralize(result.reason)}`,
    '',
    '## Viewports',
    ...(result.viewports.length === 0 ? ['- (none)'] : result.viewports.map(viewportLine)),
    '',
    '## Failures',
    ...linesOf(result.failures),
    '',
    '## Role observations',
    ...linesOf(result.roleMismatches),
    ''
  ].join('\n');
}

/**
 * Write one fidelity artifact pair. Both the session id and the derived route
 * slug stay inside the session's runtime directory; a refusal throws before any
 * directory is created.
 */
export async function writeFidelityEvidence(
  input: WriteFidelityEvidenceInput
): Promise<WrittenFidelityEvidence> {
  if (!isSinglePathSegment(input.sessionId)) throw new FidelityEvidencePathError(input.sessionId);
  const generatedAt = (input.now?.() ?? new Date()).toISOString();
  const sha256 = sha256Hex(JSON.stringify(input.result));
  const directory = fidelityDir(input.projectRoot, input.sessionId);
  const markdownPath = fidelityMarkdownPath(input.projectRoot, input.sessionId, input.result.route);
  const jsonPath = fidelityJsonPath(input.projectRoot, input.sessionId, input.result.route);
  const evidencePath = repoRelativeKey(markdownPath, input.projectRoot);
  const markdown = renderFidelityMarkdown(input.result, {
    sessionId: input.sessionId,
    generatedAt,
    sha256
  });
  const document = {
    ...input.result,
    session: input.sessionId,
    generatedAt,
    sha256,
    evidencePath
  };
  await mkdir(directory, { recursive: true });
  const written: string[] = [];
  try {
    await writeFile(jsonPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
    written.push(jsonPath);
    await writeFile(markdownPath, markdown, 'utf8');
    written.push(markdownPath);
  } catch (error) {
    await Promise.allSettled(written.map((path) => rm(path, { force: true })));
    throw error;
  }
  return { markdownPath, jsonPath, sha256 };
}
