/**
 * Readers for the plugin-free materialized ECC agents — the path the LLM and
 * Gate B3 open.
 *
 * `~/.peaks/agents/ecc/` is the contract: `peaks ecc ls|show|status` render it,
 * `ecc-bridge.ts` resolves `code-reviewer` from it, and
 * `skills/bee/peaks-rd/references/parallel-review-fanout.md` tells the RD loop to
 * read `<resolved-name>.md` there by hand. It is written by
 * `materializeEccAgents` from the installed `ecc-universal` package.
 *
 * The D-009 fallback lives here now (it used to sit with the cache manifest): an
 * agent whose frontmatter will not parse is listed from its filename plus its
 * first non-empty line (the line below the fence when a fence exists, the
 * file's own first line when it does not), with ONE warning across the process,
 * because a malformed descriptor upstream must not erase the roster the user can
 * still dispatch.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseFrontmatter } from '../../shared/frontmatter.js';
import {
  isSafeAgentName,
  resolveEccMaterializedDir,
  resolveEccMaterializedManifestPath,
  type EccMaterializeManifest
} from './ecc-package-source.js';

export function readEccMaterializeManifest(dirOverride?: string): EccMaterializeManifest | null {
  const path = resolveEccMaterializedManifestPath(dirOverride);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as EccMaterializeManifest;
    if (
      typeof parsed.version === 'string' &&
      typeof parsed.packageVersion === 'string' &&
      typeof parsed.materializedAt === 'string' &&
      Array.isArray(parsed.agents)
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function listMaterializedAgents(dirOverride?: string): string[] {
  const dir = dirOverride ?? resolveEccMaterializedDir();
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace(/\.md$/i, ''))
      .filter((name) => isSafeAgentName(name))
      .sort();
  } catch {
    return [];
  }
}

export function hasMaterializedEccAgents(dirOverride?: string): boolean {
  return listMaterializedAgents(dirOverride).length > 0;
}

/**
 * Resolve the materialized ECC agent name for a logical role.
 *
 * Upstream ECC names its agents `<lang>-reviewer` (`code-reviewer.md`),
 * NOT `code-review.md` — so no caller may hardcode a single filename.
 * Resolution order (deterministic; `listMaterializedAgents` is sorted):
 *   1. the caller's explicit candidates, in declared priority order
 *      (e.g. `['code-reviewer', 'code-review']` — real upstream name
 *      first, legacy/forward-compat second);
 *   2. a fallback over the materialized list: the exact
 *      `<stem>-reviewer`, else the first `<stem>-*` whose name contains
 *      `reviewer`, where `stem` is the candidate minus a `-reviewer`
 *      suffix (`code-reviewer` -> `code`).
 *
 * Returns `null` when nothing matches — the caller degrades to inline
 * review instead of dispatching a non-existent agent.
 */
export function resolveMaterializedAgentName(
  candidates: readonly string[],
  dirOverride?: string
): string | null {
  const available = listMaterializedAgents(dirOverride);
  if (available.length === 0) return null;

  for (const candidate of candidates) {
    if (available.includes(candidate)) return candidate;
  }

  for (const candidate of candidates) {
    const stem = candidate.replace(/-reviewer$/, '');
    const exact = available.find((name) => name === `${stem}-reviewer`);
    if (exact !== undefined) return exact;
    const reviewerish = available.find(
      (name) => name.startsWith(`${stem}-`) && name.includes('reviewer')
    );
    if (reviewerish !== undefined) return reviewerish;
  }

  return null;
}

export function readMaterializedAgent(name: string, dirOverride?: string): string | null {
  if (!isSafeAgentName(name)) return null;
  const file = join(dirOverride ?? resolveEccMaterializedDir(), `${name}.md`);
  if (!existsSync(file)) return null;
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

let warnedAboutFallback = false;

/** First non-empty line BELOW the frontmatter fence; with no fence at all, the
 *  first non-empty line, truncated for a listing. */
function firstBodyLine(dir: string, fileName: string): string {
  let description = '';
  let seenClosing = false;
  let inFrontmatter = false;
  try {
    const body = readFileSync(join(dir, fileName), 'utf8');
    for (const raw of body.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.length === 0) continue;
      if (!seenClosing) {
        if (!inFrontmatter && line === '---') {
          inFrontmatter = true;
          continue;
        }
        if (inFrontmatter && line === '---') {
          seenClosing = true;
          continue;
        }
        // No fence in the file: this line IS prose, and it is the only
        // description a reader can get from it.
        description = line;
        break;
      }
      description = line;
      break;
    }
  } catch {
    /* best-effort */
  }
  return description.length > 80 ? `${description.slice(0, 77)}...` : description;
}

/**
 * List the materialized agents with their declared name and description — the
 * `peaks ecc ls` row shape.
 */
export function listEccAgents(dirOverride?: string): Array<{ name: string; description: string }> {
  const dir = dirOverride ?? resolveEccMaterializedDir();
  const out: Array<{ name: string; description: string }> = [];
  for (const file of listMaterializedAgents(dir).map((name) => `${name}.md`)) {
    let meta: { name: string; description: string };
    try {
      const fm = parseFrontmatter(readFileSync(join(dir, file), 'utf8'));
      meta = { name: fm.name, description: fm.description };
    } catch {
      // D-009: name from filename, description from the first body line.
      const base = file.replace(/\.md$/i, '');
      meta = { name: base, description: firstBodyLine(dir, file) };
      if (!warnedAboutFallback) {
        warnedAboutFallback = true;
        process.stderr.write(
          `warning: ECC agent "${base}" has malformed frontmatter; ` +
            'falling back to filename + first body line\n'
        );
      }
    }
    out.push(meta);
  }
  return out;
}
