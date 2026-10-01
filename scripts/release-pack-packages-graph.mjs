/**
 * release-pack-packages-graph.mjs — workspace subpackage discovery +
 * dependency-safe publish ordering (split from release-pack.mjs).
 *
 * `release-pack.mjs` exceeded the 300-raw-line file-size cap, so the
 * package-graph cluster (discoverSubpackages / topoOrderSubpackages /
 * listInternalPackages) moved here verbatim. `release-pack.mjs` imports
 * and re-exports these names so its public surface is unchanged.
 *
 * `projectRoot` is recomputed from THIS module's own import.meta.url;
 * a sibling in the same `scripts/` directory resolves to the identical
 * value as the parent's copy.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(import.meta.url), '..', '..');

/**
 * Discover every publishable subpackage by scanning `packages/`.
 *
 * 2026-07-27 rid-014: removed the hardcoded `SUBPACKAGE_DIRECTORIES` array
 * (the pre-014 list lived in source and required a code edit + commit
 * to add/remove a subpackage). The workspace contract is now the single
 * source of truth: `pnpm-workspace.yaml` declares `./packages/*`, and
 * each directory that ships a `package.json` with a `name` is a
 * publishable subpackage. Hidden layouts — `node_modules`, dotfiles, the
 * workspace root itself — are filtered out so `pnpm -r publish` and
 * `release-pack.mjs` always agree.
 */
export function discoverSubpackages() {
  const packagesDir = resolve(projectRoot, 'packages');
  const entries = readdirSync(packagesDir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;
    const pkgJsonPath = resolve(packagesDir, entry.name, 'package.json');
    if (!existsSync(pkgJsonPath)) continue;
    const spec = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
    if (typeof spec.name !== 'string' || spec.name.length === 0) continue;
    out.push({ dir: `packages/${entry.name}`, name: spec.name, version: spec.version });
  }
  return out;
}

/**
 * Topologically order subpackages so dependents publish AFTER their
 * `dependencies`. `peaks-loop-shared` has no workspace deps, so it sorts
 * first; root `peaks-loop` (added separately) sorts last. Falls back
 * to lexical name order on cycles so the behavior is stable.
 */
export function topoOrderSubpackages(pkgs) {
  const byName = new Map(pkgs.map((p) => [p.name, p]));
  const depsByName = new Map(
    pkgs.map((p) => [
      p.name,
      Object.keys({
        ...(JSON.parse(readFileSync(resolve(projectRoot, p.dir, 'package.json'), 'utf8'))
          .dependencies ?? {}),
        ...(JSON.parse(readFileSync(resolve(projectRoot, p.dir, 'package.json'), 'utf8'))
          .devDependencies ?? {})
      }).filter((n) => byName.has(n))
    ])
  );
  const seen = new Set();
  const out = [];
  function visit(name) {
    if (seen.has(name)) return;
    seen.add(name);
    for (const dep of depsByName.get(name) ?? []) visit(dep);
    const pkg = byName.get(name);
    if (pkg !== undefined) out.push(pkg);
  }
  for (const p of pkgs) visit(p.name);
  return out;
}

export function listInternalPackages() {
  // Dependency-safe publish order: `peaks-loop-shared` publishes
  // first; dependents follow; root `peaks-loop` publishes last. Order
  // is derived from the on-disk manifests so adding a subpackage no
  // longer requires editing this script.
  return topoOrderSubpackages(discoverSubpackages()).map(({ name, version }) => ({
    name,
    version
  }));
}
