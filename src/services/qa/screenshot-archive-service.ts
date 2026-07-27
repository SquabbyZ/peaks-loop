/**
 * rid-012 (2026-07-27) — screenshot archive service.
 *
 * Purpose: enforce the peaks-qa SKILL.md "Hard contracts for browser
 * validation" Contract 1 — every Playwright screenshot MUST land under
 * `.peaks/_runtime/<sessionId>/qa/screenshots/`, not at the project
 * root. When the LLM forgets to pass `filename` to
 * `browser_take_screenshot`, Playwright MCP writes to the current
 * working directory (typically the project root), which scatters
 * `.png` files at the repo top level. This service is the
 * remediation: scan a directory, move stray screenshot files into
 * the canonical screenshots/ subdir under the active QA scope.
 *
 * CLI surface (peaks qa archive-screenshots):
 *   peaks qa archive-screenshots [--source <dir>] [--project <root>]
 *
 * Behavior:
 *   - Scan `--source` for *.png / *.jpg / *.jpeg files (case-insensitive
 *     extension match). Recurse exactly 1 level deep — the project
 *     root plus one subdir (covers `./foo.png` + `./screenshots/*.png`).
 *     Avoid recursing into `.peaks/` or `node_modules/` (artifact dirs).
 *   - Auto-create `.peaks/_runtime/<session-id>/qa/screenshots/` if
 *     missing (mkdirSync recursive, mode 0o755).
 *   - For each stray file: `fs.renameSync(src, dst)`. If `dst` exists
 *     (filename collision across multiple invocations), suffix with
 *     `-<ISO-timestamp>` so the move is non-destructive.
 *   - Return JSON envelope with moved list + skipped list + final
 *     screenshots/ dir contents.
 */

import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type ScreenshotExtension = '.png' | '.jpg' | '.jpeg';

export interface ArchiveScreenshotOptions {
  readonly sourceDir: string;
  readonly targetDir: string;
  readonly now?: Date;
}

export interface ArchiveScreenshotEnvelope {
  readonly scannedSource: string;
  readonly targetDir: string;
  readonly moved: readonly { readonly from: string; readonly to: string }[];
  readonly skipped: readonly { readonly path: string; readonly reason: string }[];
  readonly targetContentsBefore: readonly string[];
  readonly targetContentsAfter: readonly string[];
  readonly archivedAt: string;
}

const SCREENSHOT_EXTS: ReadonlySet<string> = new Set(['.png', '.jpg', '.jpeg']);

function isScreenshotFile(name: string): boolean {
  const lower = name.toLowerCase();
  for (const ext of SCREENSHOT_EXTS) {
    if (lower.endsWith(ext)) {
      return true;
    }
  }
  return false;
}

function listScreenshotFiles(sourceDir: string, targetDir: string): string[] {
  // Recurse 1 level deep. Skip .peaks/ + node_modules/ + hidden dirs.
  // Also skip the targetDir itself to avoid re-scanning already-archived files
  // (otherwise the same file would appear twice across calls, and the second
  // call's collision check would treat it as a duplicate).
  const targetBaseName = targetDir.split(/[\\/]/).pop();
  const out: string[] = [];
  const top = readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of top) {
    if (entry.name === targetBaseName) {
      continue;
    }
    const full = join(sourceDir, entry.name);
    if (entry.isFile()) {
      if (isScreenshotFile(entry.name)) {
        out.push(full);
      }
      continue;
    }
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') {
        continue;
      }
      try {
        const sub = readdirSync(full, { withFileTypes: true });
        for (const subEntry of sub) {
          if (subEntry.isFile() && isScreenshotFile(subEntry.name)) {
            out.push(join(full, subEntry.name));
          }
        }
      } catch {
        // unreadable subdir — skip silently
      }
    }
  }
  return out;
}

export function archiveScreenshots(options: ArchiveScreenshotOptions): ArchiveScreenshotEnvelope {
  const sourceDir = resolve(options.sourceDir);
  const targetDir = resolve(options.targetDir);
  const now = options.now ?? new Date();

  if (!existsSync(sourceDir)) {
    return {
      scannedSource: sourceDir,
      targetDir,
      moved: [],
      skipped: [{ path: sourceDir, reason: 'source dir not found' }],
      targetContentsBefore: [],
      targetContentsAfter: [],
      archivedAt: now.toISOString()
    };
  }

  const targetContentsBefore = existsSync(targetDir)
    ? readdirSync(targetDir)
    : [];

  mkdirSync(targetDir, { recursive: true });

  const candidates = listScreenshotFiles(sourceDir, targetDir);
  const moved: Array<{ from: string; to: string }> = [];
  const skipped: Array<{ path: string; reason: string }> = [];

  for (const src of candidates) {
    const baseName = src.split(/[\\/]/).pop() ?? 'unknown.png';
    let dst = join(targetDir, baseName);
    if (existsSync(dst)) {
      // collision: suffix with ISO timestamp
      const dot = baseName.lastIndexOf('.');
      const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
      const ext = dot > 0 ? baseName.slice(dot) : '';
      const stamp = now.toISOString().replace(/[:.]/g, '-');
      dst = join(targetDir, `${stem}-${stamp}${ext}`);
    }
    try {
      renameSync(src, dst);
      moved.push({ from: src, to: dst });
    } catch (err) {
      skipped.push({
        path: src,
        reason: err instanceof Error ? err.message : 'rename failed'
      });
    }
  }

  const targetContentsAfter = readdirSync(targetDir);

  return {
    scannedSource: sourceDir,
    targetDir,
    moved,
    skipped,
    targetContentsBefore,
    targetContentsAfter,
    archivedAt: now.toISOString()
  };
}