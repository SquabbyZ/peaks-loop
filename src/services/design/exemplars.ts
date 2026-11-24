/**
 * The design exemplar registry — `design/exemplars/<archetype>/`.
 *
 * Registration is a file convention rather than a generated manifest. Each
 * archetype directory holds `meta.json` beside the exemplar source and its
 * redacted-or-synthetic screenshot. The metadata keys are `route`,
 * `sourceFile` (alias `source`), `screenshotPath` (alias `screenshot`) and
 * `generatedAt`; only the first three are read here.
 *
 * Reading is deliberately total: a malformed directory becomes an
 * `ExemplarIssue` naming the reason instead of an exception, so a partial
 * registration surfaces to the caller rather than silently shrinking the
 * registry. An archetype directory without `meta.json` is such an issue, and so
 * is a `meta.json` whose source file is absent — an entry is only usable when
 * its source exists. A screenshot is optional: it is recorded only when the
 * named file exists, and `null` otherwise.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

export type ExemplarEntry = {
  archetype: string;
  route: string;
  sourceFile: string;
  screenshotPath: string | null;
  metaPath: string;
};

export type ExemplarIssue = { archetype: string; reason: string };

export type ExemplarRegistry = {
  entries: ExemplarEntry[];
  issues: ExemplarIssue[];
};

/** The exemplar tree, relative to the contract (frontend app) root. */
const EXEMPLARS_REL_DIR = join('design', 'exemplars');

const META_FILE = 'meta.json';

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'unknown error';
}

function isFile(pathname: string): boolean {
  const stats = statSync(pathname, { throwIfNoEntry: false });
  return stats !== undefined && stats.isFile();
}

/**
 * Resolve a path named inside `dir`, or `null` when it would escape it.
 *
 * A `meta.json` is project content, not trusted input: an absolute path or a
 * `..` climb must not turn a registry read into a probe of the host filesystem.
 */
function siblingPath(dir: string, name: string): string | null {
  const absolute = resolve(dir, name);
  return absolute.startsWith(dir + sep) ? absolute : null;
}

type MetaRead = { ok: true; meta: Record<string, unknown> } | { ok: false; reason: string };

function readMeta(metaPath: string): MetaRead {
  let text: string;
  try {
    text = readFileSync(metaPath, 'utf8');
  } catch (err) {
    return { ok: false, reason: `meta-unreadable: ${errorText(err)}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, reason: `meta-invalid-json: ${errorText(err)}` };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'meta-not-an-object' };
  }
  return { ok: true, meta: parsed as Record<string, unknown> };
}

/** The first non-empty string among `keys`, or `null` when none is present. */
function stringField(meta: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = meta[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

type EntryRead = { ok: true; entry: ExemplarEntry } | { ok: false; issue: ExemplarIssue };

function readEntry(dir: string, archetype: string): EntryRead {
  const metaPath = join(dir, META_FILE);
  const read = readMeta(metaPath);
  if (!read.ok) return { ok: false, issue: { archetype, reason: read.reason } };

  const route = stringField(read.meta, 'route');
  if (route === null) {
    return { ok: false, issue: { archetype, reason: 'meta-route-missing' } };
  }

  const sourceName = stringField(read.meta, 'sourceFile', 'source');
  if (sourceName === null) {
    return { ok: false, issue: { archetype, reason: 'meta-source-missing' } };
  }
  const sourceFile = siblingPath(dir, sourceName);
  if (sourceFile === null) {
    return { ok: false, issue: { archetype, reason: `source-escapes-archetype: ${sourceName}` } };
  }
  if (!isFile(sourceFile)) {
    return { ok: false, issue: { archetype, reason: `source-not-found: ${sourceName}` } };
  }

  const screenshotName = stringField(read.meta, 'screenshotPath', 'screenshot');
  const screenshot = screenshotName === null ? null : siblingPath(dir, screenshotName);
  const screenshotPath = screenshot !== null && isFile(screenshot) ? screenshot : null;
  return { ok: true, entry: { archetype, route, sourceFile, screenshotPath, metaPath } };
}

/** The archetype directory names, or `null` when nothing is registered there. */
function archetypeDirs(exemplarsDir: string): string[] | null {
  const stats = statSync(exemplarsDir, { throwIfNoEntry: false });
  if (stats === undefined || !stats.isDirectory()) return null;
  return readdirSync(exemplarsDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name)
    .sort();
}

/**
 * Read every archetype directory under `<contractRoot>/design/exemplars/`.
 *
 * `contractRoot` is the frontend app root the design contract follows (the
 * directory that contains `design/`), not the `design/` directory itself. A
 * missing exemplar tree is an empty registry, not an error: projects are free
 * not to register any exemplar.
 */
export function readExemplars(contractRoot: string): ExemplarRegistry {
  const exemplarsDir = resolve(contractRoot, EXEMPLARS_REL_DIR);
  const names = archetypeDirs(exemplarsDir);
  if (names === null) return { entries: [], issues: [] };

  const entries: ExemplarEntry[] = [];
  const issues: ExemplarIssue[] = [];
  for (const archetype of names) {
    const result = readEntry(join(exemplarsDir, archetype), archetype);
    if (result.ok) entries.push(result.entry);
    else issues.push(result.issue);
  }
  return { entries, issues };
}

/**
 * The exemplar registered for exactly `route`, or `null`.
 *
 * A prefix match would attribute a changed child route to a parent exemplar it
 * does not resemble, so an unregistered route stays null and the caller reports
 * `skipped(no-exemplar-for-archetype)` instead of scoring the wrong reference.
 */
export function archetypeForRoute(
  entries: readonly ExemplarEntry[],
  route: string
): ExemplarEntry | null {
  return entries.find((entry) => entry.route === route) ?? null;
}
