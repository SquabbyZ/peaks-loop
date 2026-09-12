import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { isDirectory, readText } from 'peaks-loop-shared/fs';

import type {
  HookConventionReport,
  HookDirectoryConvention,
  HookObservation,
  HookReturnShape
} from './scan-types.js';

/**
 * Reads the CONTENTS of a consumer project's hook directories and reports the
 * OBSERVED convention: per exported function its name and return shape, per
 * directory the dominant naming pattern / return shape / mapper delegation,
 * and the deviations from those dominants.
 *
 * What this deliberately is NOT: a type-flow checker. "This hook consumes a
 * `*DTO` directly" is a property of a VALUE'S TYPE, not of its text — a regex
 * for it fires on the one legal mapper import and misses the real violation.
 * Every field below is therefore labelled observed, and anything the text
 * cannot answer is reported as null rather than guessed.
 *
 * Known limits of a text scan without a compiler: string literals and comments
 * are masked out first, so a commented-out hook is never counted; a return
 * whose shape is produced by a call or held in an identifier cannot be
 * classified; a generic parameter list with nested angle brackets is not
 * matched; `.vue`/`.tsx` script blocks are not read (the extension set matches
 * the existing hook sampler).
 */

export type HookConventionScanOptions = {
  projectRoot: string;
  /** Candidate hook directories relative to `projectRoot`, in report order. */
  hookDirs: string[];
};

/** Mirrors the extension set the existing-system hook sampler already uses. */
const HOOK_FILE_EXTS = /\.(ts|js)$/i;
const USE_PREFIX_RE = /^use[A-Z0-9_]/;
const MAPPER_PATH_RE = /mapper/i;
/** Keeps inconsistency strings short — the full list lives in `hooks[]`. */
const MAX_DEVIANTS_LISTED = 5;

/**
 * How many characters precede a declaration's parameter list, which decides
 * where its body starts:
 *  - `function`: the head ends after `function`/the name, params follow.
 *  - `paren`:    the head ends just past the params' opening `(`.
 *  - `wrapper`:  the head ends just past a `useX(` call's opening `(`; the
 *                hook body is the first argument's body.
 */
type DeclarationForm = 'function' | 'paren' | 'wrapper';

const EXPORTED_DECL_PATTERNS: { pattern: RegExp; form: DeclarationForm }[] = [
  { pattern: /export\s+default\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g, form: 'function' },
  { pattern: /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g, form: 'function' },
  {
    pattern: /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|(?:<[^<>]*>\s*)?\()/g,
    form: 'paren'
  },
  {
    pattern: /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?use[A-Z0-9_][\w$]*\s*\(/g,
    form: 'wrapper'
  }
];
const IMPORT_SPECIFIER_RE = /^([ \t]*)import\s+(?:[\s\S]{0,500}?\sfrom\s+)?['"]([^'"]+)['"]/gm;
const IDENTIFIER_RE = /[A-Za-z_$][\w$]*/y;

type ExportedDeclaration = {
  name: string;
  form: DeclarationForm;
  /** Index one past the matched declaration head. */
  headEnd: number;
  /** Index one past this declaration's region (the next declaration, or EOF). */
  limit: number;
};

type BodyLocation = { kind: 'block'; openBrace: number } | { kind: 'expression'; from: number };

type ClassifiedReturn = { shape: HookReturnShape; signature: string | null };

/** A hook file, with the file-level mapper observation that belongs to it. */
type HookFileReport = { file: string; importsMapper: boolean };

type DirectorySummary = { convention: HookDirectoryConvention; inconsistencies: string[] };

// ---------- text scanning ------------------------------------------------

function skipQuoted(text: string, start: number): number {
  const quote = text[start] ?? '';
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i] ?? '';
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    i += 1;
  }
  return text.length;
}

/**
 * If `i` begins a string literal or a comment, return the index just past it;
 * otherwise return `i` unchanged. Every scanner below uses this so braces and
 * `return` keywords inside strings/comments are never counted as code.
 */
function skipNonCode(text: string, i: number, limit: number): number {
  const ch = text[i] ?? '';
  if (ch === '"' || ch === "'" || ch === '`') return Math.min(skipQuoted(text, i), limit);
  if (ch !== '/') return i;
  if (text[i + 1] === '/') {
    const newline = text.indexOf('\n', i);
    return newline === -1 || newline >= limit ? limit : newline + 1;
  }
  if (text[i + 1] === '*') {
    const end = text.indexOf('*/', i);
    return end === -1 ? limit : Math.min(end + 2, limit);
  }
  return i;
}

