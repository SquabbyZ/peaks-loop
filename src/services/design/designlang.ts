/**
 * `designlang` CLI wrappers for `peaks design check`: `process.execPath` plus the
 * resolved entry, `shell: false`, and a hard timeout that reaps the whole tree.
 * A check counts as positive evidence only when its own machine-readable
 * document is present — an exit 0 with empty or non-JSON stdout is
 * `DESIGN_RENDER_NO_EVIDENCE`, never a pass.
 *
 * `grade` writes `<prefix>.grade.json` into `--out` (it has no stdout JSON flag),
 * so the caller reads it back through `readGradeEvidence`; `drift`, `verify-ui`,
 * `slop`, and `stats` emit JSON on stdout. `--system-chrome` is extract-only,
 * never here. The per-tool evidence shapes live in `designlang-evidence.ts`.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import type { Dirent } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import {
  evidenceRefusal,
  parseJsonObject,
  type EvidenceExpectation
} from './designlang-evidence.js';

/** Budget for one designlang run; a render may launch a browser and navigate. */
export const DEFAULT_RUN_TIMEOUT_MS = 120_000;

/** Suffix designlang gives its written grade reports. */
const GRADE_FILE_SUFFIX = '.grade.json';

const ABNORMAL_EXIT = -1;

/** This process's start; a grade report older than it was written by an earlier run. */
const RUN_STARTED_AT = Date.now();

export type DesignlangRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export type DesignlangRunInput = {
  entryPath: string;
  args: readonly string[];
  /** Defaults to `DEFAULT_RUN_TIMEOUT_MS`; on elapse the child is killed. */
  timeoutMs?: number;
};

export type DesignlangCheckKind = 'drift' | 'verify-ui' | 'slop' | 'grade' | 'stats';

export type BuildDesignlangArgsInput =
  | { kind: 'drift'; url: string; tokensPath: string }
  | { kind: 'verify-ui'; url: string; brandPath: string }
  | { kind: 'slop'; url: string; brandPath?: string }
  | { kind: 'grade'; url: string; outDir: string }
  | { kind: 'stats'; url: string }
  /**
   * The page-probe capture, probed 2026-11-24: it writes
   * `<outDir>/screenshots/full-page.png` and echoes that path as
   * `componentScreenshots.fullPage.path` in its JSON.
   */
  | { kind: 'extract'; url: string; outDir: string };

/** Positive evidence, or the exact code the caller must treat as blocked. */
export type DesignlangEvidence =
  | { ok: true; pages: number; raw: Record<string, unknown> }
  | { ok: false; code: 'DESIGN_RENDER_NO_EVIDENCE'; message: string };

export type ParseDesignlangEvidenceInput = {
  kind: DesignlangCheckKind;
  stdout: string;
  /** The values the spawn was given; drift must echo them back. */
  expect?: EvidenceExpectation;
};

/** The exact CLI vector for each check; the page URL is the first positional. */
export function buildDesignlangArgs(input: BuildDesignlangArgsInput): string[] {
  switch (input.kind) {
    case 'drift':
      return ['drift', input.url, '--tokens', input.tokensPath, '--json'];
    case 'verify-ui':
      return ['verify-ui', input.url, '--brand', input.brandPath, '--json'];
    case 'slop':
      return input.brandPath === undefined
        ? ['slop', input.url, '--json']
        : ['slop', input.url, '--brand', input.brandPath, '--json'];
    case 'grade':
      return ['grade', input.url, '--format', 'json', '--out', input.outDir];
    case 'stats':
      return ['stats', input.url, '--as-json'];
    case 'extract':
      return [input.url, '--json', '--screenshots', '--no-history', '-o', input.outDir, '--quiet'];
  }
}

/** Kill the whole tree and await it: `taskkill /T /F`, or the POSIX process group. */

function killTree(child: ChildProcess): Promise<boolean> {
  const pid = child.pid;
  if (pid === undefined) return Promise.resolve(false);
  if (process.platform === 'win32') {
    return new Promise<boolean>((settle) => {
      execFile('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true }, (error) => {
        settle(error === null);
      });
    });
  }
  try {
    process.kill(-pid, 'SIGKILL');
    return Promise.resolve(true);
  } catch {
    return Promise.resolve(false);
  }
}

