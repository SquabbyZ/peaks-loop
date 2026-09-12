/**
 * S1 / rid=api-diff-report — the three RECORDED sources for `peaks scan api-diff`,
 * plus the candidate name-grep.
 *
 *   1. `.peaks/_runtime/<sid>/rd/mock-plan.md`  (most recent by mtime)
 *   2. recorded `*-api.types.ts` interfaces     (from (1) + `src/services/types`)
 *   3. the `## API Migration` endpoint list in `.peaks/_runtime/<sid>/txt/*.md`
 *
 * All three are OPTIONAL: absence is reported in the report's `notes`, never
 * silently. `typescript` is a devDependency and is NOT available at runtime, so
 * recorded interfaces are read by the line-based extractor below — its limits
 * are documented on the function and exercised by tests.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  toDisplayPath,
  type CandidateMention,
  type DocOperation,
  type InterfaceRole,
  type Method,
  type RecordedEndpoint,
  type RecordedInterface
} from './api-diff-types.js';

export const MAX_CANDIDATE_NAMES = 100;
const MAX_HITS_PER_NAME = 5;
const MAX_SCAN_FILE_BYTES = 2 * 1024 * 1024;
const SCAN_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.json', '.html'];
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.output',
  '.peaks', '.turbo', '.cache', '__pycache__'
]);

// ---------------------------------------------------------------------------
// Recorded interface extraction (NO TypeScript compiler)
// ---------------------------------------------------------------------------

/** Removes `//` and block comments while preserving string literals. Regex literals are NOT modelled (documented limit). */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  let inString: string | null = null;
  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1];
    if (inString !== null) {
      if (ch === '\\') {
        out += ch + (next ?? '');
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Brace balance, counting neither braces inside string literals nor escapes.
 * Without the string-literal awareness a member like `tpl: '{';` pushed the
 * depth to 2, hid every later member, and swallowed every later interface in
 * the file. Multi-line template literals are tracked across lines.
 *
 * LIMIT: a regex literal containing a brace is still mis-counted; recorded
 * `*-api.types.ts` interfaces do not contain regex literals in practice.
 */
function braceBalance(text: string): number {
  let delta = 0;
  let inString: string | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inString !== null) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '{') delta += 1;
    else if (ch === '}') delta -= 1;
  }
  return delta;
}

const DECLARATION = /^\s*(?:export\s+)?(?:declare\s+)?(?:interface|type)\s+([A-Za-z_$][\w$]*)\s*(?:<[^{>]*>)?\s*(?:=\s*)?(?:(extends)\s+[^{]+)?\{/;
/**
 * The fail-safe, anchored on the DECLARATION KEYWORD rather than on the shape
 * of what follows. `<[^{>}]*>` cannot span a nested generic, so
 * `interface X<T extends Record<string, unknown>> {` matched nothing at all and
 * was dropped in total silence — no interface, no suppression, no note. A
 * declaration we cannot read must still be RECORDED as incomplete.
 */
const DECLARATION_KEYWORD = /^\s*(?:export\s+)?(?:declare\s+)?(?:interface|type)\s+([A-Za-z_$][\w$]*)/;
const MEMBER = /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*(\??)\s*:\s*(.+?)\s*;?\s*$/;

/**
 * Top-level skeleton of a type text: string literals blanked, bracketed
 * sub-terms collapsed, bracket depth tracked. What remains is the part of the
 * text that sits at depth 0 — where a stray member separator can only have come
 * from a SECOND member the line-based reader swallowed into the type.
 */
function typeSkeleton(typeText: string): string {
  let out = '';
  let inString: string | null = null;
  let depth = 0;
  for (let i = 0; i < typeText.length; i += 1) {
    const ch = typeText[i]!;
    if (inString !== null) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '<' || ch === '(' || ch === '[' || ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === '>' || ch === ')' || ch === ']' || ch === '}') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) out += ch;
  }
  return out;
}

/**
 * True when a captured member type absorbed a second member.
 *
 * `MEMBER` anchors its type capture to `$`, so `id: string; name: string;` on
 * one line was classified cleanly with type `string; name: string` — the member
 * `name` vanished, the type was garbage, and nothing was reported. A member
 * line counts only if it is FULLY consumed: no top-level `;`, and no second
 * `identifier:` at depth 0. A function type like `(a: string) => void` keeps its
 * colon inside parentheses, so it is not flagged.
 */
function absorbedExtraMember(typeText: string): boolean {
  const skeleton = typeSkeleton(typeText);
  if (skeleton.includes(';')) return true;
  return /[A-Za-z_$][\w$]*\s*\??\s*:/.test(skeleton);
}

/** True when a type text contains an object literal opener OUTSIDE a string literal (`Array<{ a: string }>` counts; `'{'` does not). */
function hasInlineObject(typeText: string): boolean {
  let inString: string | null = null;
  for (let i = 0; i < typeText.length; i += 1) {
    const ch = typeText[i]!;
    if (inString !== null) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '{') return true;
  }
  return false;
}

