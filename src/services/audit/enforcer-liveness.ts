/**
 * Enforcer liveness — A9 of `.peaks/docs/diagnosis-2026-09-15-peaks-loop-state.md`.
 *
 * `cli-backed` used to mean "the `enforcerRef` path exists on disk"
 * (`backing-detector.ts`). It did not mean "the enforcer runs". Ten catalog
 * enforcerRefs name a file no module imports — `lint-rd-handoff-coverage.ts`
 * among them — so the audit reported 108/152 red lines as CLI-enforced while
 * a quarter of those had no caller at all.
 *
 * This module answers the narrower, checkable question: is the enforcer
 * module imported by some file OUTSIDE the enforcers directory? A relative
 * import is cheap proof that a call site exists — production code cannot
 * invoke the module without one.
 *
 * Deliberate limits, stated rather than hidden:
 *   - An import is not a call. A module can be imported and never invoked.
 *     This check is necessary, not sufficient: it eliminates the "no caller
 *     exists at all" class and nothing beyond it.
 *   - Imports written inside `src/…/audit/enforcers/` do not count. A dead
 *     enforcer that imports another dead enforcer must not resurrect it.
 *   - A project with no `src/` tree yields `unknown: true`, never an empty
 *     live-set: peaks-loop audits consumer projects, and "cannot tell" must
 *     not read as "dead".
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const SOURCE_FILE = /\.(ts|tsx|mts|cts)$/;
const ENFORCER_DIR_FRAGMENT = '/services/audit/enforcers/';

/** Matches `from './x.js'`, `import('./x.js')` and `export … from './x.js'`. */
const RELATIVE_JS_IMPORT = /(?:from|import)\s*\(?\s*['"](\.\.?\/[^'"]+\.js)['"]/g;

export interface LiveEnforcerScan {
  /** Refs proven imported from a call site. Empty when `unknown` is true. */
  readonly live: ReadonlySet<string>;
  /** True when the project has no `src/` tree, so liveness is undecidable. */
  readonly unknown: boolean;
  readonly warnings: readonly string[];
}

function toPosix(value: string): string {
  return value.split('\\').join('/');
}

function* walkSourceFiles(root: string, warnings: string[]): Generator<string> {
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) continue;
    let dirents;
    try {
      dirents = readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      warnings.push(`enforcer-liveness: cannot read ${toPosix(dir)} (${String(error)})`);
      continue;
    }
    for (const dirent of dirents) {
      const full = join(dir, dirent.name);
      if (dirent.isDirectory()) {
        if (dirent.name === 'node_modules' || dirent.name === 'dist' || dirent.name.startsWith('.')) continue;
        stack.push(full);
      } else if (dirent.isFile() && SOURCE_FILE.test(dirent.name)) {
        yield full;
      }
    }
  }
}

/**
 * Scan `projectRoot/src` for relative imports that name one of `enforcerRefs`.
 * Returns the subset of refs with a call site outside the enforcers directory.
 */
export function computeLiveEnforcers(
  projectRoot: string,
  enforcerRefs: readonly string[],
): LiveEnforcerScan {
  const srcRoot = join(projectRoot, 'src');
  const warnings: string[] = [];
  const live = new Set<string>();
  const wanted = new Set(enforcerRefs);

  let sawAnySource = false;
  for (const absFile of walkSourceFiles(srcRoot, warnings)) {
    sawAnySource = true;
    const relFile = toPosix(relative(projectRoot, absFile));
    // An import written inside the enforcers directory proves nothing.
    if (relFile.includes(ENFORCER_DIR_FRAGMENT)) continue;

    let source: string;
    try {
      source = readFileSync(absFile, 'utf8');
    } catch (error) {
      warnings.push(`enforcer-liveness: cannot read ${relFile} (${String(error)})`);
      continue;
    }

    RELATIVE_JS_IMPORT.lastIndex = 0;
    let match = RELATIVE_JS_IMPORT.exec(source);
    while (match !== null) {
      const specifier = match[1] ?? '';
      const resolved = toPosix(relative(projectRoot, resolve(dirname(absFile), specifier)));
      const asTs = resolved.replace(/\.js$/, '.ts');
      if (wanted.has(asTs)) live.add(asTs);
      match = RELATIVE_JS_IMPORT.exec(source);
    }
  }

  if (!sawAnySource) {
    return { live, unknown: true, warnings };
  }
  return { live, unknown: false, warnings };
}
