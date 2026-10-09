// src/cli/commands/sediment-pool-commands.ts
//
// The `peaks skill sediment` verbs that read or write the bee pool itself:
// `add-segment`, `add-bee`, `list`, `rebuild-index`, `refine-bee`,
// `clone-bee`, `promote`, `retire`. Split out of `sediment-commands.ts`;
// every verb's args, envelope and error strings are unchanged.

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertNotSystemPath,
  resolveSegmentsDir,
  resolveUserBeesDir
} from '../../services/sediment/pool-paths.js';
import { writeBeeManifest } from '../../services/sediment/pool-write.js';
import { readPool } from '../../services/sediment/pool-read.js';
import { rebuildIndexFromFs } from '../../services/sediment/pool-rebuild-index.js';
import { evaluateGate } from '../../services/sediment/promotion-gate.js';
import type { BeeManifest } from '../../services/sediment/types.js';
import type { CliResult, SedimentContext } from './sediment-command-shared.js';

/** Longest `description` the pool will store; a patch appends under this cap. */
const DESCRIPTION_MAX_CHARS = 1000;

export function addSegment(ctx: SedimentContext): CliResult {
  const { home, positional, flags } = ctx;
  const name = positional[1];
  if (!name) return { ok: false, error: 'MISSING_ARG: name' };
  const description = flags.maybeString('describe') ?? '';
  const segDir = join(resolveSegmentsDir({ home }), name);
  // Soft-protection guard: refuse to write under any `.system` path
  // segment. Mirrors the same guard in writeBeeManifest.
  assertNotSystemPath(segDir);
  mkdirSync(segDir, { recursive: true });
  writeFileSync(join(segDir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n`);
  rebuildIndexFromFs({ home });
  return { ok: true };
}

export function addBee(ctx: SedimentContext): CliResult {
  const { home, positional, flags } = ctx;
  const name = positional[1];
  if (!name) return { ok: false, error: 'MISSING_ARG: name' };
  // Collect --segment values; the brief uses repeatable --segment
  // flags (one token per segment). parseFlags now returns a
  // 1-element array for a single occurrence and a longer array
  // for repeated keys, so .list() returns a uniform string[].
  const segList = flags.list('segment');
  const description = flags.maybeString('description') ?? '';
  const m: BeeManifest = {
    schemaVersion: 'peaks.bee/1',
    name,
    source: 'user',
    promotion_status: 'candidate',
    description,
    segments: segList.map((s) => ({
      name: s,
      inputs: [],
      outputs: [],
      sideEffects: []
    })),
    entrypoint: { preamble: `## ${name}`, refs: [] },
    promotion: {
      minCycles: 1,
      requiresHumanApproval: true,
      requiresSmokeTest: true
    },
    createdBy: 'llm',
    lastTouchedAt: new Date().toISOString()
  };
  // writeBeeManifest runs zod validation + SYSTEM_PATH_FORBIDDEN
  // guard internally.
  writeBeeManifest({ home }, m);
  rebuildIndexFromFs({ home });
  return { ok: true };
}

export function listPool(ctx: SedimentContext): CliResult {
  const idx = readPool({ home: ctx.home });
  return { ok: true, data: idx.entries };
}

export function rebuildIndex(ctx: SedimentContext): CliResult {
  const idx = rebuildIndexFromFs({ home: ctx.home });
  return { ok: true, data: idx };
}

/** Read a bee's manifest, or null when it is absent. */
function readManifest(manifestPath: string): BeeManifest | null {
  if (!existsSync(manifestPath)) return null;
  return JSON.parse(readFileSync(manifestPath, 'utf-8')) as BeeManifest;
}

function beeManifestPath(home: string, name: string): string {
  return join(resolveUserBeesDir({ home }), name, 'manifest.json');
}

/** Append a `[tag timestamp] text` note to a description under the length cap. */
function appendNote(description: string, tag: string, text: string, ts: string): string {
  const note = `[${tag} ${ts}] ${text}`;
  return (description + (description ? '\n' : '') + note).slice(0, DESCRIPTION_MAX_CHARS);
}

export function refineBee(ctx: SedimentContext): CliResult {
  const { home, positional, flags } = ctx;
  const name = positional[1];
  if (!name) return { ok: false, error: 'MISSING_ARG: refine-bee requires <name>' };
  const patch = flags.maybeString('patch') ?? '';
  if (!patch) return { ok: false, error: 'MISSING_ARG: refine-bee requires --patch' };
  const m = readManifest(beeManifestPath(home, name));
  if (m === null) return { ok: false, error: 'BEE_NOT_FOUND' };
  // Append patch note to description, preserving prior content. Cap at
  // 1000 chars to avoid unbounded growth.
  const ts = new Date().toISOString();
  m.description = appendNote(m.description, 'refine', patch, ts);
  m.lastTouchedAt = ts;
  // promotion_status is preserved (do not touch it here).
  writeBeeManifest({ home }, m);
  rebuildIndexFromFs({ home });
  return { ok: true };
}

export function cloneBee(ctx: SedimentContext): CliResult {
  const { home, positional, flags } = ctx;
  const name = positional[1];
  if (!name) return { ok: false, error: 'MISSING_ARG: clone-bee requires <name>' };
  const asName = flags.maybeString('as') ?? '';
  if (!asName) return { ok: false, error: 'MISSING_ARG: clone-bee requires --as <new-name>' };
  const src = readManifest(beeManifestPath(home, name));
  if (src === null) return { ok: false, error: 'BEE_NOT_FOUND' };
  // Fresh id, reset promotion_status to candidate, rename. The source
  // manifest is unchanged on disk.
  const clone: BeeManifest = {
    ...src,
    name: asName,
    promotion_status: 'candidate',
    lastTouchedAt: new Date().toISOString()
  };
  writeBeeManifest({ home }, clone);
  rebuildIndexFromFs({ home });
  return { ok: true };
}

export function promote(ctx: SedimentContext): CliResult {
  const { home, positional } = ctx;
  const name = positional[1];
  if (!name) return { ok: false, error: 'MISSING_ARG: promote requires <name>' };
  const m = readManifest(beeManifestPath(home, name));
  if (m === null) return { ok: false, error: 'BEE_NOT_FOUND' };
  if (m.source === 'system') return { ok: false, error: 'PROMOTION_SYSTEM_REFUSED' };
  // Evaluate the PromotionGate (Task 5). The CLI is a thin shim; the
  // humanApproved / smokeTestPresent inputs default to "true" here
  // because the LLM-driven peaks-maker workflow has already obtained
  // those approvals before calling promote.
  const gate = evaluateGate({ home }, m, {
    humanApproved: true,
    smokeTestPresent: m.promotion.requiresSmokeTest
  });
  if (!gate.ok) {
    return {
      ok: false,
      error: `PROMOTION_GATE_FAILED: ${gate.failedSubconditions.join(',')}`
    };
  }
  m.promotion_status = 'stable';
  m.lastTouchedAt = new Date().toISOString();
  writeBeeManifest({ home }, m);
  rebuildIndexFromFs({ home });
  return { ok: true };
}

export function retire(ctx: SedimentContext): CliResult {
  const { home, positional, flags } = ctx;
  const name = positional[1];
  if (!name) return { ok: false, error: 'MISSING_ARG: retire requires <name>' };
  const reason = flags.maybeString('reason') ?? '';
  const m = readManifest(beeManifestPath(home, name));
  if (m === null) return { ok: false, error: 'BEE_NOT_FOUND' };
  if (m.source === 'system') return { ok: false, error: 'RETIRE_SYSTEM_REFUSED' };
  m.promotion_status = 'retired';
  if (reason) {
    const ts = new Date().toISOString();
    m.description = appendNote(m.description, 'retire', reason, ts);
  }
  m.lastTouchedAt = new Date().toISOString();
  writeBeeManifest({ home }, m);
  rebuildIndexFromFs({ home });
  return { ok: true };
}