function truncate(text: string, max = 40): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/**
 * Line-based extractor for recorded `*-api.types.ts` interfaces.
 *
 * INVERTED DEFAULT (QA round 2): a line-based reader cannot tell "this line is
 * not a member" from "I failed to read this member", so the model is not
 * "exact unless I found a reason to suppress". It is the opposite — **an
 * interface is COMPLETE only while every depth-1 line in its body is
 * classified**. The first line the extractor cannot classify makes the whole
 * interface INCOMPLETE, which suppresses every exact line for it and emits one
 * note naming it and the reason.
 *
 * That is what catches, without needing to enumerate them in advance: quoted
 * keys, index signatures, multi-line unions (the continuation line is the
 * unclassifiable one), intersections and mapped types (which never reach a body
 * at all — see `DECLARATION_LIKE`), and nested inline objects.
 *
 * KNOWN LIMITS, stated rather than papered over:
 *   - members are matched at depth 1 only; a nested shape is `object` and makes
 *     the interface incomplete rather than being half-read;
 *   - `extends` is unresolvable without a compiler, so such an interface is
 *     incomplete by construction;
 *   - a regex literal containing a brace would still mis-count (`braceBalance`).
 */
export function parseRecordedInterfaces(source: string, file: string): RecordedInterface[] {
  const lines = stripComments(source).split(/\r?\n/);
  const fileBalanced = braceBalance(lines.join('\n')) === 0;
  const fileReason = fileBalanced ? null : 'the file has unbalanced braces, so its structure could not be read';
  const found: RecordedInterface[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const match = DECLARATION.exec(line);
    if (!match) {
      const keyword = DECLARATION_KEYWORD.exec(line);
      if (keyword) {
        // A declaration we cannot read must still be RECORDED as incomplete:
        // ignoring it silently produces no suppression, no note and no line.
        found.push({
          name: keyword[1]!,
          file,
          members: new Map(),
          incompleteReason: 'its declaration could not be fully parsed (a nested generic, an intersection, an alias, or a brace on a following line)'
        });
      }
      i += 1;
      continue;
    }

    const name = match[1]!;
    const members = new Map<string, string>();
    const reasons: string[] = [];
    if (match[2] !== undefined) {
      reasons.push('it extends a base type, whose inherited members cannot be resolved without a compiler');
    }

    let depth = braceBalance(line);
    if (depth === 0) {
      reasons.push('its body is written on a single line, which the line-based extractor cannot read');
      i += 1;
    } else {
      i += 1;
      while (i < lines.length && depth > 0) {
        const bodyLine = lines[i] ?? '';
        if (depth === 1) {
          const trimmed = bodyLine.trim();
          if (trimmed !== '' && !/^[};,]+$/.test(trimmed)) {
            const member = MEMBER.exec(bodyLine);
            if (member === null) {
              reasons.push(`it has a body line the extractor cannot classify (\`${truncate(trimmed)}\`), which may be a member it failed to read`);
            } else if (absorbedExtraMember(member[3]!)) {
              reasons.push(`it has a body line carrying more than one member (\`${truncate(trimmed)}\`), which the line-based extractor cannot split`);
            } else {
              const optional = member[2] === '?';
              const raw = member[3]!;
              if (hasInlineObject(raw)) {
                reasons.push('it has a nested inline object member, whose inner fields are not visible');
                members.set(member[1]!, optional ? 'object | undefined' : 'object');
              } else {
                members.set(member[1]!, optional ? `${raw} | undefined` : raw);
              }
            }
          }
        }
        depth += braceBalance(bodyLine);
        i += 1;
      }
      if (depth > 0) reasons.push('its body never closes, so the file structure collapsed');
    }

    found.push({
      name,
      file,
      members,
      incompleteReason: fileReason ?? (reasons.length > 0 ? reasons.join('; ') : null)
    });
  }
  return found;
}

// ---------------------------------------------------------------------------
// Interface role
// ---------------------------------------------------------------------------

/**
 * Which half of an operation an interface describes, from the suffix its name
 * carries. `unknown` is a refusal, not a default: diffing an interface against
 * a location it does not describe is how a request field got reported at a
 * response location, and how a response-shaped `*Dto` got reported at the
 * requestBody.
 *
 * Only suffixes that actually name a side are accepted. `Dto` names neither
 * side (a `UserDto` is as likely to be a response), and a bare `Body` does not
 * say which side it belongs to either — `GetThingResponseBody` ends in `Body`.
 * `...RequestBody` still classifies as a request via the `request` suffix. A
 * suffix that carries no information must not receive LESS caution than no
 * suffix at all, so both become `unknown` and are refused with a note.
 */
