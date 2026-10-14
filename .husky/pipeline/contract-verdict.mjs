/**
 * The artifact-contract leg's DECISION PATH, split out from the entry
 * (`.husky/peaks-gate-pipeline.mjs`) for the reason `.husky/gate/*.mjs` exists:
 * a gate that outgrew the 300-line hooks cap keeps its enforcement in one file
 * and its reasoning in a sibling, so the cap is never satisfied by deleting the
 * reasoning. Nothing here imports `src/**` or spawns anything —
 * `decidePipelineVerdict` is a pure function over a verdict list, which is what
 * lets `tests/unit/hooks/pipeline-contract-gate.test.ts` pin every branch of the
 * refusal without constructing a project tree for each one.
 *
 * PLAIN `.mjs`, ON PURPOSE, AND THE TEST PAYS FOR IT. This file and the entry
 * that imports it must load under bare `node`: that is what makes "the checker
 * cannot run" a REFUSAL WITH A REASON (the `src/**` import inside `loadPeaks()`
 * fails and the leg says so) rather than a module-resolution stack trace thrown
 * before any of this code runs. A `.ts` here would move the failure one level
 * up, into the entry's own static import, and the commit would be refused by a
 * crash instead of by a message a human can act on. The test therefore imports
 * this module through a computed specifier with a locally declared shape
 * (`allowJs` is off, so a static import would be an untyped TS7016 and would
 * take the repo's zero-error tsc ceiling with it).
 *
 * The two contracts this module exists to hold, restated where they are
 * implemented rather than only where they are called:
 *
 *   - A rid whose type is unreadable is judged by the checker's OWN default
 *     (`feature`, the heaviest prerequisite table) instead of being forwarded.
 *     The branch is defence in depth rather than a difference TODAY: the checker
 *     coerces an unrecognised type to `feature` itself, and an unknown key would
 *     THROW in `getPrerequisitesFor` rather than pass silently.
 *   - The exemption names every rid it skipped, and the scope it read them
 *     from. `decidePipelineVerdict` is where that is guaranteed, so no caller
 *     can render an exemption that does not say what it skipped.
 *   - A request is identified by its ARTIFACT, never by a filename prefix: the id
 *     is the one the artifact service reads off a filename, and the file has to be
 *     the document that request is. `ridFromCarrier` is the one predicate.
 *   - A requests directory that exists and cannot be listed is a checker
 *     FAILURE, not an absence of requests (`collectRids` reports it).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The opt-in token. It is the only env var this leg reads. */
export const SKIP_TOKEN_ENV = 'PEAKS_SKIP_PIPELINE_VERIFY';

/** Carrier locations in PREFERENCE ORDER: enumeration walks all three, and the
 *  `- type:` line is read from the first one that has the rid. */
export const CARRIER_DIRS = ['rd/requests', 'prd/requests', 'qa/requests'];

/** A request artifact is a DOCUMENT: it opens a level-1 title. A dispatch prompt
 *  dumped into a requests dir is a FRAGMENT (it begins at `##`), and that is what
 *  tells a request from a file that is merely shaped like one. */
const H1_TITLE = /^#[ \t]+\S/m;
/** A metadata line: a bullet, or a `**Field:** value` line. Prompts and reports
 *  name the request they belong to on one of these; prose does not. */
const METADATA_LINE = /^[ \t]*(?:[-*]{1,2})/;
/** A `request: <id>` field on such a line — `- request: \`x\``, a
 *  `- session: \`s\` · request: \`x\`` compound, or `**Request:** x`. */
const DECLARED_REQUEST =
  /(?:^|[^A-Za-z0-9])request\**\s*:\s*\**\s*`?([A-Za-z0-9][A-Za-z0-9._-]*)/gi;

/** The ids a document declares it belongs to. Empty when it declares none. */
function declaredRequests(markdown) {
  const found = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (!METADATA_LINE.test(line)) continue;
    for (const match of line.matchAll(DECLARED_REQUEST)) found.push(match[1]);
  }
  return found;
}
/** `- type: <t>` / `* type: <t>` as a whole line. Reads the value; coerces nothing. */
const TYPE_LINE = /^[-*]\s*type:\s*(\S+)\s*$/m;

/** An error's message, clipped: this text ends up on a commit line. */
export function messageOf(err) {
  return String(err && err.message ? err.message : err).slice(0, 200);
}

/** The opt-in token as it may be PRINTED: control characters replaced, clipped.
 *  The value is arbitrary environment input, and a newline in it would forge a
 *  line of this leg's own output. */
function printableToken(value) {
  return String(value)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '?')
    .slice(0, 40);
}

/**
 * The rid a carrier carries, or null when the file is not a request artifact.
 *
 * `deriveId` is the naming rule the caller composed out of `src/**` (the artifact
 * service's id pattern applied to the id its own filename rule reads back), handed
 * in because this module must load under bare `node` (see the header). The
 * predicate has three clauses, each one a defect repaired here:
 *
 *   1. the id comes from the service rather than a prefix spelled here, so a
 *      request whose filename carries no such prefix is still enumerated;
 *   2. the file must be a document (see `H1_TITLE`), so a fragment dropped into a
 *      requests dir cannot become a rid whose evidence no action can ever produce;
 *   3. a document that declares a request and declares only SOMEONE ELSE'S is a
 *      prompt for, or a report about, that request — not a request of its own.
 *      A document that declares its own id, or declares nothing, keeps its rid,
 *      so this clause can never drop an artifact that speaks for itself.
 */
