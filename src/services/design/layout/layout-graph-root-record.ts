/**
 * Remembers where the spacing token contract for the stored graph lives. A
 * graph built with an app root other than the project root records that root
 * here, so a boundary check reads the contract the graph was built against
 * instead of reporting the default path as missing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { graphRoot, type StoreWrite } from './layout-graph-paths.js';

export const DESIGN_ROOT_FILE = 'design-root.txt';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function insideProject(projectRoot: string, candidate: string): boolean {
  const check = relative(resolve(projectRoot), resolve(candidate));
  return check === '' || (!check.startsWith('..') && !isAbsolute(check));
}

/** Record the design root the graph was built against; a path outside the project is refused. */
export function recordDesignRoot(projectRoot: string, designRoot: string): StoreWrite {
  if (!insideProject(projectRoot, designRoot)) {
    return { ok: false, reason: 'the design root is outside the project' };
  }
  const rel = relative(resolve(projectRoot), resolve(designRoot)).split(sep).join('/');
  const path = join(graphRoot(projectRoot), DESIGN_ROOT_FILE);
  try {
    mkdirSync(graphRoot(projectRoot), { recursive: true });
    writeFileSync(path, `${rel === '' ? '.' : rel}\n`, 'utf8');
    return { ok: true, path };
  } catch (error) {
    return { ok: false, reason: `the design root could not be recorded (${errorText(error)})` };
  }
}

/** The recorded design root, or `<project>/design` when none was recorded or it escapes. */
export function recordedDesignRoot(projectRoot: string): string {
  const fallback = join(projectRoot, 'design');
  const path = join(graphRoot(projectRoot), DESIGN_ROOT_FILE);
  if (!existsSync(path)) return fallback;
  let recorded: string;
  try {
    recorded = readFileSync(path, 'utf8').trim();
  } catch {
    return fallback;
  }
  if (recorded === '' || !insideProject(projectRoot, resolve(projectRoot, recorded)))
    return fallback;
  return resolve(projectRoot, recorded);
}