export function roleOf(name: string): InterfaceRole {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (key.endsWith('response')) return 'response';
  for (const suffix of ['request', 'payload']) {
    if (key.endsWith(suffix)) return 'request';
  }
  return 'unknown';
}

/** Locations of `operation` that `role` is allowed to describe. */
export function locationsForRole(operation: DocOperation, role: InterfaceRole): string[] {
  const keys = [...operation.locations.keys()];
  if (role === 'request') return keys.includes('request') ? ['request'] : [];
  if (role === 'response') return keys.filter((key) => key.startsWith('response.')).sort();
  return [];
}

// ---------------------------------------------------------------------------
// Source discovery
// ---------------------------------------------------------------------------

function listDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function listFiles(dir: string, suffix: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
      .map((entry) => join(dir, entry.name));
  } catch {
    return [];
  }
}

function mtimeOf(file: string): number {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return -1;
  }
}

function readTextOr(file: string, fallback: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return fallback;
  }
}

function newest(files: readonly string[]): string | null {
  let best: string | null = null;
  let bestMtime = -1;
  for (const file of files) {
    const mtime = mtimeOf(file);
    if (mtime > bestMtime) {
      bestMtime = mtime;
      best = file;
    }
  }
  return best;
}

/** Source 1: the most recent `.peaks/_runtime/<sid>/rd/mock-plan.md`. */
export function findMockPlan(projectRoot: string): string | null {
  const runtime = join(projectRoot, '.peaks', '_runtime');
  const candidates = listDirs(runtime)
    .map((sid) => join(runtime, sid, 'rd', 'mock-plan.md'))
    .filter((file) => mtimeOf(file) >= 0);
  return newest(candidates);
}

/** Pulls the file paths a mock plan records (backticked or whitespace-delimited). */
export function extractMockPlanPaths(source: string): string[] {
  const paths = new Set<string>();
  const pattern = /`([^`\s]+\.(?:ts|tsx|js|jsx))`|(?:^|[\s(])([\w./@-]+\.(?:ts|tsx|js|jsx))/gm;
  for (const match of source.matchAll(pattern)) {
    const value = match[1] ?? match[2];
    if (value !== undefined) paths.add(value);
  }
  return [...paths];
}

/** Source 2: recorded interface files — mock-plan-named plus the prescribed `src/services/types/*-api.types.ts` layout. */
export function findRecordedInterfaceFiles(projectRoot: string, mockPlan: string | null): string[] {
  const files = new Set<string>();
  if (mockPlan !== null) {
    for (const raw of extractMockPlanPaths(readTextOr(mockPlan, ''))) {
      if (!raw.endsWith('-api.types.ts')) continue;
      const absolute = resolve(projectRoot, raw);
      if (mtimeOf(absolute) >= 0) files.add(absolute);
    }
  }
  for (const file of listFiles(join(projectRoot, 'src', 'services', 'types'), '-api.types.ts')) files.add(file);
  return [...files].sort();
}