export function ridFromCarrier(name, markdown, deriveId) {
  const rid = deriveId(name);
  if (rid === null) return null;
  if (!H1_TITLE.test(markdown)) return null;
  const declared = declaredRequests(markdown);
  if (declared.length > 0 && !declared.includes(rid)) return null;
  return rid;
}

/** The `- type:` value in a carrier's text, or null when the line is absent. */
export function parseTypeLine(markdown) {
  const match = TYPE_LINE.exec(markdown);
  return match === null ? null : (match[1] ?? null);
}

/**
 * `{ carriers, failures }` for a session dir: rid → `{rank, path}` for every rid
 * with a request artifact there, plus every carrier directory — and every carrier
 * file — that could not be read. A directory that does not exist holds no request:
 * a session with only rd artifacts has no `prd/requests/`, and that is not a gap. A
 * directory that EXISTS and cannot be listed is a checker failure, and the caller
 * refuses on it rather than reading it as "no requests" — the direction every other
 * "the detector did not run" branch here takes.
 */
export function collectRids(sessionDir, deriveId) {
  const found = new Map();
  const failures = [];
  for (const [rank, dir] of CARRIER_DIRS.entries()) {
    const abs = join(sessionDir, dir);
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch (err) {
      if (err && err.code === 'ENOENT') continue;
      failures.push(`${dir}: ${messageOf(err)}`);
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const path = join(abs, entry.name);
      let markdown;
      try {
        markdown = readFileSync(path, 'utf8');
      } catch (err) {
        failures.push(`${dir}/${entry.name}: ${messageOf(err)}`);
        continue;
      }
      const rid = ridFromCarrier(entry.name, markdown, deriveId);
      if (rid === null) continue;
      const prior = found.get(rid);
      if (prior === undefined || rank < prior.rank) found.set(rid, { rank, path });
    }
  }
  return {
    carriers: new Map([...found.entries()].sort(([a], [b]) => (a < b ? -1 : 1))),
    failures
  };
}

/**
 * The session's rid scope. A missing binding is a scope, not an error: it is
 * reported by name, and what to do about it is `decidePipelineVerdict`'s call.
 *
 * `getSessionDir` is the repo's own resolver, passed in for the same reason as
 * `deriveId`: it refuses a session id that is not a single path segment, and a
 * binding that fails it is a checker failure — enumerated-and-judged outside the
 * project root is the outcome that resolver exists to prevent, so it must not
 * degrade into "no rid to verify".
 */
export function enumerateScope(projectRoot, getSessionIdCanonical, getSessionDir, deriveId) {
  // `sessionId: null` marks a scope that was never RESOLVED: the unresolved
  // postures below carry an empty `failures` too, so emptiness cannot tell.
  const empty = { carriers: new Map(), failures: [], note: '', sessionId: null };
  let sessionId;
  try {
    sessionId = getSessionIdCanonical(projectRoot);
  } catch (err) {
    return { ...empty, note: `session resolution threw (${messageOf(err)})` };
  }
  if (sessionId === null) {
    return {
      ...empty,
      note: 'no peaks session binding (.peaks/_runtime/session.json absent or unreadable)'
    };
  }
  let sessionDir;
  try {
    sessionDir = getSessionDir(projectRoot, sessionId);
  } catch (err) {
    return {
      ...empty,
      note: `session binding refused (${messageOf(err)})`,
      failures: [`the session binding names an unusable session id (${messageOf(err)})`]
    };
  }
  const { carriers, failures } = collectRids(sessionDir, deriveId);
  const note = `session ${sessionId}; ${carriers.size} rid(s) under ${CARRIER_DIRS.join(', ')}`;
  return { carriers, failures, note, sessionId };
}

