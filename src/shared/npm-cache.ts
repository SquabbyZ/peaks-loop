/**
 * Where npm puts its per-user exec (`npx`) cache.
 *
 * This list lives in exactly ONE place on purpose: whoever resolves a package
 * out of that cache (the Playwright loader `import()`s what it finds, the OCR
 * probe reports it as installed) is answering the same question — "is this
 * package already here?" — and a second copy of the roots is a second answer
 * that would drift from this one.
 *
 * `npm_config_cache` / `NPM_CONFIG_CACHE` are deliberately NOT honoured: under
 * `npm run`, npm exports the value a repo's own `.npmrc` chose, so trusting
 * them lets a committed `.npmrc` select the tree that gets executed. The
 * default roots below are where npm actually puts an `npx` cache.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

/** `<npm cache>/_npx` candidates: the per-user defaults, and nothing else. */
export function npmExecCacheRoots(): string[] {
  // Resolved per call, never at module load: callers that relocate the home
  // (tests, and any future sandboxed run) must see the relocation.
  const roots: string[] = [join(homedir(), '.npm', '_npx')];
  if (process.platform === 'win32') {
    for (const key of ['LOCALAPPDATA', 'APPDATA']) {
      const base = process.env[key];
      if (base !== undefined && base.length > 0) {
        roots.push(join(base, 'npm-cache', '_npx'));
      }
    }
  }
  return roots;
}