/**
 * Blank out every string literal and comment, preserving length and line
 * breaks so all indices still address the original source. Declaration
 * discovery runs on the masked text, so a commented-out hook is not a hook.
 */
function maskNonCode(text: string): string {
  const chars = text.split('');
  let i = 0;
  while (i < text.length) {
    const next = skipNonCode(text, i, text.length);
    if (next !== i) {
      for (let j = i; j < next; j += 1) {
        if (chars[j] !== '\n') chars[j] = ' ';
      }
      i = next;
      continue;
    }
    i += 1;
  }
  return chars.join('');
}

function skipSpace(text: string, from: number, limit: number): number {
  let i = from;
  while (i < limit && /\s/.test(text[i] ?? '')) i += 1;
  return i;
}

function matchParen(text: string, open: number, limit: number): number {
  let depth = 0;
  let i = open;
  while (i < limit) {
    const nonCode = skipNonCode(text, i, limit);
    if (nonCode !== i) {
      i = nonCode;
      continue;
    }
    const ch = text[i] ?? '';
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

/** Index of the `{` opening a block body after a parameter list, or -1. */
function findBlockBody(text: string, from: number, limit: number): number {
  let i = skipSpace(text, from, limit);
  if (text[i] === ':') {
    // Return-type annotation: advance to the first `{`, `=>`, `;` or newline.
    let j = i + 1;
    while (j < limit && !'{=>;\n'.includes(text[j] ?? '')) j += 1;
    i = skipSpace(text, j, limit);
  }
  if (text.startsWith('=>', i)) i = skipSpace(text, i + 2, limit);
  return text[i] === '{' ? i : -1;
}

function isReturnAt(text: string, i: number): boolean {
  if (!text.startsWith('return', i)) return false;
  const before = text[i - 1] ?? ' ';
  const after = text[i + 6] ?? ' ';
  return !/[\w$]/.test(before) && !/[\w$]/.test(after);
}

/** Reads a JS expression from `from`, stopping at a depth-0 `;` or newline. */
function readExpression(text: string, from: number, limit: number): { text: string; next: number } {
  let depth = 0;
  let i = from;
  while (i < limit) {
    const nonCode = skipNonCode(text, i, limit);
    if (nonCode !== i) {
      i = nonCode;
      continue;
    }
    const ch = text[i] ?? '';
    if (ch === '{' || ch === '[' || ch === '(') {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === '}' || ch === ']' || ch === ')') {
      if (depth === 0) break;
      depth -= 1;
      i += 1;
      continue;
    }
    if (depth === 0 && (ch === ';' || ch === '\n')) break;
    i += 1;
  }
  return { text: text.slice(from, i), next: i };
}

/**
 * Raw text of every `return` written directly in the block opened by
 * `openBrace`. Returns nested inside an `if` / `switch` / `for` / callback
 * body sit at a deeper brace depth and are deliberately not collected: the
 * hook's own return is the one that describes its shape.
 */
function scanBlockBody(text: string, openBrace: number): string[] {
  const returns: string[] = [];
  const limit = text.length;
  let depth = 0;
  let i = openBrace;
  while (i < limit) {
    const nonCode = skipNonCode(text, i, limit);
    if (nonCode !== i) {
      i = nonCode;
      continue;
    }
    const ch = text[i] ?? '';
    if (ch === '{' || ch === '[' || ch === '(') {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === '}' || ch === ']' || ch === ')') {
      depth -= 1;
      if (depth === 0 && ch === '}') return returns;
      i += 1;
      continue;
    }
    if (depth === 1 && isReturnAt(text, i)) {
      const expression = readExpression(text, i + 'return'.length, limit);
      returns.push(expression.text);
      i = expression.next;
      continue;
    }
    i += 1;
  }
  return returns;
}

// ---------- return-shape classification -----------------------------------

function stripOuterParens(text: string): string {
  let current = text.trim();
  while (current.startsWith('(') && current.endsWith(')')) {
    if (matchParen(current, 0, current.length) !== current.length - 1) break;
    current = current.slice(1, -1).trim();
  }
  return current;
}

/** Sorted top-level key list of an object-literal expression, or null. */
function objectSignature(text: string): string | null {
  const keys: string[] = [];
  const limit = text.length;
  let depth = 0;
  let previous = '';
  let i = 0;
  while (i < limit) {
    const nonCode = skipNonCode(text, i, limit);
    if (nonCode !== i) {
      i = nonCode;
      previous = '"';
      continue;
    }
    const ch = text[i] ?? '';
    if (ch === '{' || ch === '[' || ch === '(') {
      depth += 1;
      previous = ch;
      i += 1;
      continue;
    }
    if (ch === '}' || ch === ']' || ch === ')') {
      depth -= 1;
      previous = ch;
      i += 1;
      continue;
    }
    if (depth === 1 && (previous === '{' || previous === ',')) {
      IDENTIFIER_RE.lastIndex = i;
      const key = IDENTIFIER_RE.exec(text);
      if (key !== null) {
        keys.push(key[0]);
        previous = key[0];
        i += key[0].length;
        continue;
      }
    }
    if (!/\s/.test(ch)) previous = ch;
    i += 1;
  }
  if (keys.length === 0) return null;
  return `{ ${[...new Set(keys)].sort().join(', ')} }`;
}

function classifyReturn(expression: string): ClassifiedReturn {
  const text = stripOuterParens(expression);
  if (text.startsWith('{')) return { shape: 'object', signature: objectSignature(text) };
  if (text.startsWith('[')) return { shape: 'tuple', signature: null };
  return { shape: 'other', signature: null };
}

function describeShape(shape: HookReturnShape, signature: string | null): string {
  if (shape === 'object') {
    return signature === null ? 'an object whose keys could not be read' : `an object ${signature}`;
  }
  if (shape === 'tuple') return 'a tuple';
  return 'no classifiable return expression';
}

// ---------- declaration discovery -----------------------------------------

function findExportedDeclarations(masked: string): ExportedDeclaration[] {
  const heads: { name: string; start: number; headEnd: number; form: DeclarationForm }[] = [];
  for (const entry of EXPORTED_DECL_PATTERNS) {
    entry.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = entry.pattern.exec(masked)) !== null) {
      const name = match[1];
      if (name !== undefined) {
        const raw = match[0];
        heads.push({
          name,
          start: match.index,
          headEnd: match.index + raw.length,
          // `export const x = function (…)` ends on the keyword, not on a `(`.
          form: raw.endsWith('function') ? 'function' : entry.form
        });
      }
    }
  }
  heads.sort((a, b) => a.start - b.start);
  const declarations: ExportedDeclaration[] = [];
  for (const [index, head] of heads.entries()) {
    const next = heads[index + 1];
    declarations.push({
      name: head.name,
      form: head.form,
      headEnd: head.headEnd,
      limit: next === undefined ? masked.length : next.start
    });
  }
  return declarations;
}