/** The per-rid type: the carrier's `- type:` value when it IS a request type,
 *  otherwise no type at all (the checker's `feature` default applies) — plus a
 *  note when the value was present but unusable, so the fallback stays visible. */
export function resolveRidType(carrierPath, isRequestType) {
  let text;
  try {
    text = readFileSync(carrierPath, 'utf8');
  } catch {
    return { type: undefined, note: null };
  }
  const declared = parseTypeLine(text);
  if (declared === null) return { type: undefined, note: null };
  if (isRequestType(declared)) return { type: declared, note: null };
  const note = `the carrier declares type "${declared}", which is not a request type;`;
  return { type: undefined, note: `${note} the checker's fail-closed default applies` };
}

/**
 * THE FACTORED DECISION POINT — pure. No filesystem, no spawn, no clock.
 *
 * `rids` is what the scope enumeration found (what an exemption would skip).
 * `results` is one entry per rid the checker was asked about:
 *   `{ rid, type, complete, violations }` — a verdict, or
 *   `{ rid, error }`                      — the checker did not answer for it.
 * A `note` on any entry (an unusable `- type:` value, say) is printed in every
 * branch, because a fallback nobody can see is a silent decision. `scopeNote`
 * is the human description of what was enumerated, printed in every branch so
 * that a green line says WHICH scope was green.
 *
 * `redirect` (optional) is `.husky/pipeline/session-redirect.mjs`'s sentence for a
 * verified scope that is NOT the bound session's. Printed on the REFUSAL path only
 * — the pass path already carries it inside `scopeNote` — so a refusal says which
 * session it refused, not the bound session's empty scope. Absent: nothing changes.
 *
 * Returns `{ exitCode, lines }`. The caller prints `lines`; it decides nothing.
 */
export function decidePipelineVerdict({ rids, results, skipToken, scopeNote, redirect = null }) {
  const exemptionOn =
    skipToken !== null && skipToken !== undefined && skipToken !== '' && skipToken !== '0';
  if (exemptionOn) {
    return {
      exitCode: 0,
      lines: [
        `peaks-gate-pipeline: EXEMPTION ACTIVE — ${SKIP_TOKEN_ENV}=${printableToken(skipToken)}.`,
        `  The artifact contract was NOT checked. Skipped rid(s) (${rids.length}): ${rids.length === 0 ? 'none' : rids.join(', ')}`,
        `  Scope read: ${scopeNote}`,
        '  KNOWN COST: this token leaves no trace in git history, so this commit is indistinguishable',
        '  from one that passed the check. The auditable alternative — a named literal in the commit',
        '  subject, which needs a commit-msg hook because pre-commit runs before the message exists —',
        '  is recorded and NOT done.'
      ]
    };
  }
  const lines = results
    .filter((r) => typeof r.note === 'string')
    .map((r) => `peaks-gate-pipeline: ${r.rid}: ${r.note}`);
  const broken = results.filter((r) => typeof r.error === 'string');
  const failed = results.filter((r) => typeof r.error !== 'string' && r.complete !== true);
  for (const r of broken) {
    lines.push(
      `peaks-gate-pipeline: the artifact-contract checker DID NOT RUN for ${r.rid} — ${r.error}`
    );
  }
  if (broken.length > 0) {
    lines.push(
      '  A detector that cannot run is a gate FAILURE, not a zero: the commit is refused, and nothing',
      '  here says the artifacts are clean.'
    );
  }
  for (const r of failed) {
    lines.push(
      `peaks-gate-pipeline: ${r.rid} (type ${r.type ?? 'default'}) fails the artifact contract:`
    );
    for (const violation of r.violations ?? []) lines.push(`  - ${violation}`);
  }
  if (broken.length === 0 && failed.length === 0) {
    lines.push(
      results.length === 0
        ? `peaks-gate-pipeline: no rid to verify — ${scopeNote}. Nothing was refused.`
        : `peaks-gate-pipeline: artifact contract satisfied for ${results.length} rid(s) — ${scopeNote}.`
    );
    return { exitCode: 0, lines };
  }
  // Only the refusal tail is reached: the pass branch returned above, so this
  // line cannot widen a passing commit's output for any scope.
  if (typeof redirect === 'string' && redirect !== '') {
    lines.push(`peaks-gate-pipeline: SCOPE — ${redirect}`);
  }
  lines.push(
    `peaks-gate-pipeline: ${failed.length} rid(s) short of the contract, ${broken.length} unreadable — ` +
      "run `peaks workflow verify-pipeline --rid <rid> --json` for the checker's own next actions."
  );
  return { exitCode: 1, lines };
}
