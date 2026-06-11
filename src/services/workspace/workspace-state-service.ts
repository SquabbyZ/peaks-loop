import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { join, posix } from 'node:path';

/**
 * Spec §8.4 + §8.5 — `.peaks/_state/` collects one-time decision dotfiles.
 * Migrates from legacy `.peaks/<name>` flat layout.
 *
 * `stateDirPath` returns a POSIX-normalized logical path so callers and tests
 * can compare against a platform-independent string (the .peaks tree is a
 * config key, not a direct fs call). `mkdirSync` / `renameSync` below use
 * the platform-native `join` so files actually land on disk.
 */

const LEGACY_DOTFILES: readonly string[] = [
  '.peaks-init-hooks-decision.json',
  '.peaks-openspec-opt-in.json',
];

const STATE_DIR_NAME = '_state';

export function isLegacyDecisionDotfile(name: string): boolean {
  return (LEGACY_DOTFILES as readonly string[]).includes(name);
}

export function stateDirPath(projectRoot: string): string {
  return posix.join(projectRoot, '.peaks', STATE_DIR_NAME);
}

export interface CollectResult {
  moved: string[];
  skipped: string[];
}

export function collectLegacyDecisionDotfiles(projectRoot: string): CollectResult {
  const peaksDir = join(projectRoot, '.peaks');
  // Use the platform-native join for actual filesystem operations;
  // `stateDirPath` (POSIX) is only the public/portable surface for callers.
  const stateDir = join(projectRoot, '.peaks', STATE_DIR_NAME);
  mkdirSync(stateDir, { recursive: true });
  const moved: string[] = [];
  const skipped: string[] = [];

  for (const name of LEGACY_DOTFILES) {
    const from = join(peaksDir, name);
    const to = join(stateDir, name);
    if (!existsSync(from)) continue;
    if (existsSync(to)) {
      throw new Error(
        `DOTFILE_COLLISION: ${name} already exists in ${stateDir} (${readFileSync(to, 'utf8').length} bytes); refusing to overwrite`
      );
    }
    renameSync(from, to);
    moved.push(name);
  }
  return { moved, skipped };
}
