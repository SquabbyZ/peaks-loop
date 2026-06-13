/**
 * Slice Pick Service -- the fzf integration layer.
 *
 * `peaks slice pick <rid>` reads the DecompositionResult produced by
 * `decomposeSlices`, formats the candidate slices as fzf input, spawns
 * fzf for human multi-select, parses the selection, and writes
 * `<rid>-picked.json` for downstream `peaks slice plan` consumption.
 *
 * fzf is the ONLY hard dependency at this layer. The algorithm itself
 * (slice-decompose-service) is fzf-free. If fzf is absent, this command
 * errors with one-line install hint and the algorithm output is still
 * consumable by any JSON-aware tool.
 *
 * v1 fzf integration:
 *   - one-line per candidate: `<batch-id> | <rid> | <label> | <minutesP50>m | <files>`
 *   - --multi so the human can pick multiple
 *   - --preview window shows the slice's fileSet + testsAdded
 *   - fzf version >= 0.38 required (for --filter and preview support)
 *
 * Source-of-truth: the algorithm is fzf-free; fzf is the *consumer* of
 * the algorithm output, not an input to it. v2 can swap fzf for a
 * different selector (skim, peco) without touching the algorithm.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DecompositionResult, SliceCandidate } from './slice-decompose-types.js';

export interface PickOptions {
  /** When true, render side-by-side preview in fzf (recommended; needs fzf >= 0.38). */
  preview?: boolean;
  /** Override fzf binary path (default: 'fzf'). Useful for tests. */
  fzfBin?: string;
  /** Override stdin content for tests; bypasses the actual spawning. */
  overrideStdin?: string;
}

export interface PickedResult {
  picked: readonly SliceCandidate[];
  outputPath: string;
  fzfVersion: string;
}

const MIN_FZF_VERSION = '0.38';

export async function pickSlicesInteractive(
  rid: string,
  decomposition: DecompositionResult,
  projectRoot: string,
  options: PickOptions = {}
): Promise<PickedResult> {
  const fzfBin = options.fzfBin ?? 'fzf';

  // Validate fzf presence + version
  let fzfVersion: string;
  try {
    fzfVersion = checkFzfVersion(fzfBin);
  } catch (error: unknown) {
    if (isEnoent(error) || isCommandNotFound(error)) {
      throw new Error(
        `fzf binary not found. Install with: brew install fzf  (or apt: apt-get install fzf). ` +
          `peaks slice pick requires fzf >= ${MIN_FZF_VERSION} to interactively select slices. ` +
          `The algorithm output is fzf-free; you can also manually craft the -picked.json file.`
      );
    }
    throw error;
  }

  // Flatten candidates from all batches
  const candidates: Array<{ batch: number; slice: SliceCandidate }> = [];
  for (const batch of decomposition.parallelBatches) {
    for (const slice of batch.slices) {
      candidates.push({ batch: batch.batch, slice });
    }
  }

  // Format fzf input lines
  const fzfInput = candidates
    .map(({ batch, slice }) => {
      const fileList = slice.files.join(',');
      return `B${batch} | ${slice.rid} | ${slice.label} | ${slice.estimate.minutesP50}m | ${fileList}`;
    })
    .join('\n');

  // Spawn fzf (or use override for tests)
  const args = ['--multi', '--prompt=slice> '];
  if (options.preview) {
    args.push('--preview', 'cat');
  }
  let stdout: string;
  if (options.overrideStdin !== undefined) {
    stdout = options.overrideStdin;
  } else {
    try {
      stdout = execFileSync(fzfBin, args, {
        input: fzfInput,
        cwd: projectRoot,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        timeout: 60_000,
        maxBuffer: 32 * 1024 * 1024
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

  // Parse selection
  const selectedLines = stdout.split('\n').filter((l) => l.trim().length > 0);
  const pickedSet = new Set<string>();
  for (const line of selectedLines) {
    const parts = line.split('|').map((p) => p.trim());
    if (parts.length >= 2 && parts[1] !== undefined) {
      pickedSet.add(parts[1]);
    }
  }
  const picked: SliceCandidate[] = candidates
    .filter((c) => pickedSet.has(c.slice.rid))
    .map((c) => c.slice);

  // Write <rid>-picked.json
  const outputPath = writePickedFile(rid, picked, decomposition, fzfVersion, projectRoot);

  return { picked, outputPath, fzfVersion };
}

function checkFzfVersion(fzfBin: string): string {
  const stdout = execFileSync(fzfBin, ['--version'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    timeout: 5_000
  }).toString('utf8');
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
  for (let i = 0; i < len; i++) {
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

function writePickedFile(
  rid: string,
  picked: readonly SliceCandidate[],
  decomposition: DecompositionResult,
  fzfVersion: string,
  projectRoot: string
): string {
  const dir = join(projectRoot, '.peaks', 'sc', 'slice-decomposition');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const outPath = join(dir, `${rid}-picked.json`);
  const payload = {
    rid,
    pickedAt: new Date().toISOString(),
    fzfVersion,
    parentRid: decomposition.rid,
    picked
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
  return outPath;
}
