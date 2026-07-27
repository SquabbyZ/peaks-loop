/**
 * Check: workspace layout is post-F3 canonical
 * (`build:workspace-layout-canonical`).
 *
 * Build-hygiene check that surfaces any leftover top-level session
 * dirs (`.peaks/<YYYY-MM-DD-session-<hex>>/`), the legacy runtime
 * dotfiles (`.peaks/.session.json`, `.peaks/.active-skill.json`),
 * OR per-change-id top-level dirs (`.peaks/NNN-YYYY-MM-DD-<slug>/`).
 *
 * The post-F3 canonical layout puts session dirs under
 * `.peaks/_runtime/<sid>/` and the runtime binding at
 * `.peaks/_runtime/session.json`. The legacy paths must be absent.
 *
 * The pure `inspectWorkspaceLayout` helper is exported so tests
 * can drive the filesystem walk without monkey-patching
 * `process.cwd()` or `findProjectRoot`. Both scanners fail-soft
 * (return `[]` on read errors) so a flaky filesystem read on a
 * non-fatal probe path never escalates into a doctor failure.
 */

import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { getErrorMessage } from 'peaks-loop-shared/result';

import type { DoctorCheck, DoctorCheckPlugin, DoctorContext, WorkspaceLayoutInspection } from '../types.js';

const SESSION_DIR_PATTERN = /^\d{4}-\d{2}-\d{2}-session-[a-f0-9]+$/;

/**
 * Slice 007 — per-change-id top-level dir pattern. Matches the
 * F3-canonical (pre-canonicalization) layout the 5 already-shipped
 * slices left behind, e.g. `.peaks/001-2026-06-06-doctor-dist-version-check/`.
 * The pattern is intentionally narrow so it does NOT match the
 * post-F3 system dirs (`_runtime/`, `_dogfood/`, `retrospective/`,
 * `memory/`, `perf-baseline/`, `project-scan/`, `sops/`,
 * `0NN-session-...`, `YYYY-MM-DD-session-...`).
 */
const PER_CHANGE_ID_PATTERN = /^\d{3}-\d{4}-\d{2}-\d{2}-[a-z][a-z0-9-]*[a-z0-9]$/;

const LEGACY_DOTFILES: ReadonlyArray<string> = ['.session.json', '.active-skill.json'];

/**
 * Pure helper that inspects the on-disk workspace layout for
 * post-F3-canonical violations. Exported so tests can drive the
 * filesystem walk without monkey-patching `process.cwd()` or
 * `findProjectRoot`.
 */
export function inspectWorkspaceLayout(opts: {
  projectRoot: string;
  topLevelScanner?: (root: string) => string[];
  dotfileScanner?: (root: string) => string[];
  perChangeIdScanner?: (root: string) => string[];
}): WorkspaceLayoutInspection {
  const topLevel = opts.topLevelScanner ?? defaultTopLevelSessionDirScanner;
  const dotfiles = opts.dotfileScanner ?? defaultLegacyDotfileScanner;
  const perChangeId = opts.perChangeIdScanner ?? defaultPerChangeIdDirScanner;
  return {
    topLevelSessionDirs: safeList(() => topLevel(opts.projectRoot)),
    legacyDotfiles: safeList(() => dotfiles(opts.projectRoot)),
    perChangeIdDirs: safeList(() => perChangeId(opts.projectRoot))
  };
}

function safeList(reader: () => string[]): string[] {
  try {
    const out = reader();
    return Array.isArray(out) ? out : [];
  } catch {
    return [];
  }
}

function defaultTopLevelSessionDirScanner(projectRoot: string): string[] {
  const peaksRoot = join(projectRoot, '.peaks');
  if (!existsSync(peaksRoot)) return [];
  let names: string[];
  try {
    names = readdirSync(peaksRoot);
  } catch {
    return [];
  }
  const offenders: string[] = [];
  for (const name of names) {
    if (!SESSION_DIR_PATTERN.test(name)) continue;
    const full = join(peaksRoot, name);
    try {
      const stat = existsSync(full) ? lstatSync(full) : null;
      if (stat === null) continue;
      // Directories only — the regex should never match a dotfile or
      // regular file, but be defensive against weird filesystem state
      // (e.g. someone manually created a file whose name happens to
      // match the session-id pattern).
      if (stat.isDirectory()) {
        offenders.push(join('.peaks', name) + '/');
      }
    } catch {
      continue;
    }
  }
  return offenders;
}

function defaultLegacyDotfileScanner(projectRoot: string): string[] {
  const peaksRoot = join(projectRoot, '.peaks');
  if (!existsSync(peaksRoot)) return [];
  const offenders: string[] = [];
  for (const name of LEGACY_DOTFILES) {
    if (existsSync(join(peaksRoot, name))) {
      offenders.push(join('.peaks', name));
    }
  }
  return offenders;
}

function defaultPerChangeIdDirScanner(projectRoot: string): string[] {
  const peaksRoot = join(projectRoot, '.peaks');
  if (!existsSync(peaksRoot)) return [];
  let names: string[];
  try {
    names = readdirSync(peaksRoot);
  } catch {
    return [];
  }
  const offenders: string[] = [];
  for (const name of names) {
    if (!PER_CHANGE_ID_PATTERN.test(name)) continue;
    const full = join(peaksRoot, name);
    try {
      const stat = existsSync(full) ? lstatSync(full) : null;
      if (stat === null) continue;
      if (stat.isDirectory()) {
        offenders.push(join('.peaks', name) + '/');
      }
    } catch {
      continue;
    }
  }
  return offenders;
}

function defaultWorkspaceLayoutProbe(projectRootResolver: () => string | null): WorkspaceLayoutInspection {
  const projectRoot = projectRootResolver();
  if (projectRoot === null) {
    return { topLevelSessionDirs: [], legacyDotfiles: [], perChangeIdDirs: [] };
  }
  return inspectWorkspaceLayout({ projectRoot });
}

function run({ options, projectRootResolver }: DoctorContext): readonly DoctorCheck[] {
  const probe = options.workspaceLayoutProbe ?? (() => defaultWorkspaceLayoutProbe(projectRootResolver));
  try {
    const layout = probe();
    // Back-compat: probes injected by older tests (pre-slice-007)
    // return a 2-field shape (no perChangeIdDirs). Treat missing
    // field as empty.
    const perChangeIdDirs = layout.perChangeIdDirs ?? [];
    if (layout.topLevelSessionDirs.length === 0 && layout.legacyDotfiles.length === 0 && perChangeIdDirs.length === 0) {
      return [{
        id: 'build:workspace-layout-canonical',
        ok: true,
        message: 'Workspace layout is canonical: no top-level session dirs, no legacy runtime dotfiles, no per-change-id top-level dirs'
      }];
    }
    const offenders = [
      ...layout.topLevelSessionDirs.map((p) => `top-level session dir: ${p}`),
      ...layout.legacyDotfiles.map((p) => `legacy dotfile: ${p}`),
      ...perChangeIdDirs.map((p) => `per-change-id top-level dir: ${p}`)
    ];
    return [{
      id: 'build:workspace-layout-canonical',
      ok: false,
      message: `Workspace layout is not canonical. Offenders: ${offenders.join('; ')}. Run \`peaks workspace migrate --to-runtime --project <repo> --apply\` to consolidate.`
    }];
  } catch (error) {
    return [{
      id: 'build:workspace-layout-canonical',
      ok: false,
      message: `Workspace layout check failed: ${getErrorMessage(error)}`
    }];
  }
}

export const check: DoctorCheckPlugin = {
  name: 'workspace-layout',
  run
};