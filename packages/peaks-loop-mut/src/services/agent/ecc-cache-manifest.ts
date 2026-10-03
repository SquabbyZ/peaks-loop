/**
 * ECC cache manifest + cache reads (writeManifest / readManifestAt /
 * listCachedAgents / readAgentSkill and the D-009 `fallbackMetadata`).
 *
 * The warn-once latch `warnedAboutFallback` lives HERE with its only
 * reader `fallbackMetadata` — they move as one unit, so the D-009
 * warning stays single-fire across repeated calls.
 *
 * Split verbatim out of `ecc-cache-service.ts` (wave 11 slice A,
 * 2026-10-03); no behaviour changed.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseFrontmatter } from '../../shared/frontmatter.js';

import { resolveManifestPath, resolveAgentsDir, type CacheManifest } from './ecc-cache-config.js';
import { isSafeAgentName } from './ecc-archive-safety.js';

function writeManifest(manifest: CacheManifest): void {
  const path = resolveManifestPath();
  writeFileSync(path, JSON.stringify(manifest, null, 2));
}

export function readCacheManifest(): CacheManifest | null {
  return readManifestAt();
}

function readManifestAt(dirOverride?: string): CacheManifest | null {
  const path = resolveManifestPath(dirOverride);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as CacheManifest;
    if (
      typeof parsed.version === 'string' &&
      typeof parsed.sha === 'string' &&
      typeof parsed.fetchedAt === 'string' &&
      Array.isArray(parsed.agents)
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

let warnedAboutFallback = false;

function fallbackMetadata(fileName: string): { name: string; description: string } {
  const base = fileName.replace(/\.md$/i, '');
  let description = '';
  try {
    const body = readFileSync(join(resolveManifestDirForAgents(), fileName), 'utf8');
    const lines = body.split(/\r?\n/);
    let inFrontmatter = false;
    let seenClosing = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (!seenClosing) {
        if (!inFrontmatter && line === '---') {
          inFrontmatter = true;
          continue;
        }
        if (inFrontmatter && line === '---') {
          seenClosing = true;
          continue;
        }
        continue;
      }
      if (line.length === 0) continue;
      description = line;
      break;
    }
  } catch {
    /* best-effort */
  }
  if (description.length > 80) description = `${description.slice(0, 77)}...`;
  if (!warnedAboutFallback) {
    try {
      process.stderr.write(
        `warning: cached agent "${base}" has malformed frontmatter; falling back to filename + first body line\n`
      );
    } catch {
      /* best-effort */
    }
    warnedAboutFallback = true;
  }
  return { name: base, description };
}

function resolveManifestDirForAgents(): string {
  const manifest = readCacheManifest();
  if (manifest === null) return '';
  return resolveAgentsDir(manifest.sha);
}

export function listCachedAgents(): { name: string; description: string }[] {
  const manifest = readCacheManifest();
  if (manifest === null) return [];
  const agentsDir = resolveAgentsDir(manifest.sha);
  if (!existsSync(agentsDir)) return [];
  const out: { name: string; description: string }[] = [];
  for (const file of readdirSync(agentsDir).sort()) {
    if (!file.endsWith('.md')) continue;
    const fullPath = join(agentsDir, file);
    let meta: { name: string; description: string };
    try {
      const raw = readFileSync(fullPath, 'utf8');
      const fm = parseFrontmatter(raw);
      meta = { name: fm.name, description: fm.description };
    } catch {
      // D-009 fallback — name from filename, description from first body line.
      meta = fallbackMetadata(file);
    }
    out.push(meta);
  }
  return out;
}

export function readAgentSkill(name: string): string | null {
  if (!isSafeAgentName(name)) return null;
  const manifest = readCacheManifest();
  if (manifest === null) return null;
  const file = join(resolveAgentsDir(manifest.sha), `${name}.md`);
  if (!existsSync(file)) return null;
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

// Cross-module glue: private inside ecc-cache-service.ts before the split.
export { writeManifest, readManifestAt };
