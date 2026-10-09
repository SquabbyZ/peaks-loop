// src/cli/commands/sediment-query-commands.ts
//
// The read-only `peaks skill sediment` verbs: `search`, `recent`, `show`.
// Split out of `sediment-commands.ts`; every verb's args, envelope and error
// strings are unchanged.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveUserBeesDir } from '../../services/sediment/pool-paths.js';
import type { CliResult, SedimentContext } from './sediment-command-shared.js';

/** Milliseconds in one day, for `recent --since <N>d`. */
const MILLISECONDS_PER_DAY = 86_400_000;

/** `e instanceof Error ? e.message : String(e)` — the pool's error text. */
function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The manifest fields `search` matches and reports on. */
type SearchManifest = {
  name?: string;
  description?: string;
  source?: string;
  promotion_status?: string;
};

/** The manifest fields `recent` filters and reports on. */
type RecentManifest = {
  name?: string;
  lastTouchedAt?: string;
  promotion_status?: string;
};

/**
 * Walk `beesDir` and hand every readable bee manifest to `visit`. A manifest
 * that cannot be parsed is reported as a warning and skipped, exactly as the
 * per-verb inline loops did.
 */
function eachManifest<T>(
  beesDir: string,
  warnings: string[],
  visit: (name: string, manifest: T) => void
): void {
  if (!existsSync(beesDir)) return;
  for (const name of readdirSync(beesDir)) {
    const manifestPath = join(beesDir, name, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    let manifest: T;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as T;
    } catch (e: unknown) {
      warnings.push(`skipped ${name}: ${errorText(e)}`);
      continue;
    }
    visit(name, manifest);
  }
}

export function search(ctx: SedimentContext): CliResult {
  const { home, positional, flags } = ctx;
  const query = positional[1] ?? flags.maybeString('q') ?? '';
  if (!query) return { ok: false, error: 'MISSING_ARG: search requires <query>' };
  const q = query.toLowerCase();
  const matches: Array<Record<string, unknown>> = [];
  const warnings: string[] = [];
  eachManifest<SearchManifest>(resolveUserBeesDir({ home }), warnings, (_name, m) => {
    const haystack = `${m.name ?? ''} ${m.description ?? ''}`.toLowerCase();
    if (haystack.includes(q)) {
      matches.push({
        name: m.name,
        description: m.description,
        source: m.source,
        promotion_status: m.promotion_status
      });
    }
  });
  return { ok: true, data: { matches, warnings } };
}

export function recent(ctx: SedimentContext): CliResult {
  const { home, flags } = ctx;
  const sinceRaw = flags.maybeString('since') ?? '7d';
  const m = sinceRaw.match(/^(\d+)d$/);
  if (!m) return { ok: false, error: 'MISSING_ARG: recent requires --since Nd (e.g. 7d)' };
  const sinceDays = parseInt(m[1] as string, 10);
  const cutoff = new Date(Date.now() - sinceDays * MILLISECONDS_PER_DAY).toISOString();
  const matches: Array<Record<string, unknown>> = [];
  const warnings: string[] = [];
  eachManifest<RecentManifest>(resolveUserBeesDir({ home }), warnings, (_name, b) => {
    if (typeof b.lastTouchedAt === 'string' && b.lastTouchedAt >= cutoff) {
      matches.push({
        name: b.name,
        lastTouchedAt: b.lastTouchedAt,
        promotion_status: b.promotion_status
      });
    }
  });
  return { ok: true, data: { matches, warnings } };
}

export function show(ctx: SedimentContext): CliResult {
  const { home, positional } = ctx;
  const name = positional[1];
  if (!name) return { ok: false, error: 'MISSING_ARG: show requires <name>' };
  const manifestPath = join(resolveUserBeesDir({ home }), name, 'manifest.json');
  if (!existsSync(manifestPath)) return { ok: false, error: 'BEE_NOT_FOUND' };
  try {
    return { ok: true, data: JSON.parse(readFileSync(manifestPath, 'utf-8')) };
  } catch (e: unknown) {
    return { ok: false, error: `MANIFEST_CORRUPT: ${errorText(e)}` };
  }
}