/**
 * Spawn the resolved entry directly (never a shell), collect both streams, and
 * kill the whole tree on timeout. A spawn failure is `exitCode: -1` with the
 * error on stderr, never thrown, so the caller classifies it.
 */
export async function runDesignlang(input: DesignlangRunInput): Promise<DesignlangRunResult> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
  return new Promise<DesignlangRunResult>((settle) => {
    const child = spawn(process.execPath, [input.entryPath, ...input.args], {
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let finished = false;
    const finish = (exitCode: number): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      settle({ exitCode, stdout, stderr, timedOut });
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error: Error) => {
      if (timedOut) return;
      stderr += error.message;
      finish(ABNORMAL_EXIT);
    });
    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      // While a tree kill is in flight, its own callback settles the promise:
      // the direct child's exit is not the same fact as the tree being gone.
      if (timedOut) return;
      finish(code ?? (signal === null ? 0 : ABNORMAL_EXIT));
    });
    const timer = setTimeout(() => {
      timedOut = true;
      void killTree(child).then(() => {
        finish(ABNORMAL_EXIT);
      });
    }, timeoutMs);
  });
}

function noEvidence(kind: DesignlangCheckKind, detail: string): DesignlangEvidence {
  return {
    ok: false,
    code: 'DESIGN_RENDER_NO_EVIDENCE',
    message: `designlang ${kind} produced no evidence: ${detail}`
  };
}

/**
 * Parse one check's stdout into evidence: `JSON.parse` of the whole stream, then
 * the last balanced block when log lines surround it. Empty, non-JSON, or a
 * payload that does not carry its own tool's shape (see `designlang-evidence`)
 * is refused; a timestamp is never invented.
 */
export function parseDesignlangEvidence(input: ParseDesignlangEvidenceInput): DesignlangEvidence {
  const trimmed = input.stdout.trim();
  if (trimmed === '') return noEvidence(input.kind, 'stdout was empty.');
  const parsed = parseJsonObject(trimmed);
  if (parsed === null) {
    return noEvidence(input.kind, 'stdout did not contain a non-empty JSON object.');
  }
  const refusal = evidenceRefusal(input.kind, parsed, input.expect);
  if (refusal !== null) return noEvidence(input.kind, refusal);
  return { ok: true, pages: Array.isArray(parsed.pages) ? parsed.pages.length : 1, raw: parsed };
}

async function newestGradeFile(outDir: string, notBefore: number): Promise<string | null> {
  let entries: Dirent[] = [];
  try {
    entries = await readdir(outDir, { withFileTypes: true });
  } catch {
    // A missing or unreadable directory holds no report; fall through to the
    // explicit "no evidence" result below.
    entries = [];
  }
  let newest: { path: string; mtimeMs: number } | null = null;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(GRADE_FILE_SUFFIX)) continue;
    const path = join(outDir, entry.name);
    try {
      const stats = await stat(path);
      // A report older than this run belongs to a previous run, not this one.
      if (stats.mtimeMs < notBefore) continue;
      if (newest === null || stats.mtimeMs > newest.mtimeMs) {
        newest = { path, mtimeMs: stats.mtimeMs };
      }
    } catch {
      continue;
    }
  }
  return newest === null ? null : newest.path;
}

/** Read this run's `*.grade.json`; absent, stale, or unreadable is no evidence. */
export async function readGradeEvidence(
  outDir: string,
  notBefore: number = RUN_STARTED_AT
): Promise<DesignlangEvidence> {
  const path = await newestGradeFile(outDir, notBefore);
  if (path === null) {
    return noEvidence('grade', `no *${GRADE_FILE_SUFFIX} report from this run in ${outDir}.`);
  }
  try {
    const text = await readFile(path, 'utf8');
    return parseDesignlangEvidence({ kind: 'grade', stdout: text });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return noEvidence('grade', `could not read ${path}: ${detail}`);
  }
}
