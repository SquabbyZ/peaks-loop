/**
 * Check: workspace layout is post-F3 canonical
 * (`build:workspace-layout-canonical`).
 *
 * Build-hygiene check that surfaces any leftover top-level session
 * dirs (`.peaks/<YYYY-MM-DD-session-<hex>>/`), the legacy runtime
 * dotfiles (`.peaks/.session.json`), the stale single-slot
 * presence file (`.peaks/_runtime/active-skill.json`, the deprecated
 * project-level marker removed in slice 4.0.11), OR per-change-id
 * top-level dirs (`.peaks/NNN-YYYY-MM-DD-<slug>/`).
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

// Slice 4.0.11 statusline-sid-scoped-lease C: `.peaks/.active-skill.json`
// is REMOVED from LEGACY_DOTFILES (the file should not exist on
// healthy post-4.0.11 projects; treating it as a generic legacy
// dotfile is misleading). The new single-slot presence file
// `.peaks/_runtime/active-skill.json` is reported separately under
// `STALE_SINGLE_SLOT_FILES` so the operator gets a clear "stale
// single-slot presence" message instead of a generic legacy warning.
const LEGACY_DOTFILES: ReadonlyArray<string> = ['.session.json'];

// Top-level single-slot presence files that are stale after the
// sid-scoped lease projection (slice 4.0.8) shipped. Reported
// separately from LEGACY_DOTFILES so the doctor message names the
// specific issue ("stale single-slot presence") and the operator
// can delete the file. The canonical sid-scoped lease at
// `.peaks/_runtime/<sid>/leases/presence-*.json` is the source of truth.
const STALE_SINGLE_SLOT_FILES: ReadonlyArray<string> = [
  'active-skill.json',
  '.active-skill.json'
];

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
  staleSingleSlotScanner?: (root: string) => string[];
}): WorkspaceLayoutInspection {
  const topLevel = opts.topLevelScanner ?? defaultTopLevelSessionDirScanner;
  const dotfiles = opts.dotfileScanner ?? defaultLegacyDotfileScanner;
  const perChangeId = opts.perChangeIdScanner ?? defaultPerChangeIdDirScanner;
  const staleSingleSlot = opts.staleSingleSlotScanner ?? defaultStaleSingleSlotScanner;
  return {
    topLevelSessionDirs: safeList(() => topLevel(opts.projectRoot)),
    legacyDotfiles: safeList(() => dotfiles(opts.projectRoot)),
    perChangeIdDirs: safeList(() => perChangeId(opts.projectRoot)),
    staleSingleSlotFiles: safeList(() => staleSingleSlot(opts.projectRoot))
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

/**
 * Slice 4.0.11 statusline-sid-scoped-lease C: surface the deprecated
 * single-slot presence files (`.peaks/_runtime/active-skill.json` and
 * the legacy `.peaks/.active-skill.json`) as a separate offender
 * category. The canonical sid-scoped lease projection
 * (`.peaks/_runtime/<sid>/leases/presence-*.json`) is the source of
 * truth; these single-slot files should be deleted so the doctor
 * report is clean.
 *
 * The reported path is the project-relative form so the doctor's
 * human-readable output stays consistent with `legacyDotfiles`.
 */
function defaultStaleSingleSlotScanner(projectRoot: string): string[] {
  const offenders: string[] = [];
  const candidates: ReadonlyArray<string> = [
    join(projectRoot, '.peaks', '_runtime', 'active-skill.json'),
    join(projectRoot, '.peaks', '.active-skill.json')
  ];
  const reported: ReadonlyArray<string> = [
    join('.peaks', '_runtime', 'active-skill.json'),
    join('.peaks', '.active-skill.json')
  ];
  for (let i = 0; i < candidates.length; i++) {
    if (existsSync(candidates[i])) {
      offenders.push(reported[i]);
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
    return { topLevelSessionDirs: [], legacyDotfiles: [], perChangeIdDirs: [], staleSingleSlotFiles: [] };
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
    // Slice 4.0.11: probes injected by pre-4.0.11 tests also omit
    // staleSingleSlotFiles. Treat missing field as empty.
    const staleSingleSlotFiles = layout.staleSingleSlotFiles ?? [];
    if (
      layout.topLevelSessionDirs.length === 0 &&
      layout.legacyDotfiles.length === 0 &&
      perChangeIdDirs.length === 0 &&
      staleSingleSlotFiles.length === 0
    ) {
      return [{
        id: 'build:workspace-layout-canonical',
        ok: true,
        message: 'Workspace layout is canonical: no top-level session dirs, no legacy runtime dotfiles, no per-change-id top-level dirs, no stale single-slot presence files'
      }];
    }
    const offenders = [
      ...layout.topLevelSessionDirs.map((p) => `top-level session dir: ${p}`),
      ...layout.legacyDotfiles.map((p) => `legacy dotfile: ${p}`),
      ...perChangeIdDirs.map((p) => `per-change-id top-level dir: ${p}`),
      ...staleSingleSlotFiles.map((p) => `stale single-slot presence: ${p}`)
    ];
    return [{
      id: 'build:workspace-layout-canonical',
      ok: false,
      message: `Workspace layout is not canonical. Offenders: ${offenders.join('; ')}. Run \`peaks workspace migrate --to-runtime --project <repo> --apply\` to consolidate; delete stale single-slot presence files manually after migration.`
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