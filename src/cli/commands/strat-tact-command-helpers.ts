/**
 * Helpers for the STRAT → TACT producer commands (backlog §16 / §9.2).
 *
 * Split out of `strat-tact-commands.ts` for the repo's 300-line source cap.
 * Pure orchestration helpers: refusal plumbing, the one-axis path guard, and
 * the artifact readers that re-verify a signed JSON document before trusting
 * it. The service layer stays the single implementation of both stages.
 */
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fail } from 'peaks-loop-shared/result';
import type { ProgramIO } from '../cli-helpers.js';
import { AstGateContextSchema, type AstGateContext } from '../../services/rd/ast-gate.js';
import { canonicalSha256 } from '../../services/rd/canonical-hash.js';
import {
  ImplOutputSchema,
  StrategyOutputSchema,
  type ImplOutput,
  type StrategyOutput
} from '../../services/rd/types.js';

const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const JSON_SUFFIX = '.json';

/** Short sig prefix shown in a mismatch message; the full digest stays in the artifact. */
const SIG_PREVIEW_LEN = 12;

export class CommandRefusal extends Error {
  constructor(
    readonly code: string,
    readonly remedy: string,
    message: string
  ) {
    super(message);
    this.name = 'CommandRefusal';
  }
}

export function emitOk(
  io: ProgramIO,
  json: boolean,
  payload: Record<string, unknown>,
  human: string[]
): void {
  if (json) {
    io.stdout(JSON.stringify({ ok: true, ...payload }));
    return;
  }
  io.stdout(human.join('\n'));
}

function refuse(io: ProgramIO, json: boolean, command: string, r: CommandRefusal): void {
  process.exitCode = 1;
  if (json) {
    io.stdout(JSON.stringify(fail(command, r.code, r.message, { remedy: r.remedy }, [r.remedy])));
    return;
  }
  io.stderr(`${r.code}: ${r.message} — ${r.remedy}\n`);
}

/** Run an action body, turning a named refusal into the CLI's error surface. */
export async function guarded(
  io: ProgramIO,
  json: boolean,
  command: string,
  body: () => Promise<void>
): Promise<void> {
  try {
    await body();
  } catch (err) {
    if (err instanceof CommandRefusal) {
      refuse(io, json, command, err);
      return;
    }
    throw err;
  }
}

/** Resolve `--out` and enforce the one-axis layout. */
export function requireSessionAxis(project: string, sessionId: string, out: string): string {
  if (!SESSION_ID_RE.test(sessionId)) {
    throw new CommandRefusal(
      'INVALID_SESSION_ID',
      'Use the session id that names .peaks/_runtime/<sid>/ (letters, digits, dot, dash, underscore).',
      `invalid --session-id: ${sessionId}`
    );
  }
  const sessionRoot = resolve(project, '.peaks', '_runtime', sessionId);
  const absolute = isAbsolute(out) ? resolve(out) : resolve(project, out);
  const rel = relative(sessionRoot, absolute);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new CommandRefusal(
      'ONE_AXIS_VIOLATION',
      `Pass --out .peaks/_runtime/${sessionId}/rd/<file>; artifacts are written only on the session axis.`,
      `--out must live under .peaks/_runtime/${sessionId}/ (got ${absolute})`
    );
  }
  return absolute;
}

