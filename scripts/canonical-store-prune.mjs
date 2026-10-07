#!/usr/bin/env node
//
// PRUNE — the delete half of the canonical store (`scripts/canonical-store.mjs`).
//
// WHY. Until this slice the installer only ever ADDED. When a skill left the package,
// its canonical copy, every IDE link to it and every `.peaks-managed` sidecar stayed
// on the user's machine forever: `installBundledSkills` walked the package's skill
// list and had no loop that walked the DESTINATIONS. This module is that loop.
//
// THE WHOLE RISK IS THE WORD "ONLY". A prune that is one predicate too wide is, from
// outside, indistinguishable from a correct one — both print success and both leave
// a shorter listing. So ownership is never inferred from "the name is not in the
// package": it is asked of ONE predicate, `isManagedEntry` in `canonical-store.mjs`,
// which demands a `.peaks-managed` marker beside the entry. A real directory the user
// authored — including one that reuses a retired skill's name — carries no marker,
// survives byte for byte, and is reported `kept` rather than silently dropped. The
// negative control in `tests/unit/ide/install-skills-prune.test.ts` is that directory.
//
// It is also the shape `ensureCanonicalCopy` deletes behind: that function used to run
// `rmSync(canonicalPath, ...)` with no ownership test at all, which today is
// unreachable only because no bundled asset is named `ecc` — while `~/.peaks/agents/`
// really does hold a user ECC tree under that name. Both delete paths now gate on the
// same predicate.
//
// Idempotent by construction: prune is driven by a name set, not by a marker that
// says "already pruned", so a second run finds nothing and moves no mtime.

import { existsSync, lstatSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { MANAGED_MARKER_SUFFIX, isManagedEntry, resolveKindRoot } from './canonical-store.mjs';

/** Every name directly under `dir`, sorted, or `[]` when `dir` does not exist. */
function listEntryNames(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort();
}

/** Remove `entryPath`, following a link instead of the tree it points at. */
function removeEntry(entryPath) {
  if (lstatSync(entryPath).isSymbolicLink()) {
    unlinkSync(entryPath);
  } else {
    rmSync(entryPath, { recursive: true, force: true });
  }
  const markerPath = `${entryPath}${MANAGED_MARKER_SUFFIX}`;
  if (existsSync(markerPath)) unlinkSync(markerPath);
}

/**
 * Drop every CANONICAL entry of one kind that peaks-loop owns and the package no
 * longer ships. `keepNames` is what this run of the package shipped.
 *
 * @param {{ kind: string, keepNames: readonly string[], root?: string }} options
 */
export function pruneCanonicalEntries(options) {
  const { kind, keepNames } = options;
  const kindRoot = resolveKindRoot(kind, options);
  const keep = new Set(keepNames);
  const pruned = [];
  const kept = [];

  for (const name of listEntryNames(kindRoot)) {
    const entryPath = join(kindRoot, name);
    if (name.endsWith(MANAGED_MARKER_SUFFIX)) {
      // A sidecar whose asset is gone and whose name the package does not claim is
      // ours with nothing left to describe — the leftover of a partial install. The
      // last `existsSync` is load-bearing: the branch below removes a retired entry
      // AND its sidecar, and this listing is a snapshot taken before that happened.
      const base = name.slice(0, -MANAGED_MARKER_SUFFIX.length);
      if (!keep.has(base) && !existsSync(join(kindRoot, base)) && existsSync(entryPath)) {
        unlinkSync(entryPath);
        pruned.push(`${kind}/${base}`);
      }
      continue;
    }
    if (keep.has(name)) continue;
    if (!isManagedEntry(entryPath)) {
      kept.push(name);
      continue;
    }
    removeEntry(entryPath);
    pruned.push(`${kind}/${name}`);
  }
  return { pruned, kept };
}

/**
 * Drop every IDE entry in `linkDir` that peaks-loop owns and the package no longer
 * ships. A real directory the user authored is never a candidate: it has no marker.
 *
 * @param {{ linkDir: string, keepNames: readonly string[] }} options
 */
export function pruneLinkedEntries(options) {
  const { linkDir, keepNames } = options;
  const keep = new Set(keepNames);
  const pruned = [];
  const kept = [];

  for (const name of listEntryNames(linkDir)) {
    if (name.endsWith(MANAGED_MARKER_SUFFIX)) continue;
    if (keep.has(name)) continue;
    const linkPath = join(linkDir, name);
    if (!isManagedEntry(linkPath)) {
      kept.push(`${linkDir}/${name}`);
      continue;
    }
    removeEntry(linkPath);
    pruned.push(`${linkDir}/${name}`);
  }
  return { pruned, kept };
}

/**
 * The installer's entry point for this module: prune one asset family's canonical
 * store AND every IDE directory that links into it.
 *
 * @param {{ kind: string, keepNames: readonly string[], linkDirs?: readonly string[], root?: string }} options
 */
export function pruneBundledEntries(options) {
  const { keepNames, linkDirs = [] } = options;
  const canonical = pruneCanonicalEntries({ ...options, keepNames });
  const pruned = [...canonical.pruned];
  const kept = [...canonical.kept];
  for (const linkDir of linkDirs) {
    const linked = pruneLinkedEntries({ linkDir, keepNames });
    pruned.push(...linked.pruned);
    kept.push(...linked.kept);
  }
  return { pruned, kept };
}