/**
 * Body of a declaration, located from its PARAMETER LIST — never by scanning
 * for the next `(` — so an `if (`, `for (`, `switch (` or nested arrow inside
 * the body cannot be mistaken for the hook's own signature.
 */
function locateBody(text: string, declaration: ExportedDeclaration): BodyLocation | null {
  const { form, headEnd, limit } = declaration;
  let paramsOpen: number;
  if (form === 'paren') {
    paramsOpen = headEnd - 1; // the head ends on the params' opening paren
  } else {
    // `function name(…)` / `= function (…)`: the next `(` is the params.
    // Wrapper form `= useX(…)`: the next `(` is the callback's params.
    const found = text.indexOf('(', headEnd);
    if (found === -1 || found >= limit) return null;
    paramsOpen = found;
  }
  const paramsClose = matchParen(text, paramsOpen, limit);
  if (paramsClose === -1) return null;
  const block = findBlockBody(text, paramsClose + 1, limit);
  if (block !== -1) return { kind: 'block', openBrace: block };
  const afterParams = skipSpace(text, paramsClose + 1, limit);
  if (text.startsWith('=>', afterParams)) {
    return { kind: 'expression', from: skipSpace(text, afterParams + 2, limit) };
  }
  return null;
}

function readReturnShape(masked: string, declaration: ExportedDeclaration): ClassifiedReturn {
  const body = locateBody(masked, declaration);
  if (body === null) return { shape: 'other', signature: null };
  const expressions = body.kind === 'expression'
    ? [masked.slice(body.from, readExpression(masked, body.from, declaration.limit).next)]
    : scanBlockBody(masked, body.openBrace);
  if (expressions.length === 0) return { shape: 'other', signature: null };

  const classified = expressions.map(classifyReturn);
  const shape = strictDominantOf(classified.map((entry) => entry.shape)) ?? 'other';
  if (shape !== 'object') return { shape, signature: null };
  const signatures: string[] = [];
  for (const entry of classified) {
    if (entry.shape === 'object' && entry.signature !== null) signatures.push(entry.signature);
  }
  return { shape, signature: strictDominantOf(signatures) };
}

