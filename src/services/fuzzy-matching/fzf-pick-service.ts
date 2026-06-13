/**
 * Generic fzf binary picker (slice 2026-06-14-fzf-headroom-rollout).
 *
 * Promoted from `src/services/slice/slice-pick-service.ts` (which is
 * the only prior caller). Encapsulates the canonical fzf integration
 * pattern: format items as one-line text, spawn `fzf --multi`, parse
 * the multi-selection, write a `<list-id>-picked.json` artifact.
 *
 * Two distinct things live in `src/services/fuzzy-matching/`:
 *  - `fuzzy-match-service.ts` — in-process fzf *npm package* (the
 *    Fzf class). Used by `memory search` / `retrospective search`.
 *  - `fzf-pick-service.ts`    — spawns the fzf *binary* for
 *    interactive TTY multi-select. Used by `peaks slice pick`,
 *    `peaks memory list --pick`, `peaks retrospective index --pick`.
 *
 * The two are independent (one is a library, the other spawns a CLI);
 * do not merge them. fzf-for-js returns positions; the binary returns
 * raw lines. Different output shapes → different consumers.
 *
 * Source-of-truth: the binary is the *consumer* of the formatter
 * output, not an input. Each caller injects its own `formatLine` and
 * `parseLine` so a future swap to skim/peco is a one-line change per
 * caller, not a refactor of this service.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface FzfPickOptions<T> {
  readonly items: readonly T[];
  /** Render a single item as one line of fzf input. Must round-trip with parseLine. */
  readonly formatLine: (item: T) => string;
  /** Reconstruct an item from a fzf output line. Return null to drop the line. */
  readonly parseLine: (line: string) => T | null;
  /** Absolute path for the output artifact. Caller decides the directory layout. */
  readonly outputPath: string;
  /** Metadata to embed in the picked artifact (rid, parentId, etc). */
  readonly meta: Record<string, unknown>;
  /** Run `fzf --preview 'cat'` (recommended; needs fzf >= 0.38). */
  readonly preview?: boolean;
  /** Override fzf binary path (default: 'fzf'). Useful for tests. */
  readonly fzfBin?: string;
  /** Override stdin content for tests; bypasses the actual spawning. */
  readonly overrideStdin?: string;
  /** Working directory for the fzf spawn. */
  readonly projectRoot: string;
  /** fzf --multi toggle (default true; pass false for single-select). */
  readonly multi?: boolean;
  /** Custom fzf prompt string (default "pick> "). */
  readonly prompt?: string;
}

export interface FzfPickResult<T> {
  readonly picked: readonly T[];
  readonly outputPath: string;
  readonly fzfVersion: string;
}

export const MIN_FZF_VERSION = '0.38';
const SPAWN_TIMEOUT_MS = 60_000;
const MAX_BUFFER_BYTES = 32 * 1024 * 1024;

/**
 * Pick a subset of `items` interactively via fzf. The full flow:
 *   1. Check fzf presence + version.
 *   2. Format items as one-line text (caller's formatLine).
 *   3. Spawn `fzf --multi` (or test override).
 *   4. Parse the multi-selection back into T[] (caller's parseLine).
 *   5. Write `<outputPath>` with the picked + meta + fzfVersion.
 *
 * Failure modes:
 *   - fzf missing → throws with `brew install fzf | apt-get install fzf` hint.
 *   - fzf version too old → throws.
 *   - fzf exits 130 (Esc) → returns `{ picked: [], outputPath, fzfVersion }` (NOT thrown).
 *   - parseLine returns null for a line → silently dropped (line ignored).
 */
export async function pickFromList<T>(options: FzfPickOptions<T>): Promise<FzfPickResult<T>> {
  const fzfBin = options.fzfBin ?? 'fzf';
  const fzfVersion = checkFzfVersion(fzfBin);

  if (options.items.length === 0) {
    // Nothing to pick from. Still write an empty picked artifact so
    // downstream commands have a stable file contract.
    const emptyPayload = { ...options.meta, pickedAt: new Date().toISOString(), fzfVersion, picked: [] };
    writeArtifact(options.outputPath, emptyPayload);
    return { picked: [], outputPath: options.outputPath, fzfVersion };
  }

  const fzfInput = options.items.map(options.formatLine).join('\n');

  const args: string[] = [];
  args.push(options.multi === false ? '--no-multi' : '--multi');
  args.push(`--prompt=${options.prompt ?? 'pick> '}`);
  if (options.preview === true) {
    args.push('--preview', 'cat');
  }

  let stdout: string;
  if (options.overrideStdin !== undefined) {
    stdout = options.overrideStdin;
  } else {
    try {
      stdout = execFileSync(fzfBin, args, {
        input: fzfInput,
        cwd: options.projectRoot,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        timeout: SPAWN_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER_BYTES
      }).toString('utf8');
    } catch (error: unknown) {
      const err = error as { status?: number };
      if (err.status === 130) {
        stdout = ''; // user pressed Esc
      } else {
        throw error;
      }
    }
  }

  const selectedLines = stdout.split('\n').filter((l) => l.trim().length > 0);
  const seen = new Set<string>();
  const picked: T[] = [];
  for (const line of selectedLines) {
    const item = options.parseLine(line);
    if (item === null) continue;
    // Dedup by JSON serialization (caller's T may not be hashable otherwise).
    const key = JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(item);
  }

  const payload = { ...options.meta, pickedAt: new Date().toISOString(), fzfVersion, picked };
  writeArtifact(options.outputPath, payload);

  return { picked, outputPath: options.outputPath, fzfVersion };
}

function checkFzfVersion(fzfBin: string): string {
  let stdout: string;
  try {
    stdout = execFileSync(fzfBin, ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      timeout: 5_000
    }).toString('utf8');
  } catch (error: unknown) {
    if (isEnoent(error) || isCommandNotFound(error)) {
      throw new Error(
        `fzf binary not found. Install with: brew install fzf  (or apt: apt-get install fzf). ` +
          `fzf >= ${MIN_FZF_VERSION} is required for interactive list picking.`
      );
    }
    throw error;
  }

  const version = stdout.trim().split('\n')[0] ?? '';
  if (compareVersions(version, MIN_FZF_VERSION) < 0) {
    throw new Error(`fzf version ${version} is older than required ${MIN_FZF_VERSION}`);
  }
  return version;
}

function compareVersions(a: string, b: string): number {
  const aParts = a.split('.').map((p) => parseInt(p, 10) || 0);
  const bParts = b.split('.').map((p) => parseInt(p, 10) || 0);
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i += 1) {
    const av = aParts[i] ?? 0;
    const bv = bParts[i] ?? 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

function isEnoent(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  return (error as { code?: string }).code === 'ENOENT';
}

function isCommandNotFound(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const msg = (error as { message?: string }).message ?? '';
  return /command not found|not found/i.test(msg);
}

function writeArtifact(outputPath: string, payload: unknown): void {
  const dir = dirname(outputPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf8');
}