async function readJsonFile(
  path: string,
  notFoundCode: string,
  invalidJsonCode: string,
  remedy: string
): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    throw new CommandRefusal(
      notFoundCode,
      remedy,
      `${path} could not be read: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new CommandRefusal(
      invalidJsonCode,
      remedy,
      `${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Recompute the digest over the RAW parsed JSON, before any schema strip.
 * Order matters: an unknown field added to a signed artifact must change the
 * digest (and therefore refuse), not be silently dropped by the schema.
 */
function assertArtifactDigest(
  raw: unknown,
  path: string,
  codes: { readonly invalid: string; readonly mismatch: string },
  remedy: string
): void {
  if (raw === null || typeof raw !== 'object') {
    throw new CommandRefusal(codes.invalid, remedy, `${path} is not a JSON object`);
  }
  const declared = (raw as { sha256?: unknown }).sha256;
  const recomputed = canonicalSha256(raw);
  if (declared !== recomputed) {
    throw new CommandRefusal(
      codes.mismatch,
      remedy,
      `sha256 mismatch at ${path} (declared=${String(declared).slice(0, SIG_PREVIEW_LEN)}… ` +
        `recomputed=${recomputed.slice(0, SIG_PREVIEW_LEN)}…)`
    );
  }
}

/** The markdown sibling is the human-readable anchor; both must carry the same sig. */
async function requireStrategyMarkdown(jsonPath: string, sha256: string): Promise<void> {
  const markdownPath = jsonPath.endsWith(JSON_SUFFIX)
    ? jsonPath.slice(0, -JSON_SUFFIX.length)
    : jsonPath;
  let markdown: string;
  try {
    markdown = await readFile(markdownPath, 'utf8');
  } catch (err) {
    throw new CommandRefusal(
      'STRATEGY_MARKDOWN_NOT_FOUND',
      'Re-run peaks strat write; it writes strategy.md next to the <out>.json sibling.',
      `strategy markdown not found at ${markdownPath} (${
        err instanceof Error ? err.message : String(err)
      })`
    );
  }
  const declared = /STRAT\.sig:\s*([a-f0-9]{64})/.exec(markdown)?.[1];
  if (declared !== sha256) {
    throw new CommandRefusal(
      'STRATEGY_SIG_MISMATCH',
      `Re-run peaks strat write to regenerate both the markdown and its JSON sibling (${jsonPath}).`,
      `strategy markdown signature at ${markdownPath} is ${declared ?? '<missing>'} but the JSON ` +
        `declares ${sha256.slice(0, SIG_PREVIEW_LEN)}…`
    );
  }
}

export async function readStrategy(path: string): Promise<StrategyOutput> {
  const remedy = 'Re-run peaks strat write; --strategy expects the JSON sibling it wrote.';
  const raw = await readJsonFile(path, 'STRATEGY_NOT_FOUND', 'INVALID_STRATEGY_JSON', remedy);
  assertArtifactDigest(
    raw,
    path,
    { invalid: 'INVALID_STRATEGY', mismatch: 'STRAT_SIG_MISMATCH' },
    remedy
  );
  const parsed = StrategyOutputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new CommandRefusal(
      'INVALID_STRATEGY',
      remedy,
      `${path} does not match StrategyOutput: ${parsed.error.message}`
    );
  }
  await requireStrategyMarkdown(path, parsed.data.sha256);
  return parsed.data;
}

export async function readImpl(path: string): Promise<ImplOutput> {
  const remedy = 'Re-run peaks tact write; --artifact expects the impl.json it wrote.';
  const raw = await readJsonFile(path, 'IMPL_NOT_FOUND', 'INVALID_IMPL_JSON', remedy);
  assertArtifactDigest(
    raw,
    path,
    { invalid: 'INVALID_IMPL', mismatch: 'IMPL_SIG_MISMATCH' },
    remedy
  );
  const parsed = ImplOutputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new CommandRefusal(
      'INVALID_IMPL',
      remedy,
      `${path} does not match ImplOutput: ${parsed.error.message}`
    );
  }
  return parsed.data;
}

export function parseAstContext(raw: string | undefined): AstGateContext {
  if (raw === undefined) {
    return { deps: {}, docSummaries: [] };
  }
  const remedy =
    'Pass --ast-context as JSON matching { deps, docSummaries }, or omit it for the empty context.';
  const parsed = AstGateContextSchema.safeParse(
    readJsonOrRefuse(raw, 'INVALID_AST_CONTEXT', remedy, '--ast-context')
  );
  if (!parsed.success) {
    throw new CommandRefusal(
      'INVALID_AST_CONTEXT',
      remedy,
      `--ast-context does not match AstGateContext: ${parsed.error.message}`
    );
  }
  return parsed.data;
}

function readJsonOrRefuse(raw: string, code: string, remedy: string, path: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new CommandRefusal(
      code,
      remedy,
      `${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