/**
 * True when the file imports a module whose PATH matches /mapper/i. Reads the
 * RAW text (a specifier is itself a string literal, which the mask would
 * blank) and cross-checks against the masked text so a commented-out import
 * does not count: the mask leaves spaces where a real `import` keyword was.
 */
function fileImportsMapper(raw: string, masked: string): boolean {
  IMPORT_SPECIFIER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IMPORT_SPECIFIER_RE.exec(raw)) !== null) {
    const indentation = match[1];
    const specifier = match[2];
    if (indentation === undefined || specifier === undefined) continue;
    if (!MAPPER_PATH_RE.test(specifier)) continue;
    if (masked.startsWith('import', match.index + indentation.length)) return true;
  }
  return false;
}

function readHooksFromMasked(masked: string, file: string): HookObservation[] {
  return findExportedDeclarations(masked).map((declaration) => {
    const classified = readReturnShape(masked, declaration);
    return {
      file,
      name: declaration.name,
      usePrefix: USE_PREFIX_RE.test(declaration.name),
      returnShape: classified.shape,
      returnSignature: classified.signature
    };
  });
}

// ---------- aggregation ----------------------------------------------------

/**
 * Most frequent value, or null when nothing is STRICTLY most frequent. A tie
 * has no dominant, and saying so beats picking one arbitrarily.
 */
function strictDominantOf<T>(values: T[]): T | null {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: T | null = null;
  let bestCount = 0;
  let tied = false;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
      tied = false;
    } else if (count === bestCount) {
      tied = true;
    }
  }
  return tied ? null : best;
}

function namingPatternOf(count: number, prefixed: number): HookDirectoryConvention['namingPattern'] {
  if (count === 0) return 'unknown';
  if (prefixed === count) return 'use<X>';
  if (prefixed === 0) return 'no-use-prefix';
  return 'mixed';
}

function formatShapeCounts(hooks: HookObservation[]): string {
  const counts = new Map<HookReturnShape, number>();
  for (const hook of hooks) counts.set(hook.returnShape, (counts.get(hook.returnShape) ?? 0) + 1);
  return [...counts.entries()].map(([shape, count]) => `${shape} ×${count}`).join(', ');
}

function listedNames(names: string[]): string {
  const listed = names.slice(0, MAX_DEVIANTS_LISTED).join(', ');
  const extra = names.length - MAX_DEVIANTS_LISTED;
  return extra > 0 ? `${listed} (+${extra} more)` : listed;
}

