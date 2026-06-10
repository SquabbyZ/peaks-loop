/**
 * Source-of-truth helpers for `peaks skill scope`.
 *
 * The source-of-truth file `.peaks/scope/skills.json` is the canonical
 * record of the user's scope intent. Adapters translate it to their
 * IDE-native config; the CLI always reads back from this file on `--show`.
 *
 * Atomicity: every write goes through `.peaks-tmp` first, then `rename`
 * (POSIX-atomic; on Windows `rename` is atomic for files on the same volume).
 * See tech-doc-025 §3.1.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { ScopeConfig } from './types.js';

/** File name for the canonical source-of-truth. */
export const SCOPE_FILE_NAME = 'skills.json';

/** Resolve the canonical source-of-truth path for a project root. */
export function scopeFilePath(projectRoot: string): string {
  return join(projectRoot, '.peaks', 'scope', SCOPE_FILE_NAME);
}

/** Resolve the per-IDE companion file path (kebab-case). */
export function ideCompanionFilePath(projectRoot: string, ide: string): string {
  return join(projectRoot, '.peaks', 'scope', `${ide}-skills.json`);
}

/** Resolve the `.peaks/scope/` directory for a project root. */
export function scopeDir(projectRoot: string): string {
  return join(projectRoot, '.peaks', 'scope');
}

/**
 * Read the source-of-truth scope config, or null if it does not exist.
 * Returns null on parse error too — the caller decides whether to surface.
 */
export async function readSourceOfTruth(projectRoot: string): Promise<ScopeConfig | null> {
  const file = scopeFilePath(projectRoot);
  if (!existsSync(file)) return null;
  try {
    const raw = await readFile(file, 'utf8');
    return JSON.parse(raw) as ScopeConfig;
  } catch {
    return null;
  }
}

/**
 * Read the per-IDE companion file (`.peaks/scope/<ide>-skills.json`), or
 * null if it does not exist or is unparseable.
 */
export async function readIdeCompanion(projectRoot: string, ide: string): Promise<unknown> {
  const file = ideCompanionFilePath(projectRoot, ide);
  if (!existsSync(file)) return null;
  try {
    const raw = await readFile(file, 'utf8');
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/**
 * Write the canonical source-of-truth atomically. The `.peaks-tmp` file
 * is cleaned up in a finally block on partial failure.
 */
export async function writeSourceOfTruth(projectRoot: string, config: ScopeConfig): Promise<string> {
  const file = scopeFilePath(projectRoot);
  await mkdir(scopeDir(projectRoot), { recursive: true });
  const tmp = `${file}.peaks-tmp`;
  try {
    await writeFile(tmp, JSON.stringify(config, null, 2) + '\n', 'utf8');
    await rename(tmp, file);
    return file;
  } catch (error) {
    if (existsSync(tmp)) {
      try { await rm(tmp, { force: true }); } catch { /* best-effort */ }
    }
    throw error;
  }
}

/**
 * Write a generic JSON document atomically. Used by stub adapters for
 * their `<ide>-skills.json` companion file (G3 §4.1).
 */
export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.peaks-tmp`;
  try {
    await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
    await rename(tmp, file);
  } catch (error) {
    if (existsSync(tmp)) {
      try { await rm(tmp, { force: true }); } catch { /* best-effort */ }
    }
    throw error;
  }
}

/**
 * Remove a file if it exists. Returns true if it was removed.
 */
export async function removeIfExists(file: string): Promise<boolean> {
  if (!existsSync(file)) return false;
  try {
    await rm(file, { force: true });
    return true;
  } catch {
    return false;
  }
}