/** Source 3: the newest TXT handoff that actually carries an `## API Migration` section. */
export function findHandoffWithApiMigration(projectRoot: string): string | null {
  const runtime = join(projectRoot, '.peaks', '_runtime');
  const candidates: string[] = [];
  for (const sid of listDirs(runtime)) candidates.push(...listFiles(join(runtime, sid, 'txt'), '.md'));
  const withSection = candidates.filter((file) => /^##\s+API Migration\s*$/m.test(readTextOr(file, '')));
  return newest(withSection);
}

/** Parses the `## API Migration` body for `<METHOD> <path>` pairs. */
export function parseHandoffEndpoints(source: string): RecordedEndpoint[] {
  const heading = /^##\s+API Migration\s*$/m.exec(source);
  if (!heading) return [];
  const rest = source.slice(heading.index + heading[0].length);
  const nextHeading = /^##\s+/m.exec(rest);
  const body = nextHeading ? rest.slice(0, nextHeading.index) : rest;
  const seen = new Set<string>();
  const endpoints: RecordedEndpoint[] = [];
  const pattern = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/[^\s`)\]|,;]*)/gi;
  for (const match of body.matchAll(pattern)) {
    const method = match[1]!.toLowerCase() as Method;
    const path = match[2]!.replace(/[.,;:]+$/, '').replace(/\/+$/, '') || '/';
    const key = `${method} ${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    endpoints.push({ method, path });
  }
  return endpoints;
}

// ---------------------------------------------------------------------------
// Name pairing
// ---------------------------------------------------------------------------

/**
 * Key used to pair a document operation with a recorded interface. Deliberately
 * conservative: only lowercasing, punctuation removal, and one trailing
 * `Response`/`Request`/`Dto`/`Payload`/`Body` strip. Verb stripping (`getUser`
 * -> `user`) was considered and rejected — a false pairing produces a
 * confidently wrong diff, which is worse than the visible false negative of an
 * unpaired interface (design §2.3).
 */
export function pairingKey(name: string): string {
  let key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const suffix of ['response', 'request', 'payload', 'dto', 'body']) {
    if (key.length > suffix.length && key.endsWith(suffix)) {
      key = key.slice(0, -suffix.length);
      break;
    }
  }
  return key;
}

export function operationKey(operation: DocOperation): string {
  if (operation.operationId !== undefined) return pairingKey(operation.operationId);
  return pairingKey(`${operation.method}${operation.path.replace(/[{}]/g, '')}`);
}

// ---------------------------------------------------------------------------
// Candidate name-grep
// ---------------------------------------------------------------------------

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectScanFiles(root: string, out: string[], depth: number): void {
  if (depth > 12) return;
  for (const entry of (() => {
    try {
      return readdirSync(root, { withFileTypes: true });
    } catch {
      return [];
    }
  })()) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collectScanFiles(join(root, entry.name), out, depth + 1);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!SCAN_EXTENSIONS.some((ext) => entry.name.toLowerCase().endsWith(ext))) continue;
    const file = join(root, entry.name);
    let size = Number.MAX_SAFE_INTEGER;
    try {
      size = statSync(file).size;
    } catch {
      // Unreadable files are skipped by the size guard below, not by throwing.
    }
    if (size <= MAX_SCAN_FILE_BYTES) out.push(file);
  }
}

/**
 * Greps every candidate name across the consumer's source and non-TS assets.
 * Over-reports (test fixtures, unrelated identifiers) and under-reports (i18n
 * keys, AntD `columns` arrays, monorepo barrels) — the report says so.
 *
 * `exclude` carries the OpenAPI document itself: it is the input, not a change
 * site, and every field name would otherwise match on its own definition line.
 */
export function grepCandidateMentions(
  projectRoot: string,
  names: readonly string[],
  exclude: readonly string[] = []
): { mentions: CandidateMention[]; truncated: boolean; hitsTruncated: boolean } {
  const ordered = [...new Set(names)].sort((a, b) => b.length - a.length);
  const truncated = ordered.length > MAX_CANDIDATE_NAMES;
  const capped = ordered.slice(0, MAX_CANDIDATE_NAMES);
  let hitsTruncated = false;
  if (capped.length === 0) return { mentions: [], truncated: false, hitsTruncated: false };

  const skip = new Set(exclude.map((file) => resolve(file)));
  const hits = new Map<string, { file: string; line: number }[]>();
  const pattern = new RegExp(`\\b(${capped.map(escapeRegex).join('|')})\\b`, 'g');
  const files: string[] = [];
  collectScanFiles(projectRoot, files, 0);

  for (const file of files) {
    if (skip.has(resolve(file))) continue;
    const text = readTextOr(file, '');
    if (text === '') continue;
    const display = toDisplayPath(projectRoot, file);
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      pattern.lastIndex = 0;
      let match = pattern.exec(line);
      while (match !== null) {
        const name = match[1]!;
        const bucket = hits.get(name) ?? [];
        const lineNumber = index + 1;
        const already = bucket.some((hit) => hit.file === display && hit.line === lineNumber);
        if (!already) {
          if (bucket.length < MAX_HITS_PER_NAME) {
            bucket.push({ file: display, line: lineNumber });
            hits.set(name, bucket);
          } else {
            // A truncated list must say so, or it reads as the complete set.
            hitsTruncated = true;
          }
        }
        match = pattern.exec(line);
      }
    }
  }

  const mentions = capped
    .filter((name) => hits.has(name))
    .map((name) => ({ confidence: 'candidate' as const, name, hits: hits.get(name)! }));
  return { mentions, truncated, hitsTruncated };
}

/**
 * Canonical endpoint path for comparison: `{id}` and `:id` are the same
 * endpoint spelled two ways, and raw equality reported them as an exact
 * ADDED + REMOVED pair. Parameter NAMES are collapsed too — `/users/{id}` and
 * `/users/{userId}` are one endpoint.
 */
export function normalizeEndpointPath(path: string): string {
  const collapsed = path.replace(/\{[^/}]*\}/g, '{}').replace(/:[^/]+/g, '{}');
  return collapsed.replace(/\/+$/, '') || '/';
}