function summarizeDirectory(dir: string, hooks: HookObservation[], files: HookFileReport[]): DirectorySummary {
  const dominantReturnShape = strictDominantOf(hooks.map((hook) => hook.returnShape));
  const signatures: string[] = [];
  if (dominantReturnShape === 'object') {
    for (const hook of hooks) {
      if (hook.returnShape === 'object' && hook.returnSignature !== null) signatures.push(hook.returnSignature);
    }
  }
  // A tie inside the object class has no dominant key set — null, not a pick.
  const dominantReturnSignature = strictDominantOf(signatures);
  // Deviants are compared by shape CLASS. A different key set is key-level
  // detail, reported separately, never as "an object deviating from objects".
  const offShape = dominantReturnShape === null
    ? []
    : hooks.filter((hook) => hook.returnShape !== dominantReturnShape);
  const prefixed = hooks.filter((hook) => hook.usePrefix).length;
  const mapperFiles = files.filter((entry) => entry.importsMapper).map((entry) => entry.file);

  const convention: HookDirectoryConvention = {
    dir,
    hookCount: hooks.length,
    hookFileCount: files.length,
    namingPattern: namingPatternOf(hooks.length, prefixed),
    dominantReturnShape,
    dominantReturnSignature,
    offShapeCount: offShape.length,
    offShapeHooks: offShape.map((hook) => hook.name),
    mapperFiles,
    hooks
  };

  const inconsistencies: string[] = [];
  if (hooks.length > 0 && dominantReturnShape === null) {
    inconsistencies.push(
      `hook return shape: no dominant shape among the ${hooks.length} hooks in ${dir} ` +
        `(${formatShapeCounts(hooks)}); no deviant set is reported`
    );
  } else if (dominantReturnShape !== null && offShape.length > 0) {
    const deviants = offShape.map((hook) => `${hook.name} (${describeShape(hook.returnShape, hook.returnSignature)})`);
    inconsistencies.push(
      `hook return shape: ${hooks.length - offShape.length} of ${hooks.length} hooks in ${dir} return ` +
        `${describeShape(dominantReturnShape, dominantReturnSignature)}; deviating: ${listedNames(deviants)}`
    );
  }
  if (dominantReturnShape === 'object') {
    const objectHooks = hooks.filter((hook) => hook.returnShape === 'object');
    const distinctKeys = new Set(signatures);
    if (distinctKeys.size >= 2) {
      const differing = objectHooks.filter((hook) => hook.returnSignature !== dominantReturnSignature);
      const dominantKeys = dominantReturnSignature === null
        ? 'no single dominant key set'
        : `an object ${dominantReturnSignature}`;
      inconsistencies.push(
        `hook return keys: ${objectHooks.length - differing.length} of ${objectHooks.length} object-returning hooks ` +
          `in ${dir} return ${dominantKeys}; differing keys: ` +
          listedNames(differing.map((hook) => `${hook.name} (${hook.returnSignature ?? 'keys not read'})`))
      );
    }
  }
  if (convention.namingPattern === 'mixed') {
    const unprefixed = hooks.filter((hook) => !hook.usePrefix).map((hook) => hook.name);
    inconsistencies.push(
      `hook naming: ${prefixed} of ${hooks.length} exported functions in ${dir} use the "use" prefix; ` +
        `deviating: ${listedNames(unprefixed)}`
    );
  }
  if (mapperFiles.length > 0 && mapperFiles.length < files.length) {
    inconsistencies.push(
      `mapper delegation (observed from import paths only): ${mapperFiles.length} of ${files.length} hook files in ` +
        `${dir} import a module whose path matches /mapper/i; the remaining ${files.length - mapperFiles.length} ` +
        'import none — that is the absence of an observation, not evidence that they map inline'
    );
  }

  return { convention, inconsistencies };
}

// ---------- filesystem -----------------------------------------------------

async function listHookFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  const queue: string[] = [dir];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) queue.push(full);
      else if (HOOK_FILE_EXTS.test(entry.name)) found.push(full);
    }
  }
  return found;
}

async function readHooksInDirectory(
  absoluteDir: string,
  projectRoot: string
): Promise<{ hooks: HookObservation[]; files: HookFileReport[] }> {
  const paths = await listHookFiles(absoluteDir);
  paths.sort();
  const hooks: HookObservation[] = [];
  const files: HookFileReport[] = [];
  for (const path of paths) {
    let text: string;
    try {
      text = await readText(path);
    } catch {
      continue; // unreadable file — this scan is read-only and best-effort
    }
    const masked = maskNonCode(text);
    const declared = readHooksFromMasked(masked, relative(projectRoot, path).split(/[\\/]/).join('/'));
    if (declared.length === 0) continue;
    hooks.push(...declared);
    // Mapper delegation is observed per FILE: an import belongs to a module,
    // so attributing it to each hook that module exports would over-claim.
    files.push({ file: declared[0]?.file ?? '', importsMapper: fileImportsMapper(text, masked) });
  }
  return { hooks, files };
}

export async function scanHookConvention(options: HookConventionScanOptions): Promise<HookConventionReport> {
  const { projectRoot, hookDirs } = options;
  const directories: HookDirectoryConvention[] = [];
  const inconsistencies: string[] = [];
  for (const dir of hookDirs) {
    const absolute = join(projectRoot, dir);
    if (!(await isDirectory(absolute))) continue; // absent directory is not an error
    const { hooks, files } = await readHooksInDirectory(absolute, projectRoot);
    const summary = summarizeDirectory(dir, hooks, files);
    directories.push(summary.convention);
    inconsistencies.push(...summary.inconsistencies);
  }
  return { directories, inconsistencies };
}
